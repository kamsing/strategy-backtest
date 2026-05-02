import { AssetConfig, PortfolioState, StrategyFunction, StrategyType } from '../types'

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
  const newState = { ...state, date: marketData.date, shares: { ...state.shares, CUSTOM: state.shares.CUSTOM ?? 0 } }

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
    default:
      return strategyNoRebalance
  }
}
