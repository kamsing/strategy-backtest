// Domain Models

export interface MarketDataRow {
  date: string // ISO YYYY-MM-DD
  // QQQ Close/Low 价格（原型基金）
  qqqClose: number
  qqqLow: number
  // QLD Close/Low 价格（2倍杠杆）
  qldClose: number
  qldLow: number
  // 自定义多标的价格映射（向下兼容单标的字段）
  customClose?: number // 向后兼容旧单标的字段
  customLow?: number // 向后兼容旧单标的字段
  // PRD A1：多标的价格 Record，key 为 Ticker（如 'TQQQ'），value 为收盘价
  customPrices?: Record<string, number>
  // PRD A1：多标的低价 Record，用于保证金评估
  customLows?: Record<string, number>
}

// 自定义标的配置（用于 constants.ts 动态构建市场数据）
export interface CustomAsset {
  ticker: string // 股票代码，如 'TQQQ'
  leverageMultiplier: number // 杠杆倍数（1=1倍, 2=2倍, 3=3倍）
  color?: string // 图表颜色
  data?: Array<{ month: string; close: number; low: number }> // 可选静态数据
}

export interface LeverageConfig {
  enabled: boolean
  interestRate: number // Annual interest rate for the loan
  // Pledge Ratios (0.0 - 1.0)
  qqqPledgeRatio: number // e.g., 0.70
  qldPledgeRatio: number // e.g., 0.10
  cashPledgeRatio: number // e.g., 0.95
  maxLtv: number // User's safety stop (Liquidation usually happens at 100% of Pledged Collateral)
  withdrawType: 'PERCENT' | 'FIXED'
  withdrawValue: number // Percentage (e.g. 2.0) or Fixed Amount
  inflationRate: number // Annual inflation rate for FIXED withdrawals
  interestType: 'MONTHLY' | 'MATURITY' | 'CAPITALIZED' // Interest payment mode
  ltvBasis: 'TOTAL_ASSETS' | 'COLLATERAL' // LTV Calculation Basis
}

// PRD B1：熊市仓位转换策略专属配置
export interface BearRotationConfig {
  tripleETF: string // 3倍杠杆基金 Ticker，默认 'TQQQ'
  enableAlerts: boolean // 是否通过推送渠道发送交易通知
}

// PRD B2：熊市质押借款策略专属配置
export interface BearPledgeConfig {
  buyTarget: string // 质押借款后买入的标的 Ticker，可选 QQQ/QLD/TQQQ 或其他
  maxPledgeRatio: number // 最大质押借款占总资产比例，默认 0.10（10%）
  enableAlerts: boolean // 是否发送每次操作的推送通知
}

export interface AssetConfig {
  initialCapital: number
  contributionAmount: number // Amount per period
  contributionIntervalMonths: number // 1 = Monthly, 3 = Quarterly, 12 = Yearly
  yearlyContributionMonth: number // 1-12, which month for yearly contributions (default 12 = December)

  // Initial / Target Portfolio Allocation
  qqqWeight: number // 0-100
  qldWeight: number // 0-100

  // Recurring Contribution Allocation
  contributionQqqWeight: number // 0-100
  contributionQldWeight: number // 0-100

  // Cash weight is derived: 100 - QQQ - QLD - sum(customWeights)
  cashYieldAnnual: number // Percentage, e.g., 4.0

  // 向后兼容：旧的单标的配置
  customSymbol?: string // 股票代码，如 'TQQQ'（旧字段，向下兼容）
  customWeight?: number // 0-100（旧字段，向下兼容）
  contributionCustomWeight?: number // 0-100（旧字段，向下兼容）

  // PRD A1：多标的权重配置（新字段）
  // key 为 Ticker，value 为目标权重百分比（0-100）
  customWeights?: Record<string, number>
  // key 为 Ticker，value 为定投分配权重百分比（0-100）
  contributionCustomWeights?: Record<string, number>

  // Flexible Rebalancing Config
  annualExpenseAmount?: number // Annual living expense amount (default 2% of initial capital)
  cashCoverageYears?: number // Target years of expenses in cash (default 15)

  // Stock Pledging
  leverage: LeverageConfig

  // PRD B1：熊市仓位转换策略配置
  bearRotation?: BearRotationConfig

  // PRD B2：熊市质押借款策略配置
  bearPledge?: BearPledgeConfig
}

export type StrategyType =
  | 'NO_REBALANCE'
  | 'REBALANCE'
  | 'SMART'
  | 'FLEXIBLE_1'
  | 'FLEXIBLE_2'
  | 'DIP_BUYING_STATE'
  | 'BEAR_ROTATION' // PRD B1：熊市仓位转换型
  | 'BEAR_PLEDGE' // PRD B2：熊市质押借款型

export interface Profile {
  id: string
  name: string
  color: string
  strategyType: StrategyType
  config: AssetConfig
}

export interface FinancialEvent {
  type:
    | 'INTEREST_INC'
    | 'INTEREST_EXP'
    | 'DEBT_INC'
    | 'TRADE'
    | 'DEPOSIT'
    | 'WITHDRAW'
    | 'INFO'
    | 'ROTATION_IN' // PRD B1：转入3倍杠杆基金
    | 'ROTATION_OUT' // PRD B1：转出3倍杠杆基金（反弹时换回）
    | 'PLEDGE_BORROW' // PRD B2：质押借款买入
    | 'PLEDGE_REPAY' // PRD B2：卖出还款
    | 'ALERT_SENT' // 信号推送已发送
  amount?: number
  description: string
}

export interface PortfolioState {
  date: string
  // PRD A1：将 shares 泛化为 Record<string, number> 支持任意标的
  // 向下兼容：QQQ 和 QLD 始终存在
  shares: Record<string, number>
  cashBalance: number
  debtBalance: number // Track margin loan balance
  accruedInterest: number // Simple interest accrued but not yet paid (for MATURITY mode)
  totalValue: number // Net Equity (Assets - Debt)

  // Metadata for complex strategies (e.g., Smart Adjust)
  strategyMemory: Record<string, unknown>
  ltv: number // Loan to Value ratio for this step
  beta: number // Portfolio Beta relative to QQQ

  // Detailed logs for accounting reports
  events: FinancialEvent[]
}

export interface SimulationResult {
  strategyName: string
  color: string // Added to carry profile color to charts
  isLeveraged: boolean // Flag to indicate if leverage was enabled
  history: PortfolioState[]
  isBankrupt: boolean
  bankruptcyDate: string | null
  metrics: {
    finalBalance: number
    cagr: number
    maxDrawdown: number
    sharpeRatio: number
    irr: number
    realFinalBalance: number
    worstYearReturn: number
    maxRecoveryMonths: number
    calmarRatio: number
    painIndex: number
    inflationRate: number
  }
}

// Function Protocol for Strategies
export type StrategyFunction = (
  currentState: PortfolioState,
  marketData: MarketDataRow,
  config: AssetConfig,
  monthIndex: number,
) => PortfolioState

// PRD A1：工具函数 - 获取指定标的的估值
// 从 shares Record 中安全读取某标的的持仓数量，并计算市值
export const getShareValue = (shares: Record<string, number>, ticker: string, price: number): number => {
  const quantity = shares[ticker] ?? 0
  return quantity * price
}

// PRD A1：获取指定标的的持仓数量（安全读取）
export const getShares = (shares: Record<string, number>, ticker: string): number => {
  return shares[ticker] ?? 0
}
