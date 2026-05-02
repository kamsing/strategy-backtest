import { AssetConfig, PortfolioState, StrategyFunction, StrategyType, getShares } from '../types'
import { getTickerClose } from './simulationEngine'

interface CashAdequacyResult {
  isAdequate: boolean
  shortfall: number
  targetCash: number
}

const getAssetAllocation = (config: AssetConfig) => {
  // 如果启用自定义标的，现金权重 = 100 - QQQ - QLD - CUSTOM
  const customWeight = config.customWeight ?? 0
  const cashWeight = Math.max(0, 100 - config.qqqWeight - config.qldWeight - customWeight)
  return {
    qqq: config.qqqWeight / 100,
    qld: config.qldWeight / 100,
    custom: customWeight / 100,
    cash: cashWeight / 100,
  }
}

interface StrategyMemory {
  currentYear?: number
  yearInflow?: number
  startQLDVal?: number
  lastAction?: string
  highWaterMark?: number
  currentState?: number
}

const getContributionAllocation = (config: AssetConfig) => {
  // 定投现金权重 = 100 - QQQ - QLD - CUSTOM
  const customWeight = config.contributionCustomWeight ?? 0
  const cashWeight = Math.max(
    0,
    100 - config.contributionQqqWeight - config.contributionQldWeight - customWeight,
  )
  return {
    qqq: config.contributionQqqWeight / 100,
    qld: config.contributionQldWeight / 100,
    custom: customWeight / 100,
    cash: cashWeight / 100,
  }
}

/**
 * Strategy: No Rebalancing (Buy & Hold + DCA)
 * T=0: Buy based on PORTFOLIO weights (Initial Capital).
 * T>0: Buy using contribution amount based on CONTRIBUTION weights.
 * No yearly rebalancing is performed.
 */
export const strategyNoRebalance: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  // 确保 shares.CUSTOM 字段存在（向后兼容旧数据）
  const newState = { ...state, date: marketData.date, shares: { ...state.shares, CUSTOM: state.shares['CUSTOM'] ?? 0 } as Record<string, number> }

  // 判断是否有自定义标的以及是否有价格数据
  const hasCustom = (config.customWeight ?? 0) > 0 && marketData.customClose && marketData.customClose > 0
  const customClosePrice = marketData.customClose ?? 0

  if (isFirstMonth) {
    const weights = getAssetAllocation(config)
    newState.shares = {
      QQQ: (config.initialCapital * weights.qqq) / marketData.qqqClose,
      QLD: (config.initialCapital * weights.qld) / marketData.qldClose,
      // 自定义标的：有权重且有价格时才买入
      CUSTOM: hasCustom ? (config.initialCapital * weights.custom) / customClosePrice : 0,
    }
    newState.cashBalance = config.initialCapital * weights.cash
  } else {
    // 定投逻辑：检查当月是否为定投月
    const currentMonth = parseInt(marketData.date.substring(5, 7)) // 1-12

    let isContributionMonth = false
    if (config.contributionIntervalMonths === 12) {
      // 年度定投：匹配指定月份
      isContributionMonth = currentMonth === (config.yearlyContributionMonth || 12)
    } else {
      // 月度/季度：取模逻辑
      isContributionMonth = monthIndex % config.contributionIntervalMonths === 0
    }

    if (isContributionMonth) {
      const contribWeights = getContributionAllocation(config)

      const qqqBuy = config.contributionAmount * contribWeights.qqq
      const qldBuy = config.contributionAmount * contribWeights.qld
      const customBuy = config.contributionAmount * contribWeights.custom
      const cashAdd = config.contributionAmount * contribWeights.cash

      newState.shares.QQQ += qqqBuy / marketData.qqqClose
      newState.shares.QLD += qldBuy / marketData.qldClose
      // 自定义标的定投
      if (hasCustom && customBuy > 0) {
        newState.shares.CUSTOM += customBuy / customClosePrice
      }
      newState.cashBalance += cashAdd
    }
  }

  const customValue = hasCustom ? newState.shares.CUSTOM * customClosePrice : 0
  newState.totalValue =
    newState.shares.QQQ * marketData.qqqClose +
    newState.shares.QLD * marketData.qldClose +
    customValue +
    newState.cashBalance

  return newState
}

/**
 * Strategy: Yearly Rebalancing
 * Standard DCA (using contrib weights), but rebalances to PORTFOLIO weights in January.
 */
