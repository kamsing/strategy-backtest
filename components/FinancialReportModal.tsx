import React, { useState, useMemo, useCallback } from 'react'
import { SimulationResult } from '../types'
import { MARKET_DATA } from '../constants'
import { useTranslation } from '../services/i18n'
import { X, FileText, PieChart, ClipboardList, Download, Loader2 } from 'lucide-react'
import {
  buildOperationLogRows,
  calcOperationLogSummary,
} from '../services/operationLogService'
import { exportOperationLogCSV } from '../services/operationLogExport'
import { getMarketPhaseConfig } from '../services/marketCycleService'
import { MarketPhaseLabel } from '../types'

interface FinancialReportModalProps {
  result: SimulationResult
  onClose: () => void
}



// 事件类型对应的 Badge 样式
const BADGE_STYLE: Record<string, string> = {
  ROTATION_IN: 'bg-yellow-100 text-yellow-800',
  ROTATION_OUT: 'bg-green-100 text-green-800',
  PLEDGE_BORROW: 'bg-orange-100 text-orange-800',
  PLEDGE_REPAY: 'bg-blue-100 text-blue-800',
  TRADE: 'bg-slate-100 text-slate-700',
  DEPOSIT: 'bg-indigo-100 text-indigo-700',
  WITHDRAW: 'bg-purple-100 text-purple-800',
  DEBT_INC: 'bg-red-100 text-red-700',
  INTEREST_EXP: 'bg-orange-100 text-orange-700',
  INTEREST_INC: 'bg-teal-100 text-teal-700',
  INFO: 'bg-red-600 text-white',
  INITIAL: 'bg-slate-600 text-white',
}

