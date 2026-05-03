/**
 * 操作记录服务（PRD §2.7）
 * 负责从回测结果中构建结构化的操作明细行，供 FinancialReportModal 和 CSV 导出使用
 */

import { SimulationResult, MarketDataRow, FinancialEvent } from '../types'

// OperationLogRow 接口（PRD §2.7）
export interface OperationLogRow {
  date: string             // 格式：YYYY-MM
  status: string           // 原始 event.type
  statusCN: string         // 中文映射
  qqqPrice: number         // QQQ 当月收盘价
  changePct: number        // QQQ 当月涨跌幅（百分比）
  phasePct: number         // 阶段触发阈值%（如 -10, -20...）
  sharesChanged: number | null  // 本次操作股数（正=买入，负=卖出，null=无持仓变动）
  amount: number           // 操作金额（正=买入，负=卖出）
  sharesAfter: number      // 操作后主要标的持仓股数
  stockValue: number       // 操作后所有股票合计市值
  totalAssets: number      // 操作后总资产（股票市值 + 现金）
  pnl: number              // 净值相对初始资金的绝对损益
  pnlPct: number           // 净值相对初始资金的百分比损益
  maintenanceRatioPct: number | null  // 维持率（无杠杆时为 null）
  pledgeCumulative: number // 质押借款累积债务余额
  pledgeInventoryValue: number  // 当前质押仓位合计市值
  groupLabel: string       // 分组标签
  ticker: string           // 操作标的
}

// 事件类型到中文名称的映射（PRD §2.3）
const EVENT_TYPE_CN: Record<string, string> = {
  ROTATION_IN: '下跌加码（转入）',
  ROTATION_OUT: '上涨减码（转出）',
  PLEDGE_BORROW: '质押借款买入',
  PLEDGE_REPAY: '质押还款卖出',
  DEPOSIT: '定投入金',
  WITHDRAW: '提款',
  DEBT_INC: '借款增加',
  INTEREST_EXP: '利息支出',
  INTEREST_INC: '现金收益',
  INFO: '系统事件',
  TRADE: '买卖操作',
  ALERT_SENT: '推送通知',
}

// 判断 TRADE 事件是买入还是卖出
const getTradeStatusCN = (amount: number | undefined): string => {
  if (amount === undefined) return '买卖操作'
  // amount = -cost，即 amount < 0 表示买入（支出现金），amount > 0 表示卖出（回收现金）
  return amount < 0 ? '定投买入' : '卖出'
}

// 需要股数变化的事件类型（其余显示 null）
const SHARE_CHANGE_TYPES = new Set([
  'TRADE', 'ROTATION_IN', 'ROTATION_OUT', 'PLEDGE_BORROW', 'PLEDGE_REPAY',
])

// 从 strategyMemory 中推导 phasePct（PRD §2.7）
const getPhasePctFromMemory = (event: FinancialEvent, memBearPhase: number, memRecoveryPhase: number): number => {
  // 优先读取事件自带的 phasePct
  if (event.phasePct !== undefined) return event.phasePct

  // 根据事件类型和 memory 推导
  if (event.type === 'ROTATION_IN' || event.type === 'PLEDGE_BORROW') {
    return -(memBearPhase * 10)
  }
  if (event.type === 'ROTATION_OUT' || event.type === 'PLEDGE_REPAY') {
    return memRecoveryPhase * 10
  }
  return 0
}

/**
 * 构建操作记录行数组（PRD §2.7）
 * 遍历 result.history，对每个有操作的月份生成对应行
 */