export const strategyRebalance: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  const newState = strategyNoRebalance(state, marketData, config, monthIndex) // 先执行基础逻辑

  const currentMonth = parseInt(marketData.date.substring(5, 7)) - 1

  // 每年1月进行再平衡（不包括模拟第一个月）
  if (currentMonth === 0 && !isFirstMonth) {
    const totalVal = newState.totalValue
    const targetWeights = getAssetAllocation(config)
    const hasCustom =
      (config.customWeight ?? 0) > 0 && marketData.customClose && marketData.customClose > 0
    const customClosePrice = marketData.customClose ?? 0

    // 按目标权重重置持仓
    newState.shares.QQQ = (totalVal * targetWeights.qqq) / marketData.qqqClose
    newState.shares.QLD = (totalVal * targetWeights.qld) / marketData.qldClose
    // 自定义标的再平衡
    newState.shares.CUSTOM =
      hasCustom ? (totalVal * targetWeights.custom) / customClosePrice : 0
    newState.cashBalance = totalVal * targetWeights.cash
  }

  return newState
}

/**
 * Strategy: Smart Adjust
 * Complex logic using strategyMemory: harvests profits in bull markets and buys dips.
 */
export const strategySmart: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0

  // 1. Initialize or copy memory
  const memory = { ...(state.strategyMemory as unknown as StrategyMemory) }
  const currentYear = parseInt(marketData.date.substring(0, 4))
  const currentMonth = parseInt(marketData.date.substring(5, 7)) - 1

  // 2. Handle Year Transition / Init
  if (isFirstMonth || memory.currentYear !== currentYear) {
    memory.currentYear = currentYear
    memory.yearInflow = 0

    if (!isFirstMonth) {
      memory.startQLDVal = state.shares.QLD * marketData.qldClose
    }
  }

  // 3. Apply Base Logic (No Rebalance)
  const newState = strategyNoRebalance(state, marketData, config, monthIndex)

  // If this was the first month, set the tracking var now that shares are bought
  if (isFirstMonth) {
    memory.startQLDVal = newState.shares.QLD * marketData.qldClose
  }

  // Track inflow into QLD specifically for the logic "QLD Profit"
  const contribWeights = getContributionAllocation(config)
  // Check if we actually contributed this month
  const isContributionMonth = !isFirstMonth && monthIndex % config.contributionIntervalMonths === 0
  const qldContribution = isContributionMonth ? config.contributionAmount * contribWeights.qld : 0

  memory.yearInflow = (memory.yearInflow || 0) + qldContribution

  // 4. End of Year Check (December)
  if (currentMonth === 11) {
    const currentQLDVal = newState.shares.QLD * marketData.qldClose
    // Profit = EndingValue - (StartingValue + Costs)
    const profit = currentQLDVal - ((memory.startQLDVal || 0) + (memory.yearInflow || 0))

    if (profit > 0) {
      // Rule: Sell 1/3 of Profit -> Cash
      const sellAmount = profit / 3
      const sharesToSell = sellAmount / marketData.qldClose

      newState.shares.QLD = Math.max(0, newState.shares.QLD - sharesToSell)
      newState.cashBalance += sellAmount

      memory.lastAction = `Sold Profit ${sellAmount.toFixed(2)}`
    } else {
      // Rule: Buy 2% of Total Portfolio Value using Cash
      const buyAmount = newState.totalValue * 0.02

      // Can only buy if we have cash
      const actualBuyAmount = Math.min(buyAmount, newState.cashBalance)

      if (actualBuyAmount > 0) {
        const sharesToBuy = actualBuyAmount / marketData.qldClose
        newState.shares.QLD += sharesToBuy
        newState.cashBalance = Math.max(0, newState.cashBalance - actualBuyAmount)
        memory.lastAction = `Bought Dip ${actualBuyAmount.toFixed(2)}`
      }
    }
  }

  const customValue =
    marketData.customClose && marketData.customClose > 0
      ? (newState.shares.CUSTOM ?? 0) * marketData.customClose
      : 0
  newState.totalValue =
    newState.shares.QQQ * marketData.qqqClose +
    newState.shares.QLD * marketData.qldClose +
    customValue +
    newState.cashBalance

  newState.strategyMemory = memory
  return newState
}

const checkCashAdequacy = (state: PortfolioState, config: AssetConfig): CashAdequacyResult => {
  // Use configured annual expense amount, or default to 2% of initial capital if not set
  const annualExpense = config.annualExpenseAmount ?? config.initialCapital * 0.02
  const coverageYears = config.cashCoverageYears ?? 15
  const targetCash = annualExpense * coverageYears

  return {
    isAdequate: state.cashBalance >= targetCash,
    shortfall: Math.max(0, targetCash - state.cashBalance),
    targetCash,
  }
}

