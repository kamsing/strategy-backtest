import {
  AssetConfig,
  MarketDataRow,
  PortfolioState,
  SimulationResult,
  StrategyFunction,
  FinancialEvent,
  getShareValue,
} from '../types'
import {
  calculateCAGR,
  calculateIRR,
  calculateMaxDrawdown,
  calculateSharpeRatio,
  calculateMaxRecoveryTime,
  calculateAnnualReturns,
  calculateRealValue,
  calculateUlcerIndex,
} from './financeMath'

/**
 * 从市场数据行中获取指定标的的收盘价
 * 支持 QQQ、QLD 及任意自定义标的（通过 customPrices）
 */
export const getTickerClose = (dataRow: MarketDataRow, ticker: string): number => {
  if (ticker === 'QQQ') return dataRow.qqqClose
  if (ticker === 'QLD') return dataRow.qldClose
  // 多标的 Record（PRD A1）
  if (dataRow.customPrices?.[ticker]) return dataRow.customPrices[ticker]
  // 向下兼容旧单标的字段
  if (dataRow.customClose && dataRow.customClose > 0) return dataRow.customClose
  return 0
}

/**
 * 从市场数据行中获取指定标的的低价（用于保证金评估）
 */
export const getTickerLow = (dataRow: MarketDataRow, ticker: string): number => {
  if (ticker === 'QQQ') return dataRow.qqqLow
  if (ticker === 'QLD') return dataRow.qldLow
  // 多标的 Record（PRD A1）
  if (dataRow.customLows?.[ticker]) return dataRow.customLows[ticker]
  // 向下兼容旧单标的字段
  if (dataRow.customLow && dataRow.customLow > 0) return dataRow.customLow
  return 0
}

/**
 * 计算组合总资产市值（动态遍历所有持仓标的）
 * 使用收盘价估值（用于策略计算）
 */
export const calcTotalAssets = (
  shares: Record<string, number>,
  cashBalance: number,
  dataRow: MarketDataRow,
): number => {
  let total = cashBalance
  for (const [ticker, qty] of Object.entries(shares)) {
    if (qty > 0) {
      const price = getTickerClose(dataRow, ticker)
      total += qty * price
    }
  }
  return total
}

/**
 * 计算组合总资产市值（使用低价，用于保证金评估）
 */
export const calcTotalAssetsLow = (
  shares: Record<string, number>,
  cashBalance: number,
  dataRow: MarketDataRow,
): number => {
  let total = cashBalance
  for (const [ticker, qty] of Object.entries(shares)) {
    if (qty > 0) {
      const price = getTickerLow(dataRow, ticker)
      total += qty * price
    }
  }
  return total
}

/**
 * 计算组合 Beta（相对 QQQ）
 * QQQ leverageMultiplier=1, QLD=2, TQQQ/自定义3倍=3
 */
const calcBeta = (
  shares: Record<string, number>,
  dataRow: MarketDataRow,
  netEquity: number,
): number => {
  if (netEquity <= 0) return 0
  const leverageMap: Record<string, number> = {
    QQQ: 1,
    QLD: 2,
    TQQQ: 3,
  }
  let betaWeightedSum = 0
  for (const [ticker, qty] of Object.entries(shares)) {
    if (qty > 0) {
      const price = getTickerLow(dataRow, ticker)
      const val = qty * price
      // TQQQ 已在 leverageMap，其他自定义标的默认按1倍计算
      const lev = leverageMap[ticker] ?? 1
      betaWeightedSum += val * lev
    }
  }
  return betaWeightedSum / netEquity
}