export function buildOperationLogRows(
  result: SimulationResult,
  marketData: MarketDataRow[],
  initialCapital: number,
): OperationLogRow[] {
  const rows: OperationLogRow[] = []

  // 构建日期 → 市场数据 的快速查找表
  const marketDataMap = new Map<string, MarketDataRow>()
  for (const row of marketData) {
    // market data date 格式为 YYYY-MM-DD，操作记录取 YYYY-MM
    const month = row.date.substring(0, 7)
    marketDataMap.set(month, row)
  }

  let prevQqqClose = 0

  for (let i = 0; i < result.history.length; i++) {
    const state = result.history[i]
    const dateMonth = state.date.substring(0, 7) // YYYY-MM-DD → YYYY-MM
    const mktRow = marketDataMap.get(dateMonth)
    const qqqClose = mktRow?.qqqClose ?? 0

    // QQQ 当月涨跌%
    const changePct = prevQqqClose > 0
      ? ((qqqClose - prevQqqClose) / prevQqqClose) * 100
      : 0
    prevQqqClose = qqqClose

    // 从 strategyMemory 读取熊市/反弹阶段
    const memBearPhase = (state.strategyMemory.bearPhase as number) ?? 0
    const memRecoveryPhase = (state.strategyMemory.recoveryPhase as number) ?? 0

    // 读取 pledgeBatches 估值
    const pledgeBatches = (state.strategyMemory.pledgeBatches as Array<{
      ticker: string; qty: number; price: number; phase: number
    }>) ?? []
    const pledgeInventoryValue = pledgeBatches.reduce((acc, batch) => {
      const currentPrice = mktRow
        ? (mktRow.customPrices?.[batch.ticker] ?? mktRow.qqqClose)
        : batch.price
      return acc + batch.qty * currentPrice
    }, 0)

    // 计算股票市值（所有标的合计）
    let stockValue = 0
    for (const [ticker, qty] of Object.entries(state.shares)) {
      if (qty > 0.001 && mktRow) {
        let price = 0
        if (ticker === 'QQQ') price = mktRow.qqqClose
        else if (ticker === 'QLD') price = mktRow.qldClose
        else price = mktRow.customPrices?.[ticker] ?? 0
        stockValue += qty * price
      }
    }

    const totalAssets = stockValue + state.cashBalance
    const pnl = state.totalValue - initialCapital
    const pnlPct = initialCapital > 0 ? (state.totalValue / initialCapital - 1) * 100 : 0

    // 维持率（有杠杆且有债务时计算）
    const maintenanceRatioPct = state.debtBalance > 0
      ? (1 - state.debtBalance / Math.max(totalAssets, 0.01)) * 100
      : null

    const groupLabel = state.groupLabel ?? '正常运行'

    // 第一行（初始建仓）—— 即使无事件也必须存在（PRD C2）
    if (i === 0) {
      const initAmount = initialCapital
      rows.push({
        date: dateMonth,
        status: 'INITIAL',
        statusCN: '初始建仓',
        qqqPrice: qqqClose,
        changePct: 0,
        phasePct: 0,
        sharesChanged: null,
        amount: initAmount,
        sharesAfter: state.shares['QQQ'] ?? 0,
        stockValue,
        totalAssets,
        pnl,
        pnlPct,
        maintenanceRatioPct,
        pledgeCumulative: state.debtBalance,
        pledgeInventoryValue,
        groupLabel,
        ticker: 'QQQ',
      })
      continue
    }

    // 过滤：只处理有操作的月份（INTEREST_INC 等噪音型事件不展示，除非是主要操作）
    const significantEvents = state.events.filter((evt) => {
      // 跳过纯噪音事件
      if (evt.type === 'INTEREST_INC' && Math.abs(evt.amount ?? 0) < 100) return false
      if (evt.type === 'ALERT_SENT') return false
      return true
    })

    if (significantEvents.length === 0) continue

    // 每个有效事件生成一行
    for (const event of significantEvents) {
      const phasePct = getPhasePctFromMemory(event, memBearPhase, memRecoveryPhase)
      const sharesChanged = SHARE_CHANGE_TYPES.has(event.type)
        ? (event.sharesChanged ?? null)
        : null

      // 操作后主要标的的持仓数量
      const mainTicker = event.ticker ?? 'QQQ'
      const sharesAfter = state.shares[mainTicker] ?? state.shares['QQQ'] ?? 0

      // 操作金额（amount）标准化：TRADE 事件 amount = -cost，正值表示卖出收入
      const amount = event.amount ?? 0

      // 中文状态
      let statusCN = EVENT_TYPE_CN[event.type] ?? event.type
      if (event.type === 'TRADE') {
        statusCN = getTradeStatusCN(event.amount)
      }

      rows.push({
        date: dateMonth,
        status: event.type,
        statusCN,
        qqqPrice: qqqClose,
        changePct,
        phasePct,
        sharesChanged,
        amount,
        sharesAfter,
        stockValue,
        totalAssets,
        pnl,
        pnlPct,
        maintenanceRatioPct,
        pledgeCumulative: state.debtBalance,
        pledgeInventoryValue,
        groupLabel,
        ticker: mainTicker,
      })
    }
  }

  return rows
}

/**
 * 计算操作记录汇总数据（用于表格顶部汇总行）
 */
export interface OperationLogSummary {
  count: number           // 操作次数
  totalBuy: number        // 总买入金额
  totalSell: number       // 总卖出/还款金额（绝对值）
  netBuy: number          // 净买入
  finalTotalAssets: number  // 期末总资产
  finalPnl: number        // 期末损益
}

export function calcOperationLogSummary(rows: OperationLogRow[]): OperationLogSummary {
  let totalBuy = 0
  let totalSell = 0
  for (const row of rows) {
    if (row.status === 'INITIAL') continue
    // TRADE amount = -cost：amount < 0 是买入，amount > 0 是卖出
    if (row.amount < 0) totalBuy += Math.abs(row.amount)
    else if (row.amount > 0) totalSell += row.amount
  }

  const lastRow = rows[rows.length - 1]

  return {
    count: rows.filter((r) => r.status !== 'INITIAL').length,
    totalBuy,
    totalSell,
    netBuy: totalBuy - totalSell,
    finalTotalAssets: lastRow?.totalAssets ?? 0,
    finalPnl: lastRow?.pnl ?? 0,
  }
}