/**
 * Strategy: Flexible Rebalancing - Defensive (Type 1)
 * Priority: Maintain 15 years of cash buffer.
 * If Cash < Target:
 *  - Bull (QLD Profit > 0): Sell 1/3 Profit -> Cash.
 *  - Bear (QLD Profit <= 0): Sell 2% Total Value from QQQ -> Buy QLD.
 * If Cash >= Target:
 *  - Switch to Smart Rebalance logic (Sell QLD Profit -> Cash / Buy Dip).
 */
export const strategyFlexible1: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  const memory = { ...(state.strategyMemory as unknown as StrategyMemory) }
  const currentYear = parseInt(marketData.date.substring(0, 4))
  const currentMonth = parseInt(marketData.date.substring(5, 7)) - 1

  // Init Memory Logic same as Smart Strategy
  if (isFirstMonth || memory.currentYear !== currentYear) {
    memory.currentYear = currentYear
    memory.yearInflow = 0
    if (!isFirstMonth) {
      memory.startQLDVal = state.shares.QLD * marketData.qldClose
    }
  }

  // Apply Base Logic
  const newState = strategyNoRebalance(state, marketData, config, monthIndex)

  if (isFirstMonth) {
    memory.startQLDVal = newState.shares.QLD * marketData.qldClose
  }

  // Track Inflow
  const contribWeights = getContributionAllocation(config)
  const isContributionMonth = !isFirstMonth && monthIndex % config.contributionIntervalMonths === 0
  const qldContribution = isContributionMonth ? config.contributionAmount * contribWeights.qld : 0
  memory.yearInflow = (memory.yearInflow || 0) + qldContribution

  // End of Year Logic
  if (currentMonth === 11) {
    const { isAdequate } = checkCashAdequacy(newState, config)
    const currentQLDVal = newState.shares.QLD * marketData.qldClose
    const profit = currentQLDVal - ((memory.startQLDVal || 0) + (memory.yearInflow || 0))

    if (!isAdequate) {
      // Defensive Mode
      if (profit > 0) {
        // Bull: Sell 1/3 QLD Profit -> Cash
        const sellAmount = profit / 3
        const sharesToSell = sellAmount / marketData.qldClose
        newState.shares.QLD = Math.max(0, newState.shares.QLD - sharesToSell)
        newState.cashBalance += sellAmount
        memory.lastAction = `Defensive: Harvest Cash ${sellAmount.toFixed(0)}`
      } else {
        // Bear: Sell 2% Total Value (QQQ) -> Buy QLD
        const transferAmount = newState.totalValue * 0.02
        const qqqVal = newState.shares.QQQ * marketData.qqqClose

        // Cap at available QQQ
        const actualTransfer = Math.min(transferAmount, qqqVal)

        if (actualTransfer > 0) {
          const qqqSharesToSell = actualTransfer / marketData.qqqClose
          const qldSharesToBuy = actualTransfer / marketData.qldClose

          newState.shares.QQQ = Math.max(0, newState.shares.QQQ - qqqSharesToSell)
          newState.shares.QLD += qldSharesToBuy
          memory.lastAction = `Defensive: Rebalance QQQ->QLD ${actualTransfer.toFixed(0)}`
        }
      }
    } else {
      // Cash Adequate -> Smart Rebalance Logic
      // Note: "Smart" normally sells profit to Cash or buys dip with Cash.
      // Since we have adequate cash, this is fine.
      if (profit > 0) {
        const sellAmount = profit / 3
        const sharesToSell = sellAmount / marketData.qldClose
        newState.shares.QLD = Math.max(0, newState.shares.QLD - sharesToSell)
        newState.cashBalance += sellAmount
        memory.lastAction = `Adequate: Smart Profit ${sellAmount.toFixed(0)}`
      } else {
        const buyAmount = newState.totalValue * 0.02
        const actualBuyAmount = Math.min(buyAmount, newState.cashBalance)
        if (actualBuyAmount > 0) {
          const sharesToBuy = actualBuyAmount / marketData.qldClose
          newState.shares.QLD += sharesToBuy
          newState.cashBalance = Math.max(0, newState.cashBalance - actualBuyAmount)
          memory.lastAction = `Adequate: Smart Dip ${actualBuyAmount.toFixed(0)}`
        }
      }
    }
  }

  // 重新计算总资产（含自定义标的）
  const customValue1 =
    marketData.customClose && marketData.customClose > 0
      ? (newState.shares.CUSTOM ?? 0) * marketData.customClose
      : 0
  newState.totalValue =
    newState.shares.QQQ * marketData.qqqClose +
    newState.shares.QLD * marketData.qldClose +
    customValue1 +
    newState.cashBalance

  newState.strategyMemory = memory
  return newState
}