// 数字格式化工具
const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const fmtDec = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct = (n: number, decimals = 2) => {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(decimals)}%`
}

// OperationLogTable 子组件
const OperationLogTable: React.FC<{
  result: SimulationResult
  initialCapital: number
}> = ({ result, initialCapital }) => {
  const [filterType, setFilterType] = useState<string>('all')
  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterGroup, setFilterGroup] = useState<string>('all')
  const [filterPhase, setFilterPhase] = useState<string>('all')
  const [isExporting, setIsExporting] = useState(false)
  const [sortAsc, setSortAsc] = useState(true)

  // 构建所有操作行
  const allRows = useMemo(
    () => buildOperationLogRows(result, MARKET_DATA, initialCapital),
    [result, initialCapital],
  )

  // 年份选项
  const years = useMemo(() => {
    const set = new Set<string>()
    allRows.forEach((r) => set.add(r.date.substring(0, 4)))
    return Array.from(set).sort()
  }, [allRows])

  // 筛选逻辑
  const filteredRows = useMemo(() => {
    let rows = allRows
    if (filterType !== 'all') {
      const typeMap: Record<string, string[]> = {
        buy: ['TRADE', 'DEPOSIT', 'ROTATION_IN', 'PLEDGE_BORROW', 'INITIAL'],
        sell: ['ROTATION_OUT', 'PLEDGE_REPAY'],
        borrow: ['DEBT_INC', 'PLEDGE_BORROW'],
        repay: ['PLEDGE_REPAY'],
        system: ['INFO', 'ALERT_SENT'],
      }
      rows = rows.filter((r) => typeMap[filterType]?.includes(r.status))
    }
    if (filterYear !== 'all') {
      rows = rows.filter((r) => r.date.startsWith(filterYear))
    }
    if (filterGroup !== 'all') {
      rows = rows.filter((r) => r.groupLabel === filterGroup)
    }
    if (filterPhase !== 'all') {
      rows = rows.filter((r) => r.marketPhase === filterPhase)
    }
    // 排序
    return sortAsc ? rows : [...rows].reverse()
  }, [allRows, filterType, filterYear, filterGroup, filterPhase, sortAsc])

  const summary = useMemo(() => calcOperationLogSummary(filteredRows), [filteredRows])

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      exportOperationLogCSV(result, MARKET_DATA, result.strategyName, initialCapital)
    } finally {
      setTimeout(() => setIsExporting(false), 1500)
    }
  }, [result, initialCapital])

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-white border-b border-slate-200 sticky top-0 z-10">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
        >
          <option value="all">全部类型</option>
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
          <option value="borrow">借款</option>
          <option value="repay">还款</option>
          <option value="system">系统事件</option>
        </select>

        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
        >
          <option value="all">全部年份</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <select
          value={filterGroup}
          onChange={(e) => setFilterGroup(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
        >
          <option value="all">全部阶段</option>
          <option value="下跌加码">下跌加码</option>
          <option value="上涨减码">上涨减码</option>
          <option value="正常运行">正常运行</option>
          <option value="回到高点">回到高点</option>
        </select>

        <select
          value={filterPhase}
          onChange={(e) => setFilterPhase(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700"
        >
          <option value="all">全部市场状态</option>
          <option value="PHASE_ALERT">市场预警</option>
          <option value="PHASE_CORRECTION">市场调整</option>
          <option value="PHASE_BEAR">熊市</option>
          <option value="PHASE_FINANCIAL_CRISIS">金融海啸</option>
          <option value="PHASE_FINANCIAL_STORM">金融风暴</option>
          <option value="PHASE_CATASTROPHE">市场崩溃</option>
          <option value="PHASE_STABILIZE">企稳</option>
          <option value="PHASE_REBOUND">技术反弹</option>
          <option value="PHASE_BULL">牛市</option>
          <option value="PHASE_STRONG_BULL">强势牛市</option>
          <option value="PHASE_NEW_ATH">历史新高</option>
          <option value="PHASE_EUPHORIA">市场亢奋</option>
          <option value="PHASE_NORMAL">正常运行</option>
        </select>

        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 hover:bg-slate-50"
        >
          {sortAsc ? '↑ 时间升序' : '↓ 时间降序'}
        </button>

        <div className="flex-1" />

        {/* CSV 导出按钮（PRD C9：防重复点击） */}
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-3 py-1.5 rounded-md transition-colors font-medium"
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {isExporting ? '导出中...' : '导出 CSV'}
        </button>
      </div>

      {/* 汇总行（PRD §2.5） */}
      <div className="flex flex-wrap gap-4 px-4 py-3 bg-blue-600 text-white text-xs font-bold">
        <span>操作次数：{summary.count}</span>
        <span>总买入：{fmt(summary.totalBuy)}</span>
        <span>总卖出/还款：{fmt(summary.totalSell)}</span>
        <span>净买入：<span className={summary.netBuy >= 0 ? 'text-green-200' : 'text-red-200'}>{fmt(summary.netBuy)}</span></span>
        <span className="ml-auto">期末总资产：{fmt(summary.finalTotalAssets)}</span>
        <span>期末损益：<span className={summary.finalPnl >= 0 ? 'text-green-200' : 'text-red-200'}>{fmt(summary.finalPnl)}</span></span>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs text-left min-w-[1100px]">
          <thead className="bg-slate-100 text-slate-500 uppercase font-bold sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 whitespace-nowrap w-[110px]">日期</th>
              <th className="px-3 py-2 whitespace-nowrap w-[120px]">市场状态</th>
              <th className="px-3 py-2 whitespace-nowrap w-[100px]">操作类型</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">涨跌%</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">异动%</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">QQQ股价</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">异动股数</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">异动金额</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">股票市值</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">总资产</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">损益</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">损益%</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">维持率</th>
              <th className="px-3 py-2 text-right whitespace-nowrap">质借累积</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.map((row, idx) => {
              const phaseConfig = getMarketPhaseConfig(row.marketPhase as MarketPhaseLabel)
              const bg = phaseConfig.rowBgClass || 'bg-white'
              const badge = BADGE_STYLE[row.status] ?? 'bg-slate-100 text-slate-600'
              const isInfo = row.status === 'INFO'
              // 维持率 < 130% 标红（PRD C7）
              const mainRatioRed =
                row.maintenanceRatioPct !== null && row.maintenanceRatioPct < 130

              return (
                <tr key={idx} className={`${bg} hover:brightness-95 transition-all`}>
                  <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{row.date}</td>
                  {/* 市场状态列（独立） */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.marketPhase ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${phaseConfig.badgeClass}`}>
                        {phaseConfig.emoji} {phaseConfig.label}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  {/* 操作类型列（独立） */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${badge} ${isInfo ? 'text-red-600' : ''}`}>
                      {row.statusCN}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${row.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtPct(row.changePct)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${row.phasePct < 0 ? 'text-red-600' : row.phasePct > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                    {row.phasePct !== 0 ? fmtPct(row.phasePct, 0) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-slate-700">
                    ${row.qqqPrice.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${(row.sharesChanged ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {row.sharesChanged !== null
                      ? `${row.sharesChanged >= 0 ? '+' : ''}${row.sharesChanged.toFixed(2)}`
                      : '-'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${row.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {row.amount !== 0 ? (row.amount >= 0 ? '+' : '') + fmtDec(row.amount) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-slate-700">
                    {fmt(row.stockValue)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-slate-700 font-bold">
                    {fmt(row.totalAssets)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${row.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {(row.pnl >= 0 ? '+' : '') + fmt(row.pnl)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${row.pnlPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtPct(row.pnlPct)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${mainRatioRed ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                    {row.maintenanceRatioPct !== null
                      ? `${row.maintenanceRatioPct.toFixed(1)}%`
                      : '-'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${row.pledgeCumulative > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {row.pledgeCumulative > 0 ? fmt(row.pledgeCumulative) : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            暂无符合条件的操作记录
          </div>
        )}
      </div>
    </div>
  )
}

export const FinancialReportModal: React.FC<FinancialReportModalProps> = ({ result, onClose }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'JOURNAL' | 'BALANCE' | 'OPERATION_LOG'>('BALANCE')

  // 从第一条历史记录反推初始资金
  const initialCapital = useMemo(() => {
    if (result.history.length === 0) return 1_000_000
    const first = result.history[0]
    return first.totalValue > 0 ? first.totalValue : 1_000_000
  }, [result])

  const fmt = (num: number) =>
    `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  const fmtDec = (num: number) =>
    `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const balanceSheetHistory = result.history.filter((_, idx) => {
    const month = parseInt(result.history[idx].date.substring(5, 7))
    return month === 6 || month === 12 || idx === result.history.length - 1
  })

  const TAB_CLASSES = (active: boolean) =>
    `flex-1 py-3 text-sm font-bold border-b-2 transition-colors flex items-center justify-center gap-2 ${
      active
        ? 'border-blue-600 text-blue-600 bg-blue-50/50'
        : 'border-transparent text-slate-500 hover:bg-slate-50'
    }`

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-6xl h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: result.color }} />
            <div>
              <h2 className="text-xl font-bold text-slate-800">{t('reportTitle')}</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                {result.strategyName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 flex-shrink-0">
          <button onClick={() => setActiveTab('BALANCE')} className={TAB_CLASSES(activeTab === 'BALANCE')}>
            <PieChart className="w-4 h-4" /> {t('tabBalanceSheet')}
          </button>
          <button onClick={() => setActiveTab('JOURNAL')} className={TAB_CLASSES(activeTab === 'JOURNAL')}>
            <FileText className="w-4 h-4" /> {t('tabJournal')}
          </button>
          {/* 操作记录 Tab（PRD §2.1） */}
          <button onClick={() => setActiveTab('OPERATION_LOG')} className={TAB_CLASSES(activeTab === 'OPERATION_LOG')}>
            <ClipboardList className="w-4 h-4" />
            操作记录
            <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold">NEW</span>
          </button>
        </div>

        {/* Content Area */}
        <div className={`flex-1 overflow-auto bg-slate-50 ${activeTab === 'OPERATION_LOG' ? 'p-0' : 'p-4'}`}>
          {/* Balance Sheet Tab */}
          {activeTab === 'BALANCE' && (
            <div className="space-y-6">
              {balanceSheetHistory.map((state) => {
                const qqqVal =
                  state.shares.QQQ * (MARKET_DATA.find((m) => m.date === state.date)?.qqqClose || 0)
                const qldVal =
                  state.shares.QLD * (MARKET_DATA.find((m) => m.date === state.date)?.qldClose || 0)
                const totalAssets = qqqVal + qldVal + state.cashBalance

                return (
                  <div
                    key={state.date}
                    className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
                  >
                    <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                      <span className="font-bold text-slate-700 font-mono">{state.date}</span>
                      <div className="text-xs font-bold text-slate-500 flex gap-4">
                        <span>
                          {t('marginLtv')}:{' '}
                          <span className={`${state.ltv > 60 ? 'text-red-600' : 'text-green-600'}`}>
                            {state.ltv.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      <div className="p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 border-b pb-1">
                          {t('assets')}
                        </h4>
                        <div className="space-y-2 text-sm">
                          {Object.entries(state.shares).map(([ticker, shares]) => {
                            if (shares < 0.001) return null
                            const price =
                              MARKET_DATA.find((m) => m.date === state.date)?.[
                                `${ticker.toLowerCase()}Close` as keyof (typeof MARKET_DATA)[0]
                              ] ??
                              MARKET_DATA.find((m) => m.date === state.date)?.customPrices?.[ticker] ??
                              0
                            const val = shares * Number(price)
                            return (
                              <div key={ticker} className="flex justify-between">
                                <span className="text-slate-600">
                                  {ticker} ({shares.toFixed(1)} {t('shares')})
                                </span>
                                <span className="font-mono font-medium">{fmt(val)}</span>
                              </div>
                            )
                          })}
                          <div className="flex justify-between">
                            <span className="text-slate-600">{t('cash')}</span>
                            <span className="font-mono font-medium text-green-600">
                              {fmt(state.cashBalance)}
                            </span>
                          </div>
                          <div className="flex justify-between pt-2 border-t border-slate-100 font-bold mt-2">
                            <span>{t('totalAssets')}</span>
                            <span>{fmt(totalAssets)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 border-b pb-1">
                          {t('liabilities')}
                        </h4>
                        <div className="space-y-2 text-sm h-full flex flex-col">
                          <div className="flex justify-between">
                            <span className="text-slate-600">{t('totalDebt')}</span>
                            <span className="font-mono font-medium text-red-600">
                              {fmt(state.debtBalance)}
                            </span>
                          </div>
                          <div className="mt-auto pt-4">
                            <div className="flex justify-between items-end p-3 bg-blue-50 rounded-lg border border-blue-100">
                              <span className="font-bold text-blue-800">{t('equity')}</span>
                              <span className="font-mono font-bold text-blue-900 text-lg">
                                {fmt(state.totalValue)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Journal Tab */}
          {activeTab === 'JOURNAL' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase font-bold sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 w-32">{t('date')}</th>
                    <th className="px-4 py-3 text-right w-32">{t('cash')}</th>
                    <th className="px-4 py-3 text-right w-32">{t('totalDebt')}</th>
                    <th className="px-4 py-3">{t('event')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.history.map((state, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-mono text-slate-600 align-top">{state.date}</td>
                      <td className="px-4 py-3 text-right font-mono text-green-700 align-top">
                        {fmt(state.cashBalance)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-red-600 align-top">
                        {state.debtBalance > 0 ? fmt(state.debtBalance) : '-'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-1">
                          {state.events && state.events.length > 0 ? (
                            state.events.map((evt, eIdx) => (
                              <div key={eIdx} className="flex items-start gap-2 text-xs">
                                <span className={`px-1.5 rounded font-bold text-[10px] min-w-[50px] text-center ${BADGE_STYLE[evt.type] ?? 'bg-slate-100 text-slate-600'}`}>
                                  {evt.type}
                                </span>
                                <span className="text-slate-700">
                                  {evt.description}
                                  {evt.amount !== undefined && Math.abs(evt.amount) > 0.01 && (
                                    <span
                                      className={`font-mono ml-1 font-bold ${evt.amount > 0 ? 'text-green-600' : 'text-red-500'}`}
                                    >
                                      {evt.amount > 0 ? '+' : ''}
                                      {fmtDec(evt.amount)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="text-slate-300 italic text-xs">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 操作记录 Tab（PRD §2） */}
          {activeTab === 'OPERATION_LOG' && (
            <div className="h-full flex flex-col bg-white">
              <OperationLogTable result={result} initialCapital={initialCapital} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