export const runBacktest = (
  marketData: MarketDataRow[],
  strategyFunc: StrategyFunction,
  config: AssetConfig,
  strategyName: string,
  color: string = '#000000',
): SimulationResult => {
  const history: PortfolioState[] = []

  // 初始空仓状态（shares 使用 Record 支持任意标的）
  let currentState: PortfolioState = {
    date: marketData[0].date,
    shares: { QQQ: 0, QLD: 0, CUSTOM: 0 }, // 保留 CUSTOM 向下兼容
    cashBalance: 0,
    debtBalance: 0,
    accruedInterest: 0,
    totalValue: 0,
    strategyMemory: {},
    ltv: 0,
    beta: 0,
    events: [],
  }

  const monthlyCashYieldRate = Math.pow(1 + config.cashYieldAnnual / 100, 1 / 12) - 1

  // 债务配置
  const leverage = {
    ...config.leverage,
    qqqPledgeRatio: config.leverage?.qqqPledgeRatio ?? 0.7,
    qldPledgeRatio: config.leverage?.qldPledgeRatio ?? 0.0,
    cashPledgeRatio: config.leverage?.cashPledgeRatio ?? 0.95,
    ltvBasis: config.leverage?.ltvBasis ?? 'TOTAL_ASSETS',
  }

  const monthlyLoanRate = leverage.enabled
    ? Math.pow(1 + leverage.interestRate / 100, 1 / 12) - 1
    : 0

  let isBankrupt = false
  let bankruptcyDate: string | null = null

  for (let index = 0; index < marketData.length; index++) {
    const dataRow = marketData[index]
    const monthEvents: FinancialEvent[] = []

    if (isBankrupt) {
      history.push({
        ...currentState,
        date: dataRow.date,
        totalValue: 0,
        shares: { ...currentState.shares },
        ltv: 0,
        beta: 0,
        events: [{ type: 'INFO', description: 'Account Bankrupt' }],
      })
      continue
    }

    // 1. 银行计息：现金利息收入 & 债务利息计算
    if (index > 0) {
      // Step A: 现金利息收入
      const interestEarned = currentState.cashBalance * monthlyCashYieldRate
      if (interestEarned > 0.01) {
        currentState.cashBalance += interestEarned
        monthEvents.push({
          type: 'INTEREST_INC',
          amount: interestEarned,
          description: `Cash Interest (+${(config.cashYieldAnnual / 12).toFixed(2)}%)`,
        })
      }

      // Step B: 计算债务利息
      let interestDue = 0
      if (leverage.enabled && currentState.debtBalance > 0) {
        interestDue = currentState.debtBalance * monthlyLoanRate
      }

      // Step C: 处理债务利息（三种模式）
      if (interestDue > 0) {
        const interestType = leverage.interestType || 'CAPITALIZED'

        if (interestType === 'MONTHLY') {
          // 按月现金支付，不足时资本化
          if (currentState.cashBalance >= interestDue) {
            currentState.cashBalance -= interestDue
            monthEvents.push({
              type: 'INTEREST_EXP',
              amount: -interestDue,
              description: `Loan Interest Paid by Cash`,
            })
          } else {
            const paidByCash = currentState.cashBalance
            const shortfall = interestDue - currentState.cashBalance
            if (paidByCash > 0) {
              monthEvents.push({
                type: 'INTEREST_EXP',
                amount: -paidByCash,
                description: `Loan Interest Paid by Cash (Partial)`,
              })
            }
            currentState.cashBalance = 0
            currentState.debtBalance += shortfall
            monthEvents.push({
              type: 'DEBT_INC',
              amount: shortfall,
              description: `Unpaid Interest Capitalized to Debt`,
            })
          }
        } else if (interestType === 'MATURITY') {
          // 到期支付：计入应计利息，不复利
          currentState.accruedInterest += interestDue
          monthEvents.push({
            type: 'INTEREST_EXP',
            amount: 0,
            description: `Interest Accrued (Not Paid)`,
          })
        } else if (interestType === 'CAPITALIZED') {
          // 复利资本化
          currentState.debtBalance += interestDue
          monthEvents.push({
            type: 'DEBT_INC',
            amount: interestDue,
            description: `Interest Capitalized to Debt (Compound)`,
          })
        }
      }
    }

    // 2. 执行投资策略
    const cashBeforeStrat = currentState.cashBalance
    const sharesBeforeStrat = { ...currentState.shares }

    // Clear events so strategy can push its own custom events for this month
    currentState.events = []
    currentState = strategyFunc(currentState, dataRow, config, index)

    // 检测交易（通过持仓变化推断）
    for (const ticker of new Set([
      ...Object.keys(sharesBeforeStrat),
      ...Object.keys(currentState.shares),
    ])) {
      const before = sharesBeforeStrat[ticker] ?? 0
      const after = currentState.shares[ticker] ?? 0
      const diff = after - before
      if (Math.abs(diff) > 0.001) {
        const price = getTickerClose(dataRow, ticker)
        if (price > 0) {
          const cost = diff * price
          monthEvents.push({
            type: 'TRADE',
            amount: -cost,
            description: `${diff > 0 ? 'Buy' : 'Sell'} ${Math.abs(diff).toFixed(2)} ${ticker} @ ${price.toFixed(2)}`,
          })
        }
      }
    }

    // 检测 DCA 入金（近似：买入后现金变化 > 净交易成本，差额为外部资金流入）
    let netTradeCost = 0
    for (const ticker of Object.keys(currentState.shares)) {
      const before = sharesBeforeStrat[ticker] ?? 0
      const after = currentState.shares[ticker] ?? 0
      const diff = after - before
      const price = getTickerClose(dataRow, ticker)
      netTradeCost += diff * price
    }
    const impliedCashFlow = currentState.cashBalance - cashBeforeStrat + netTradeCost
    if (impliedCashFlow > 1.0) {
      monthEvents.push({
        type: 'DEPOSIT',
        amount: impliedCashFlow,
        description: 'Recurring Contribution / Deposit',
      })
    }

    // 3. 杠杆/质押逻辑（借款、提取 & 偿债检查）
    if (leverage.enabled) {
      const currentMonth = parseInt(dataRow.date.substring(5, 7)) - 1

      // 使用低价进行保证金评估
      const qqqValue = getShareValue(currentState.shares, 'QQQ', dataRow.qqqLow)
      const qldValue = getShareValue(currentState.shares, 'QLD', dataRow.qldLow)
      const cashValue = currentState.cashBalance

      // 计算自定义标的总市值（低价）
      let customAssetsLowValue = 0
      for (const [ticker, qty] of Object.entries(currentState.shares)) {
        if (ticker !== 'QQQ' && ticker !== 'QLD' && ticker !== 'CUSTOM' && qty > 0) {
          const price = getTickerLow(dataRow, ticker)
          customAssetsLowValue += qty * price
        }
      }
      // 向下兼容旧 CUSTOM 单标的
      const legacyCustomLow = dataRow.customLow && dataRow.customLow > 0
        ? (currentState.shares['CUSTOM'] ?? 0) * dataRow.customLow
        : 0
      customAssetsLowValue += legacyCustomLow

      const totalAssetValue = qqqValue + qldValue + customAssetsLowValue + cashValue

      const effectiveCollateral =
        qqqValue * leverage.qqqPledgeRatio +
        cashValue * leverage.cashPledgeRatio +
        qldValue * leverage.qldPledgeRatio

      // 年度提取（首月 or 每年1月）
      const isWithdrawalTiming = index === 0 || currentMonth === 0

      if (isWithdrawalTiming && effectiveCollateral > 0) {
        let borrowAmount = 0
        if (leverage.withdrawType === 'PERCENT') {
          borrowAmount = totalAssetValue * (leverage.withdrawValue / 100)
        } else {
          const yearsPassed = Math.floor(index / 12)
          const inflationFactor = Math.pow(1 + (leverage.inflationRate || 0) / 100, yearsPassed)
          borrowAmount = leverage.withdrawValue * inflationFactor
        }

        if (borrowAmount > 0) {
          currentState.debtBalance += borrowAmount
          monthEvents.push({
            type: 'WITHDRAW',
            amount: -borrowAmount,
            description: index === 0 ? `Initial Loan Withdrawal` : `Annual Living Expense Withdrawal`,
          })
          monthEvents.push({
            type: 'DEBT_INC',
            amount: borrowAmount,
            description: `Borrowing increased for withdrawal`,
          })
        }
      }

      // 偿债能力检查（LTV）
      if (effectiveCollateral > 0) {
        const totalLiability = currentState.debtBalance + currentState.accruedInterest
        const ltvDenominator =
          leverage.ltvBasis === 'COLLATERAL' ? effectiveCollateral : totalAssetValue

        currentState.ltv = ltvDenominator > 0 ? (totalLiability / ltvDenominator) * 100 : 9999
      } else {
        currentState.ltv = currentState.debtBalance + currentState.accruedInterest > 0 ? 9999 : 0
      }

      // 触发爆仓
      if (currentState.ltv > leverage.maxLtv) {
        isBankrupt = true
        bankruptcyDate = dataRow.date
        currentState.totalValue = 0
        monthEvents.push({
          type: 'INFO',
          description: `!!! MARGIN CALL / LIQUIDATION (LTV: ${currentState.ltv.toFixed(1)}%) !!!`,
        })
      }
    }

    // 现金余额为负时触发爆仓
    if (!isBankrupt && currentState.cashBalance < -0.01) {
      isBankrupt = true
      bankruptcyDate = dataRow.date
      currentState.totalValue = 0
      monthEvents.push({
        type: 'INFO',
        description: `!!! BANKRUPTCY: Negative Cash Balance (${currentState.cashBalance.toFixed(2)}) !!!`,
      })
    }

    // 4. 净值更新（使用低价保守估值）
    if (!isBankrupt) {
      const totalAssetsLow = calcTotalAssetsLow(
        currentState.shares,
        currentState.cashBalance,
        dataRow,
      )
      // 向下兼容：加上旧 CUSTOM 单标的的低价估值
      // （已在 calcTotalAssetsLow 中处理 CUSTOM key，但旧数据 customLow 字段需额外兼容）
      const legacyCustomVal =
        dataRow.customLow && dataRow.customLow > 0 && !dataRow.customLows
          ? (currentState.shares['CUSTOM'] ?? 0) * dataRow.customLow
          : 0
      const assets = totalAssetsLow + legacyCustomVal

      currentState.totalValue = Math.max(
        0,
        assets - currentState.debtBalance - currentState.accruedInterest,
      )

      // Beta 计算（PRD：TQQQ leverageMultiplier=3）
      currentState.beta = calcBeta(currentState.shares, dataRow, currentState.totalValue)
    }

    // 5. 记录历史
    history.push({
      ...currentState,
      shares: { ...currentState.shares },
      strategyMemory: { ...currentState.strategyMemory },
      events: [...monthEvents, ...(currentState.events || [])],
    })
  }

  // 计算绩效指标
  const years = marketData.length / 12
  const finalState = history[history.length - 1]
  const initialInv = config.initialCapital

  const cagr = isBankrupt ? -100 : calculateCAGR(initialInv, finalState.totalValue, years)
  const mdd = calculateMaxDrawdown(history)
  const irr = isBankrupt
    ? -100
    : calculateIRR(
        initialInv,
        config.contributionAmount,
        config.contributionIntervalMonths,
        finalState.totalValue,
        marketData.length,
      )

  const metrics = {
    finalBalance: finalState.totalValue,
    cagr,
    maxDrawdown: mdd,
    sharpeRatio: calculateSharpeRatio(history, config.cashYieldAnnual),
    irr,
    realFinalBalance: calculateRealValue(
      finalState.totalValue,
      years,
      config.leverage.inflationRate || 0,
    ),
    maxRecoveryMonths: calculateMaxRecoveryTime(history),
    worstYearReturn: Math.min(...calculateAnnualReturns(history).map((r) => r.return), 0),
    painIndex: calculateUlcerIndex(history),
    calmarRatio: mdd > 0 ? (isBankrupt ? -100 : irr / mdd) : 0,
    inflationRate: config.leverage.inflationRate,
  }

  return {
    strategyName,
    color,
    isLeveraged: config.leverage.enabled,
    history,
    isBankrupt,
    bankruptcyDate,
    metrics,
  }
}