/**
 * Strategy: Flexible Rebalancing - Aggressive (Type 2)
 * Priority: Maintain 15 years of cash buffer.
 * If Cash < Target:
 *  - Fallback to Flexible Type 1 (Defensive) behavior.
 * If Cash >= Target:
 *  - Bull (QLD Profit > 0): Sell 1/3 Profit -> Buy QQQ (NOT Cash).
 *  - Bear (QLD Profit <= 0): Smart Rebalance (Buy QLD Dip with Cash).
 */
export const strategyFlexible2: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  const memory = { ...(state.strategyMemory as unknown as StrategyMemory) }
  const currentYear = parseInt(marketData.date.substring(0, 4))
  const currentMonth = parseInt(marketData.date.substring(5, 7)) - 1

  if (isFirstMonth || memory.currentYear !== currentYear) {
    memory.currentYear = currentYear
    memory.yearInflow = 0
    if (!isFirstMonth) {
      memory.startQLDVal = state.shares.QLD * marketData.qldClose
    }
  }

  const newState = strategyNoRebalance(state, marketData, config, monthIndex)

  if (isFirstMonth) {
    memory.startQLDVal = newState.shares.QLD * marketData.qldClose
  }

  const contribWeights = getContributionAllocation(config)
  const isContributionMonth = !isFirstMonth && monthIndex % config.contributionIntervalMonths === 0
  const qldContribution = isContributionMonth ? config.contributionAmount * contribWeights.qld : 0
  memory.yearInflow = (memory.yearInflow || 0) + qldContribution

  if (currentMonth === 11) {
    const { isAdequate } = checkCashAdequacy(newState, config)
    const currentQLDVal = newState.shares.QLD * marketData.qldClose
    const profit = currentQLDVal - ((memory.startQLDVal || 0) + (memory.yearInflow || 0))

    if (!isAdequate) {
      // Fallback to Defensive (Same as Flex 1)
      if (profit > 0) {
        const sellAmount = profit / 3
        const sharesToSell = sellAmount / marketData.qldClose
        newState.shares.QLD -= sharesToSell
        newState.cashBalance += sellAmount
        memory.lastAction = `Defensive: Harvest Cash ${sellAmount.toFixed(0)}`
      } else {
        const transferAmount = newState.totalValue * 0.02
        const qqqVal = newState.shares.QQQ * marketData.qqqClose
        const actualTransfer = Math.min(transferAmount, qqqVal)

        if (actualTransfer > 0) {
          const qqqSharesToSell = actualTransfer / marketData.qqqClose
          const qldSharesToBuy = actualTransfer / marketData.qldClose
          newState.shares.QQQ = Math.max(0, newState.shares.QQQ - qqqSharesToSell)
          newState.shares.QLD += qldSharesToBuy
          memory.lastAction = `Defensive: Rebalance QQQ->QLD ${actualTransfer.toFixed(0)}`
        }
      }
    } else {
      // Aggressive Mode
      if (profit > 0) {
        // Bull: Sell 1/3 Profit -> Buy QQQ
        const sellAmount = profit / 3
        const sharesToSell = sellAmount / marketData.qldClose
        const sharesToBuyQQQ = sellAmount / marketData.qqqClose

        newState.shares.QLD -= sharesToSell
        newState.shares.QQQ += sharesToBuyQQQ
        // Cash remains unchanged
        memory.lastAction = `Aggressive: Profit to QQQ ${sellAmount.toFixed(0)}`
      } else {
        // Bear: Smart Rebalance (Buy Dip with Cash)
        const buyAmount = newState.totalValue * 0.02
        const actualBuyAmount = Math.min(buyAmount, newState.cashBalance)
        if (actualBuyAmount > 0) {
          const sharesToBuy = actualBuyAmount / marketData.qldClose
          newState.shares.QLD += sharesToBuy
          newState.cashBalance = Math.max(0, newState.cashBalance - actualBuyAmount)
          memory.lastAction = `Aggressive: Buy Dip ${actualBuyAmount.toFixed(0)}`
        }
      }
    }
  }

  const customValue2 =
    marketData.customClose && marketData.customClose > 0
      ? (newState.shares.CUSTOM ?? 0) * marketData.customClose
      : 0
  newState.totalValue =
    newState.shares.QQQ * marketData.qqqClose +
    newState.shares.QLD * marketData.qldClose +
    customValue2 +
    newState.cashBalance

  newState.strategyMemory = memory
  return newState
}

/**
 * Strategy: Dip Buying (5-State Machine)
 * Scale into QLD as QQQ drawdowns reach -10%, -20%, -30%, -40%, -50%
 */
