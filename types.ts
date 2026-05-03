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

// v1.1 新增：市场阶段标签
export type MarketPhaseLabel =
  | 'PHASE_INITIAL'        // 周期初始状态（建仓月）
  | 'PHASE_ALERT'          // 市场预警（跌幅 -5% ~ -9%）
  | 'PHASE_CORRECTION'     // 市场调整（跌幅 -10% ~ -19%）
  | 'PHASE_BEAR'           // 熊市（跌幅 -20% ~ -29%）
  | 'PHASE_FINANCIAL_CRISIS' // 金融海啸（跌幅 -30% ~ -39%）
  | 'PHASE_FINANCIAL_STORM'  // 金融风暴（跌幅 -40% ~ -49%）
  | 'PHASE_CATASTROPHE'    // 市场崩溃（跌幅 ≥ -50%）
  | 'PHASE_STABILIZE'      // 企稳（从低点反弹 +5% ~ +9%）
  | 'PHASE_REBOUND'        // 技术反弹（+10% ~ +19%，低点起算）
  | 'PHASE_BULL'           // 牛市确认（+20% ~ +29%，低点起算）
  | 'PHASE_STRONG_BULL'    // 强势牛市（+30% ~ +49%，低点起算）
  | 'PHASE_NEW_ATH'        // 创历史新高（突破前高 ATH）
  | 'PHASE_EUPHORIA'       // 市场亢奋（创新高后继续上涨 +20% 以上）
  | 'PHASE_NORMAL'         // 正常运行（波动 ±5% 以内，无显著趋势）
  | 'PHASE_SIDEWAYS'       // 横盘整理（区间震荡超过 3 个月）

// v1.1 新增：市场周期状态
export type CyclePhase =
  | 'CYCLE_PEAK'     // 周期高点
  | 'CYCLE_DRAWDOWN' // 下行阶段
  | 'CYCLE_RECOVERY' // 周期修复
  | 'CYCLE_NEW_HIGH' // 新周期开始

// v1.1 新增：周期分段结构
export interface CycleSegment {
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
  type: CyclePhase
  peakValue?: number  // 对应高点净值
  troughValue?: number // 对应低点净值
  drawdownPct?: number // 最大回撤%
  recoveryPct?: number // 反弹幅度%
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
  // PRD §4：操作记录表所需的扩展字段（可选，向下兼容）
  ticker?: string         // 操作涉及的标的代码（如 'QQQ', 'TQQQ'）
  phasePct?: number       // 触发的阈值百分比（如 -10, -20, +10...）
  sharesChanged?: number  // 本次操作的股数变化（正=买入，负=卖出）
  
  // v1.1 新增：精确日期与市场阶段（PRD §2.3, §4.2）
  date?: string                  // YYYY-MM-DD，精确到操作执行日
  marketPhase?: MarketPhaseLabel // 事件发生时的市场阶段
  drawdownFromAth?: number       // 距 ATH 的跌幅（负数）
  recoveryFromTrough?: number    // 距低点的涨幅（正数）
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

  // PRD §4：操作记录分组标签（可选，向下兼容）
  // 值：'正常运行' | '下跌加码' | '上涨减码' | '回到高点'
  groupLabel?: string

  // v1.1 新增：市场阶段与周期信息（PRD §5.2）
  marketPhase?: MarketPhaseLabel   // 默认 PHASE_NORMAL
  cyclePhase?: CyclePhase          // 默认 CYCLE_NEW_HIGH (首月)
  drawdownFromAth?: number         // 当月距 ATH 跌幅
  ath?: number                     // 截至当月的历史最高净值
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
