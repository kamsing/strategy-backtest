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
import { resolveMarketPhase, resolveCyclePhase, resolveSidewaysMonths, getMarketPhaseConfig } from './marketCycleService'

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
    // v1.1 新增：初始化市场阶段与周期
    marketPhase: 'PHASE_INITIAL',
    cyclePhase: 'CYCLE_NEW_HIGH',
    drawdownFromAth: 0,
    ath: 0,
  }


  // 债务配置
  const leverage = {
    ...config.leverage,
    qqqPledgeRatio: config.leverage?.qqqPledgeRatio ?? 0.7,
    qldPledgeRatio: config.leverage?.qldPledgeRatio ?? 0.0,
    cashPledgeRatio: config.leverage?.cashPledgeRatio ?? 0.95,
    ltvBasis: config.leverage?.ltvBasis ?? 'TOTAL_ASSETS',
  }

  // 利率计算调整为日利率 (Issue #1)
  const dailyCashYieldRate = Math.pow(1 + config.cashYieldAnnual / 100, 1 / 365) - 1
  const dailyLoanRate = leverage.enabled
    ? Math.pow(1 + leverage.interestRate / 100, 1 / 365) - 1
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

    const prevDateStr = index > 0 ? marketData[index - 1].date : null
    const isNewMonth = index === 0 || (prevDateStr !== null && dataRow.date.substring(0, 7) !== prevDateStr.substring(0, 7))
    const daysDiff = index > 0 && prevDateStr !== null 
      ? Math.max(1, Math.round((new Date(dataRow.date).getTime() - new Date(prevDateStr).getTime()) / (1000 * 3600 * 24)))
      : 0

    // 1. 银行计息：现金利息收入 & 债务利息计算
    if (index > 0) {

      // Step A: 现金利息收入 (按天复利)
      const interestEarned = currentState.cashBalance * (Math.pow(1 + dailyCashYieldRate, daysDiff) - 1)
      if (interestEarned > 0.01) {
        currentState.cashBalance += interestEarned
        monthEvents.push({
          type: 'INTEREST_INC',
          amount: interestEarned,
          date: dataRow.date,
          description: `Cash Interest (Daily Compound x${daysDiff})`,
        })
      }

      // Step B: 计算债务利息
      let interestDue = 0
      if (leverage.enabled && currentState.debtBalance > 0) {
        interestDue = currentState.debtBalance * (Math.pow(1 + dailyLoanRate, daysDiff) - 1)
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

    // 清除上个数据点的临时事件
    currentState.events = []
    currentState = strategyFunc(currentState, dataRow, config, index)

    // 2.5 检测交易（通过持仓变化推断）
    // 策略自身已推送的 TRADE/ROTATION/PLEDGE 事件不重复统计
    const hasExplicitTrade = currentState.events?.some(
      (e) => e.type === 'ROTATION_IN' || e.type === 'ROTATION_OUT' || e.type === 'PLEDGE_BORROW' || e.type === 'PLEDGE_REPAY'
    ) ?? false

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
          // 如果策略已推送该标的的 ROTATION/PLEDGE 事件，跳过重复 TRADE 事件
          const alreadyCovered = hasExplicitTrade && currentState.events?.some(
            (e) =>
              (e.type === 'ROTATION_IN' || e.type === 'ROTATION_OUT' ||
               e.type === 'PLEDGE_BORROW' || e.type === 'PLEDGE_REPAY') &&
              (e.ticker === ticker || !e.ticker)
          )
          if (!alreadyCovered) {
            monthEvents.push({
              type: 'TRADE',
              amount: -cost,
              ticker,                    // PRD §5.1：补充标的代码
              sharesChanged: diff,       // PRD §5.1：补充股数变化
              description: `${diff > 0 ? 'Buy' : 'Sell'} ${Math.abs(diff).toFixed(2)} ${ticker} @ ${price.toFixed(2)}`,
            })
          }
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
    // 仅在跨月时记录定投事件，避免每日数据下的重复显示
    if (isNewMonth && impliedCashFlow > 1.0) {
      monthEvents.push({
        type: 'DEPOSIT',
        amount: impliedCashFlow,
        description: 'Monthly Recurring Contribution',
      })
    }

    // 3. 杠杆/质押逻辑（借款、提取 & 偿债检查）
    if (leverage.enabled) {
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

      // 提取生活费逻辑：仅在跨月时触发 (PRD §4.3)
      if (isNewMonth && index > 0 && leverage.withdrawValue > 0) {
        const currDate = new Date(dataRow.date)
        const currentMonth = currDate.getUTCMonth()
        
        // 年度提取（每年 1 月或首月）
        const isWithdrawalTiming = index === 0 || currentMonth === 0
        
        if (isWithdrawalTiming) {
          // 估算年限 (处理每日数据或每月数据)
          const yearsPassed = Math.floor(index / (marketData.length / 25)) // 粗略估算
          let borrowAmount = 0
          
          if (leverage.withdrawType === 'PERCENT') {
            borrowAmount = totalAssetValue * (leverage.withdrawValue / 100)
          } else if (leverage.withdrawType === 'FIXED') {
            borrowAmount = leverage.withdrawValue
          } else if (leverage.withdrawType === 'INFLATION_ADJUSTED') {
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

    // 5. 市场周期与阶段解析 (PRD v1.1 §7.1)
    if (!isBankrupt) {
      // 更新 ATH
      const currentAth = Math.max(currentState.ath || 0, currentState.totalValue)
      
      // 计算距 ATH 跌幅
      const drawdownFromAth = currentAth > 0
        ? (currentState.totalValue / currentAth) - 1
        : 0
      
      // 计算距低点涨幅（需维护 trough 在 strategyMemory 或本地变量，这里从历史中简单推导或使用 memory）
      let trough = (currentState.strategyMemory.cycleTrough as number) ?? currentState.totalValue
      if (currentState.totalValue < trough) {
        trough = currentState.totalValue
        currentState.strategyMemory.cycleTrough = trough
      }
      const recoveryFromTrough = trough > 0
        ? (currentState.totalValue / trough) - 1
        : 0
      
      // 计算横盘月数
      const sidewaysMonths = resolveSidewaysMonths(history, index)
      
      // 解析阶段
      currentState.marketPhase = resolveMarketPhase(drawdownFromAth, recoveryFromTrough, index === 0, sidewaysMonths)
      currentState.cyclePhase = resolveCyclePhase(drawdownFromAth, recoveryFromTrough, currentAth, currentState.totalValue, currentState.cyclePhase || 'CYCLE_NEW_HIGH')
      currentState.ath = currentAth
      currentState.drawdownFromAth = drawdownFromAth

      // v1.1 §4.4：通知触发逻辑
      const lastNotified = currentState.strategyMemory.lastNotifiedPhase as string
      const highPriorityPhases = new Set([
        'PHASE_ALERT', 'PHASE_CORRECTION', 'PHASE_BEAR', 
        'PHASE_FINANCIAL_CRISIS', 'PHASE_FINANCIAL_STORM', 'PHASE_CATASTROPHE',
        'PHASE_NEW_ATH', 'PHASE_EUPHORIA'
      ])

      if (currentState.marketPhase !== lastNotified && highPriorityPhases.has(currentState.marketPhase)) {
        const phaseConfig = getMarketPhaseConfig(currentState.marketPhase)
        monthEvents.push({
          type: 'ALERT_SENT',
          date: dataRow.date,
          description: `${phaseConfig.emoji} 系统通知：市场进入 ${phaseConfig.label} 阶段`,
          marketPhase: currentState.marketPhase,
        })
        currentState.strategyMemory.lastNotifiedPhase = currentState.marketPhase
      }
    }

    // 6. 推导分组标签（PRD §5.3 - 兼容 v1.0）
    const bp = (currentState.strategyMemory.bearPhase as number) ?? 0
    const rp = (currentState.strategyMemory.recoveryPhase as number) ?? 0
    const hwmVal = (currentState.strategyMemory.hwm as number) ?? Infinity
    let groupLabel: string
    if (bp > 0) {
      groupLabel = '下跌加码'
    } else if (rp > 0) {
      groupLabel = '上涨减码'
    } else if (currentState.totalValue < hwmVal && hwmVal !== Infinity) {
      groupLabel = '回到高点'
    } else {
      groupLabel = '正常运行'
    }

    // 7. 记录历史
    const finalEvents = [...monthEvents, ...(currentState.events || [])].map(evt => ({
      ...evt,
      date: evt.date || dataRow.date, // 确保所有事件都有日期
      marketPhase: evt.marketPhase || currentState.marketPhase, // 注入当前市场阶段
    }))

    history.push({
      ...currentState,
      shares: { ...currentState.shares },
      strategyMemory: { ...currentState.strategyMemory },
      events: finalEvents,
      groupLabel,
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