export const strategyDipBuyingState: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  const memory = { ...(state.strategyMemory as unknown as StrategyMemory) }
  
  // Base Logic: Handle regular contributions to cash/assets initially
  const newState = strategyNoRebalance(state, marketData, config, monthIndex)
  
  // Monitor High Water Mark for QQQ Close Price
  const currentPrice = marketData.qqqClose
  
  if (isFirstMonth) {
    memory.highWaterMark = currentPrice
    memory.currentState = 0
  } else {
    if (currentPrice > (memory.highWaterMark || 0)) {
      memory.highWaterMark = currentPrice
    }
  }
  
  const hwm = memory.highWaterMark || currentPrice
  const drawdown = (hwm - currentPrice) / hwm
  
  // State Machine logic (Hardcoded default thresholds)
  let targetState = 0
  if (drawdown >= 0.50) targetState = 5
  else if (drawdown >= 0.40) targetState = 4
  else if (drawdown >= 0.30) targetState = 3
  else if (drawdown >= 0.20) targetState = 2
  else if (drawdown >= 0.10) targetState = 1
  
  const prevState = memory.currentState || 0
  memory.currentState = targetState
  
  // Determine if we need to rebalance portfolio due to state change or init
  if (targetState !== prevState || isFirstMonth) {
    const totalVal = newState.totalValue
    
    // Determine allocation based on state
    // If state = 0, use user config. If state > 0, override QLD
    let qldTargetWeight = config.qldWeight / 100
    if (targetState === 1) qldTargetWeight = Math.max(qldTargetWeight, 0.20)
    if (targetState === 2) qldTargetWeight = Math.max(qldTargetWeight, 0.40)
    if (targetState === 3) qldTargetWeight = Math.max(qldTargetWeight, 0.60)
    if (targetState === 4) qldTargetWeight = Math.max(qldTargetWeight, 0.80)
    if (targetState === 5) qldTargetWeight = Math.max(qldTargetWeight, 1.00)
    
    const cashTargetWeight =
      targetState === 0
        ? Math.max(
            0,
            100 - config.qqqWeight - config.qldWeight - (config.customWeight ?? 0),
          ) / 100
        : 0
    const qqqTargetWeight = Math.max(0, 1.0 - qldTargetWeight - cashTargetWeight)
    
    newState.shares.QLD = (totalVal * qldTargetWeight) / marketData.qldClose
    newState.shares.QQQ = (totalVal * qqqTargetWeight) / marketData.qqqClose
    newState.cashBalance = totalVal * cashTargetWeight
    
    if (!isFirstMonth) {
      if (targetState > prevState) {
        memory.lastAction = `Dip Buy: Entered State ${targetState} (DD: -${(drawdown*100).toFixed(1)}%)`
      } else if (targetState < prevState) {
        memory.lastAction = `Recovery: Reduced to State ${targetState} (DD: -${(drawdown*100).toFixed(1)}%)`
      }
    }
  }
  
  const customValueDip =
    marketData.customClose && marketData.customClose > 0
      ? (newState.shares.CUSTOM ?? 0) * marketData.customClose
      : 0
  newState.totalValue =
    newState.shares.QQQ * marketData.qqqClose +
    newState.shares.QLD * marketData.qldClose +
    customValueDip +
    newState.cashBalance

  newState.strategyMemory = memory
  return newState
}

// ============================================================
// 熊市策略共用的状态机内存结构（PRD B1/B2 共用）
// ============================================================
interface BearStrategyMemory extends StrategyMemory {
  hwm?: number // High Water Mark（原型基金历史最高收盘价）
  lwm?: number | null // Low Water Mark（从 HWM 下跌后的最低收盘价）
  bearPhase?: number // 熊市阶段 0-4（0=正常，1=-10%，2=-20%，3=-30%，4=-40%）
  recoveryPhase?: number // 反弹阶段 0-4（0=未反弹，1=+10%，2=+20%，3=+30%，4=+40%）
  alertSent5pct?: boolean // 是否已发送 -5% 预警
  mode?: 'normal' | 'bear' | 'recovery' // 当前策略模式
  pledgeBudget?: number // B2：熊市质押借款上限（进入熊市时总资产快照的 maxPledgeRatio）
  pledgeDebt?: number // B2：当前质押借款余额
  pledgeBatches?: Array<{ ticker: string; qty: number; price: number; phase: number }> // B2：各批次买入记录
}

/**
 * 共用工具：更新高水位/低水位，判断并返回当前熊市/反弹阶段
 */
const updateBearState = (
  memory: BearStrategyMemory,
  currentPrice: number,
  isFirstMonth: boolean,
): { bearPhase: number; recoveryPhase: number; mode: 'normal' | 'bear' | 'recovery'; bearPhaseChanged: boolean; recoveryPhaseChanged: boolean } => {
  // 初始化
  if (isFirstMonth || memory.hwm === undefined) {
    memory.hwm = currentPrice
    memory.lwm = null
    memory.bearPhase = 0
    memory.recoveryPhase = 0
    memory.alertSent5pct = false
    memory.mode = 'normal'
  }

  const prevBearPhase = memory.bearPhase ?? 0
  const prevRecoveryPhase = memory.recoveryPhase ?? 0
  const prevMode = memory.mode ?? 'normal'

  // HWM 单调递增（仅在正常模式下更新）
  if (prevMode === 'normal' && currentPrice > (memory.hwm ?? 0)) {
    memory.hwm = currentPrice
  }

  const hwm = memory.hwm ?? currentPrice
  const drawdown = (hwm - currentPrice) / hwm // 正值表示下跌幅度

  let newBearPhase = prevBearPhase
  let newRecoveryPhase = prevRecoveryPhase
  let newMode = prevMode

  if (prevMode !== 'recovery') {
    // 熊市阶段判断（只增不减）
    if (drawdown >= 0.40 && prevBearPhase < 4) newBearPhase = 4
    else if (drawdown >= 0.30 && prevBearPhase < 3) newBearPhase = 3
    else if (drawdown >= 0.20 && prevBearPhase < 2) newBearPhase = 2
    else if (drawdown >= 0.10 && prevBearPhase < 1) newBearPhase = 1

    if (newBearPhase > 0) {
      newMode = 'bear'
      // 追踪 LWM（进入熊市后记录最低价）
      if (memory.lwm === null || memory.lwm === undefined) {
        memory.lwm = currentPrice
      } else if (currentPrice < memory.lwm) {
        memory.lwm = currentPrice
      }
    }
  }

  // 从低点反弹判断（进入 recovery 模式）
  const lwm = memory.lwm
  if (prevMode === 'bear' && lwm !== null && lwm !== undefined && lwm > 0) {
    const recovery = (currentPrice - lwm) / lwm
    if (recovery >= 0.10) {
      newMode = 'recovery'
      // 反弹阶段（只增不减）
      if (recovery >= 0.40 && prevRecoveryPhase < 4) newRecoveryPhase = 4
      else if (recovery >= 0.30 && prevRecoveryPhase < 3) newRecoveryPhase = 3
      else if (recovery >= 0.20 && prevRecoveryPhase < 2) newRecoveryPhase = 2
      else if (recovery >= 0.10 && prevRecoveryPhase < 1) newRecoveryPhase = 1
    }
  } else if (prevMode === 'recovery' && lwm !== null && lwm !== undefined && lwm > 0) {
    const recovery = (currentPrice - lwm) / lwm
    // 反弹阶段继续递增
    if (recovery >= 0.40 && prevRecoveryPhase < 4) newRecoveryPhase = 4
    else if (recovery >= 0.30 && prevRecoveryPhase < 3) newRecoveryPhase = 3
    else if (recovery >= 0.20 && prevRecoveryPhase < 2) newRecoveryPhase = 2
    else if (recovery >= 0.10 && prevRecoveryPhase < 1) newRecoveryPhase = 1

    // recoveryPhase=4 时完全恢复，回归 normal
    if (newRecoveryPhase >= 4 && prevRecoveryPhase >= 4) {
      newMode = 'normal'
      memory.hwm = currentPrice // 更新 HWM
      memory.lwm = null
      newBearPhase = 0
      newRecoveryPhase = 0
    }
  }

  memory.bearPhase = newBearPhase
  memory.recoveryPhase = newRecoveryPhase
  memory.mode = newMode

  return {
    bearPhase: newBearPhase,
    recoveryPhase: newRecoveryPhase,
    mode: newMode,
    bearPhaseChanged: newBearPhase !== prevBearPhase,
    recoveryPhaseChanged: newRecoveryPhase !== prevRecoveryPhase,
  }
}

/**
 * Strategy: Bear Market Rotation (BEAR_ROTATION) - PRD B1
 * 熊市仓位转换型：市场下跌时将原型基金转换为3倍ETF，反弹时逐步换回。
 *
 * 触发阈值（基于 QQQ HWM）：
 * - 下跌10%→20%→30%→40%：依次将当前持仓的10%/20%/30%/40%转入3倍ETF
 * - 反弹10%→20%→30%→40%：依次将3倍ETF的10%/20%/30%/40%换回原型基金
 */
export const strategyBearRotation: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  const memory = { ...(state.strategyMemory as unknown as BearStrategyMemory) }

  // 先执行基础逻辑（定投）
  const newState = strategyNoRebalance(state, marketData, config, monthIndex)

  const currentPrice = marketData.qqqClose
  const { bearPhase, recoveryPhase, bearPhaseChanged, recoveryPhaseChanged } =
    updateBearState(memory, currentPrice, isFirstMonth)

  // 确定3倍ETF标的（默认 TQQQ）
  const tripleETF = config.bearRotation?.tripleETF ?? 'TQQQ'
  const tripleETFPrice = getTickerClose(marketData, tripleETF)

  if (!isFirstMonth && tripleETFPrice > 0) {
    if (bearPhaseChanged && bearPhase > 0) {
      // 按阶段比例将 QQQ 转入 3倍ETF
      const rotateRatios: Record<number, number> = { 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40 }
      const ratio = rotateRatios[bearPhase] ?? 0
      if (ratio > 0) {
        const qqqQty = getShares(newState.shares, 'QQQ')
        const sellQty = qqqQty * ratio
        if (sellQty > 0.001) {
          const sellValue = sellQty * marketData.qqqClose
          const buyQty = sellValue / tripleETFPrice
          newState.shares['QQQ'] = Math.max(0, qqqQty - sellQty)
          newState.shares[tripleETF] = (newState.shares[tripleETF] ?? 0) + buyQty
          memory.lastAction = `ROTATION_IN bearPhase=${bearPhase}: Sell ${sellQty.toFixed(2)} QQQ→${buyQty.toFixed(2)} ${tripleETF}`
          
          newState.events = newState.events || []
          newState.events.push({
            type: 'ROTATION_IN',
            amount: sellValue,
            description: `[Phase ${bearPhase}] Shifted ${sellQty.toFixed(2)} QQQ to ${buyQty.toFixed(2)} ${tripleETF}`,
          })
        }
      }
    }

    if (recoveryPhaseChanged && recoveryPhase > 0) {
      // 按阶段比例将 3倍ETF 换回 QQQ
      const recoveryRatios: Record<number, number> = { 1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40 }
      const ratio = recoveryRatios[recoveryPhase] ?? 0
      if (ratio > 0) {
        const tripleQty = getShares(newState.shares, tripleETF)
        const sellQty = tripleQty * ratio
        if (sellQty > 0.001) {
          const sellValue = sellQty * tripleETFPrice
          const buyQty = sellValue / marketData.qqqClose
          newState.shares[tripleETF] = Math.max(0, tripleQty - sellQty)
          newState.shares['QQQ'] = (newState.shares['QQQ'] ?? 0) + buyQty
          memory.lastAction = `ROTATION_OUT recoveryPhase=${recoveryPhase}: Sell ${sellQty.toFixed(2)} ${tripleETF}→${buyQty.toFixed(2)} QQQ`
          
          newState.events = newState.events || []
          newState.events.push({
            type: 'ROTATION_OUT',
            amount: sellValue,
            description: `[Recovery ${recoveryPhase}] Restored ${sellQty.toFixed(2)} ${tripleETF} back to ${buyQty.toFixed(2)} QQQ`,
          })
        }
      }
    }
  }

  // 重新计算总价值
  let total = newState.cashBalance
  for (const [ticker, qty] of Object.entries(newState.shares)) {
    if (qty > 0) {
      const price = getTickerClose(marketData, ticker)
      total += qty * price
    }
  }
  newState.totalValue = total
  newState.strategyMemory = memory
  return newState
}

/**
 * Strategy: Bear Market Pledge (BEAR_PLEDGE) - PRD B2
 * 熊市质押借款型：市场下跌时质押借款分批买入指定基金，反弹时分批卖出还款。
 *
 * 触发阈值：
 * - 下跌10%→20%→30%→40%：每档借入总资产净值的1%，买入指定基金
 * - 反弹10%→20%→30%→40%：对应批次平仓10%/20%/30%/40%，卖出还款
 */
export const strategyBearPledge: StrategyFunction = (state, marketData, config, monthIndex) => {
  const isFirstMonth = monthIndex === 0
  const memory = { ...(state.strategyMemory as unknown as BearStrategyMemory) }

  // 先执行基础逻辑（定投）
  const newState = strategyNoRebalance(state, marketData, config, monthIndex)

  const currentPrice = marketData.qqqClose
  const { bearPhase, recoveryPhase, bearPhaseChanged, recoveryPhaseChanged } =
    updateBearState(memory, currentPrice, isFirstMonth)

  const buyTarget = config.bearPledge?.buyTarget ?? 'QQQ'
  const maxPledgeRatio = config.bearPledge?.maxPledgeRatio ?? 0.10
  const buyTargetPrice = getTickerClose(marketData, buyTarget)

  if (!isFirstMonth && buyTargetPrice > 0) {
    // 初始化质押借款上限（首次进入熊市时快照当前总资产）
    if (bearPhaseChanged && bearPhase === 1) {
      memory.pledgeBudget = newState.totalValue * maxPledgeRatio
      memory.pledgeDebt = 0
      memory.pledgeBatches = []
    }

    if (bearPhaseChanged && bearPhase > 0 && bearPhase <= 4) {
      const budget = memory.pledgeBudget ?? 0
      const currentDebt = memory.pledgeDebt ?? 0
      // 每档借入总资产净值的1%（固定额度，不超过上限）
      const borrowPerPhase = newState.totalValue * 0.01
      const maxBorrow = budget - currentDebt
      const actualBorrow = Math.min(borrowPerPhase, maxBorrow)

      if (actualBorrow > 0.01) {
        // 借款并买入
        const buyQty = actualBorrow / buyTargetPrice
        newState.shares[buyTarget] = (newState.shares[buyTarget] ?? 0) + buyQty
        newState.debtBalance = (newState.debtBalance ?? 0) + actualBorrow
        memory.pledgeDebt = currentDebt + actualBorrow

        // 记录本批次买入
        if (!memory.pledgeBatches) memory.pledgeBatches = []
        memory.pledgeBatches.push({
          ticker: buyTarget,
          qty: buyQty,
          price: buyTargetPrice,
          phase: bearPhase,
        })
        memory.lastAction = `PLEDGE_BORROW bearPhase=${bearPhase}: Borrow $${actualBorrow.toFixed(0)}, Buy ${buyQty.toFixed(2)} ${buyTarget}`
        
        newState.events = newState.events || []
        newState.events.push({
          type: 'PLEDGE_BORROW',
          amount: actualBorrow,
          description: `[Phase ${bearPhase}] Pledged margin loan to buy ${buyQty.toFixed(2)} ${buyTarget}`,
        })
      }
    }

    if (recoveryPhaseChanged && recoveryPhase > 0 && (memory.pledgeBatches?.length ?? 0) > 0) {
      // 按反弹阶段卖出对应批次的比例
      const sellRatios: Record<number, number> = { 1: 0.10, 2: 0.20, 3: 0.30, 4: 1.00 }
      const sellRatio = sellRatios[recoveryPhase] ?? 0

      if (sellRatio > 0) {
        // 先进先出：按照各批次平仓
        let totalRepay = 0
        const batches = memory.pledgeBatches ?? []
        for (const batch of batches) {
          const sellQty = batch.qty * sellRatio
          const sellValue = sellQty * getTickerClose(marketData, batch.ticker)
          const actualSell = Math.min(sellQty, getShares(newState.shares, batch.ticker))
          if (actualSell > 0.001) {
            const repayAmount = actualSell * getTickerClose(marketData, batch.ticker)
            newState.shares[batch.ticker] = Math.max(
              0,
              (newState.shares[batch.ticker] ?? 0) - actualSell,
            )
            totalRepay += repayAmount
          }
          void sellValue // 抑制未使用变量警告
        }

        // 还款（优先偿还 debtBalance）
        const repay = Math.min(totalRepay, newState.debtBalance)
        newState.debtBalance = Math.max(0, newState.debtBalance - repay)
        memory.pledgeDebt = Math.max(0, (memory.pledgeDebt ?? 0) - repay)

        if (recoveryPhase >= 4) {
          // 完全清零质押债务
          memory.pledgeBatches = []
          memory.pledgeDebt = 0
          memory.pledgeBudget = 0
        }
        memory.lastAction = `PLEDGE_REPAY recoveryPhase=${recoveryPhase}: Repay $${repay.toFixed(0)}`
        
        newState.events = newState.events || []
        newState.events.push({
          type: 'PLEDGE_REPAY',
          amount: repay,
          description: `[Recovery ${recoveryPhase}] Sold positions to repay $${repay.toFixed(0)} margin loan`,
        })
      }
    }
  }

  // 重新计算总价值
  let total = newState.cashBalance
  for (const [ticker, qty] of Object.entries(newState.shares)) {
    if (qty > 0) {
      const price = getTickerClose(marketData, ticker)
      total += qty * price
    }
  }
  newState.totalValue = total - (newState.debtBalance ?? 0)
  newState.strategyMemory = memory
  return newState
}

export const getStrategyByType = (type: StrategyType): StrategyFunction => {
  switch (type) {
    case 'NO_REBALANCE':
      return strategyNoRebalance
    case 'REBALANCE':
      return strategyRebalance
    case 'SMART':
      return strategySmart
    case 'FLEXIBLE_1':
      return strategyFlexible1
    case 'FLEXIBLE_2':
      return strategyFlexible2
    case 'DIP_BUYING_STATE':
      return strategyDipBuyingState
    case 'BEAR_ROTATION': // PRD B1
      return strategyBearRotation
    case 'BEAR_PLEDGE': // PRD B2
      return strategyBearPledge
    default:
      return strategyNoRebalance
  }
}
