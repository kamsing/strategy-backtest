import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { SimulationResult } from '../types'
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  BarChart,
  Bar,
  ReferenceArea,
  ReferenceDot,
} from 'recharts'
import {
  TrendingUp,
  Percent,
  Activity,
  Trophy,
  AlertTriangle,
  Scale,
  HelpCircle,
  Zap,
  ShieldAlert,
  Clock,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  FileDown,
  ZoomIn,
  RefreshCw,
  BoxSelect,
  MousePointer2,
  Eye,
  EyeOff,
  Settings2,
} from 'lucide-react'
import { useTranslation } from '../services/i18n'
import { MathModelModal } from './MathModelModal'
import { generateProfessionalReport } from '../services/reportService'
import { detectCycleSegments } from '../services/marketCycleService'
import { CYCLE_COLORS, CYCLE_LABELS } from '../constants'
import { CycleSegment } from '../types'

// v1.1 周期阈値参数类型
export interface CycleThresholds {
  drawdownThreshold: number  // 下行阶段最小跌幅阈値
  recoveryThreshold: number  // 修复阶段最小反弹阈値
  athBuffer: number          // 突破前高的容差
  mergeGapMonths: number     // 小于该月数的短分段自动合并
}

interface ResultsDashboardProps {
  results: SimulationResult[]
  onUpdateMarketData?: () => void
  isUpdatingData?: boolean
}

const MetricCard: React.FC<{
  title: string
  value: string
  subValue?: string
  icon: React.ReactNode
  winnerName: string
  winnerColor: string
  highlight?: boolean
}> = ({ title, value, subValue, icon, winnerName, winnerColor, highlight }) => (
  <div
    className={`p-5 rounded-xl border shadow-sm transition-all hover:shadow-md flex flex-col justify-between ${highlight ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100'}`}
  >
    <div>
      <div className="flex justify-between items-start mb-2">
        <div className="text-sm font-medium text-slate-500">{title}</div>
        <div
          className={`p-2 rounded-lg ${highlight ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-600'}`}
        >
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mb-1">{value}</div>
      {subValue && <div className="text-xs text-slate-400 mb-2">{subValue}</div>}
    </div>

    <div
      className={`flex items-center gap-2 text-xs font-medium p-2 rounded-lg border ${highlight ? 'bg-white/60 border-blue-100' : 'bg-slate-50 border-slate-100'}`}
    >
      <Trophy className="w-3 h-3 text-yellow-500" />
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: winnerColor }}
      ></span>
      <span className="text-slate-700 truncate" title={winnerName}>
        {winnerName}
      </span>
    </div>
  </div>
)

// 操作点颜色映射（PRD §3.2）
const DOT_COLOR: Record<string, string> = {
  ROTATION_IN: '#f59e0b',
  ROTATION_OUT: '#10b981',
  PLEDGE_BORROW: '#f97316',
  PLEDGE_REPAY: '#3b82f6',
  WITHDRAW: '#8b5cf6',
  INFO: '#dc2626',
  DEPOSIT: '#6366f1',
}

// 操作点半径（PRD §3.2）
const DOT_RADIUS: Record<string, number> = {
  INFO: 7,
  ROTATION_IN: 5,
  ROTATION_OUT: 5,
  PLEDGE_BORROW: 5,
  PLEDGE_REPAY: 5,
  WITHDRAW: 4,
  DEPOSIT: 3,
  TRADE: 3,
}

// 优先级（PRD §3.2，数字越小优先级越高）
const DOT_PRIORITY: Record<string, number> = {
  INFO: 0,
  ROTATION_IN: 1,
  ROTATION_OUT: 1,
  PLEDGE_BORROW: 2,
  PLEDGE_REPAY: 2,
  TRADE: 3,
  DEPOSIT: 4,
  WITHDRAW: 5,
}

// 操作点数据结构
interface OperationDot {
  date: string
  type: string
  color: string
  r: number
  strategyName: string
  strategyColor: string
  totalValue: number
  description: string
  amount?: number
  phasePct?: number
}

const OperationTooltipSection: React.FC<{
  dots: OperationDot[]
}> = ({ dots }) => {
  if (dots.length === 0) return null
  return (
    <div className="mt-2 pt-2 border-t border-slate-200">
      <p className="text-[10px] font-bold text-slate-500 mb-1.5">本月操作 ({dots.length} 条)</p>
      {dots.map((dot, i) => (
        <div key={i} className="flex items-start gap-1.5 mb-1 text-[10px]">
          <span
            className="flex-shrink-0 w-2 h-2 rounded-full mt-0.5"
            style={{ backgroundColor: dot.color }}
          />
          <div>
            <span className="font-bold" style={{ color: dot.strategyName ? dot.strategyColor : undefined }}>
              {dot.strategyName}
            </span>{' '}
            <span className="text-slate-700">{dot.description}</span>
            {dot.amount !== undefined && Math.abs(dot.amount) > 0.01 && (
              <span className={`ml-1 font-mono font-bold ${dot.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {dot.amount >= 0 ? '+' : ''}${Math.abs(dot.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            )}
            {dot.phasePct !== undefined && dot.phasePct !== 0 && (
              <span className={`ml-1 text-[9px] px-1 rounded ${dot.phasePct < 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                {dot.phasePct > 0 ? '+' : ''}{dot.phasePct}%
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

const CustomTooltip = ({
  active,
  payload,
  label,
  formatType = 'auto',
  operationDots,
  cycleSegments,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  formatType?: 'currency' | 'percent' | 'number' | 'auto'
  operationDots?: Map<string, OperationDot[]>
  cycleSegments?: CycleSegment[]
}) => {
  if (active && payload && payload.length) {
    const filteredPayload = (payload as { name: string; value: number; color: string }[]).filter(
      (p) => !p.name.startsWith('_'),
    )
    if (filteredPayload.length === 0) return null

    // 获取当前 date 的操作点
    const dots: OperationDot[] = (label ? operationDots?.get(label) : undefined) ?? []

    // 获取当前周期的分段信息 (PRD v1.1 §3.6)
    const currentCycle = label ? cycleSegments?.find(s => label >= s.startDate && label <= s.endDate) : null

    return (
      <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl text-xs" style={{ maxWidth: 340, zIndex: 9999 }}>
        <p className="font-bold text-slate-700 mb-2">{label}</p>
        
        {/* 周期信息显示 */}
        {currentCycle && (
          <div className="mb-2 p-2 rounded bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CYCLE_COLORS[currentCycle.type] }} />
              <span className="font-bold text-slate-700">📍 周期状态：{CYCLE_LABELS[currentCycle.type]}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-500">
              {currentCycle.drawdownPct !== undefined && currentCycle.drawdownPct < 0 && (
                <div>距前高回撤: <span className="font-bold text-red-600">{currentCycle.drawdownPct.toFixed(1)}%</span></div>
              )}
              {currentCycle.recoveryPct !== undefined && currentCycle.recoveryPct > 0 && (
                <div>距低点反弹: <span className="font-bold text-green-600">+{currentCycle.recoveryPct.toFixed(1)}%</span></div>
              )}
              <div className="col-span-2">本段起始: {currentCycle.startDate}</div>
            </div>
          </div>
        )}
        {filteredPayload.map((p) => {
          let formattedValue = ''
          const val = Number(p.value)

          if (formatType === 'currency') {
            formattedValue = `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          } else if (formatType === 'percent') {
            formattedValue = `${val.toFixed(2)}%`
          } else if (formatType === 'number') {
            formattedValue = val.toFixed(2)
          } else {
            const lowerName = p.name.toLowerCase()
            if (lowerName.includes('%') || lowerName.includes('ltv') || lowerName.includes('drawdown')) {
              formattedValue = `${val.toFixed(2)}%`
            } else if (lowerName.includes('beta') || lowerName.includes('ratio')) {
              formattedValue = val.toFixed(2)
            } else if (lowerName.includes('cashamount') || lowerName.includes('balance')) {
              formattedValue = `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            } else {
              formattedValue = val.toLocaleString()
            }
          }

          return (
            <div key={p.name} className="flex items-center gap-2 mb-1" style={{ color: p.color }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span>{p.name}:</span>
              <span className="font-mono font-bold">{formattedValue}</span>
            </div>
          )
        })}
        {/* 操作明细区域（PRD §3.3） */}
        <OperationTooltipSection dots={dots} />
      </div>
    )
  }
  return null
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({ results }) => {
  const { t } = useTranslation()
  const isLargeSet = results.length > 50

  const chartResults = React.useMemo(() => {
    if (!isLargeSet) return results

    // 1. Keep all benchmarks
    const benchmarks = results.filter((r) => r.strategyName.toLowerCase().includes('benchmark'))

    // 2. Get strategies
    const strategies = results.filter((r) => !r.strategyName.toLowerCase().includes('benchmark'))

    // 3. Select Top 10 by CAGR
    const topCAGR = [...strategies].sort((a, b) => b.metrics.cagr - a.metrics.cagr).slice(0, 10)

    // 4. Select Bottom 5 by Max Drawdown (worst performers)
    const worstMDD = [...strategies]
      .filter((s) => !topCAGR.find((t) => t.strategyName === s.strategyName))
      .sort((a, b) => b.metrics.maxDrawdown - a.metrics.maxDrawdown) // Higher MDD is worse
      .slice(0, 5)

    // Combine and ensure uniqueness
    const combined = [...benchmarks, ...topCAGR, ...worstMDD]
    const uniqueChartResults = Array.from(
      new Map(combined.map((item) => [item.strategyName, item])).values(),
    )

    return uniqueChartResults
  }, [results, isLargeSet])

  // Dynamic height calculation based on profile count to prevent chart compression
  const calculateChartHeight = (baseHeight: number) => {
    const threshold = 5
    const multiplier = 20
    if (results.length <= threshold) return baseHeight
    return baseHeight + (results.length - threshold) * multiplier
  }
  const [showMath, setShowMath] = useState(false)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  // PRD C6：操作标注点总开关
  const [showDots, setShowDots] = useState(true)
  // v1.1 周期色块开关
  const [showCycles, setShowCycles] = useState(true)
  // v1.1 周期阈値设置
  const [cycleThresholds, setCycleThresholds] = useState<CycleThresholds>({
    drawdownThreshold: 0.10,
    recoveryThreshold: 0.10,
    athBuffer: 0.01,
    mergeGapMonths: 2,
  })
  const [showThresholdPanel, setShowThresholdPanel] = useState(false)
  // v1.1 手动日期区间 (已应用)
  const [appliedDateRange, setAppliedDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
  // 暂存输入，点击“确认”后同步到 appliedDateRange
  const [tempDateRange, setTempDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [showDatePanel, setShowDatePanel] = useState(false)
  const [sortConfig, setSortConfig] = useState<{
    key: keyof SimulationResult['metrics'] | 'strategyName'
    direction: 'asc' | 'desc'
  } | null>(null)

  const handleSort = (key: keyof SimulationResult['metrics'] | 'strategyName') => {
    let direction: 'asc' | 'desc' = 'desc'
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc'
    }
    setSortConfig({ key, direction })
  }

  // Zoom State for Portfolio Growth Chart
  const [zoomState, setZoomState] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  })
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null)
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null)
  const [isSelectionMode, setIsSelectionMode] = useState(false)

  const handleZoom = () => {
    if (refAreaLeft === refAreaRight || refAreaRight === null) {
      setRefAreaLeft(null)
      setRefAreaRight(null)
      return
    }

    // Determine domain chronologically
    let left = refAreaLeft!
    let right = refAreaRight!

    if (left > right) [left, right] = [right, left]

    // Index gap threshold logic
    const firstResult = results[0]
    if (!firstResult) return
    const history = firstResult.history
    const indexL = history.findIndex((h) => h.date === left)
    const indexR = history.findIndex((h) => h.date === right)
    const gap = Math.abs(indexR - indexL)
    const minGap = isSelectionMode ? 2 : 12

    if (gap >= minGap) {
      setZoomState({ left, right })
    }

    setRefAreaLeft(null)
    setRefAreaRight(null)
  }

  const handleZoomOut = () => {
    setZoomState({ left: null, right: null })
  }

  // Move early return after hooks if possible, but sortedResults is a hook.
  // Best to return early with the same hook structure or just return the UI conditionally.

  // Filter out benchmarks and bankrupt strategies for "Winning" logic
  const nonBenchmarkResults = results.filter(
    (r) => !r.strategyName.toLowerCase().includes('benchmark'),
  )
  const activeResults = nonBenchmarkResults.filter((r) => !r.isBankrupt)
  const safeResults =
    activeResults.length > 0
      ? activeResults
      : nonBenchmarkResults.length > 0
        ? nonBenchmarkResults
        : results

  // Calculate overall data max for Y-axis scaling
  const dataMaxVal = results.reduce((max, res) => {
    if (!res.history || res.history.length === 0) return max
    const historyMax = res.history.reduce((hMax, h) => Math.max(hMax, h.totalValue), 0)
    return Math.max(max, historyMax)
  }, 0)

  // Calculate a clean range: buffer on both ends, then round to clean steps
  const getCleanAxisConfig = (minVal: number, maxVal: number, targetTicks = 6) => {
    try {
      // 1. 基础健壮性检查
      if (!isFinite(minVal) || isNaN(minVal)) minVal = 0;
      if (!isFinite(maxVal) || isNaN(maxVal)) maxVal = 100;
      if (maxVal <= minVal) maxVal = minVal + 100;

      const range = Math.max(0.1, maxVal - minVal);
      const rawMin = minVal - range * 0.05;
      const rawMax = maxVal + range * 0.05;

      // If min is very close to 0 (less than 10% of max), just start from 0 for cleaner look
      const finalMin = rawMin < maxVal * 0.1 && rawMin >= 0 ? 0 : rawMin;

      const actualRange = Math.max(0.0001, rawMax - finalMin);
      const roughStep = actualRange / Math.max(1, targetTicks);
      
      const magRaw = Math.log10(roughStep);
      const magnitude = isFinite(magRaw) ? Math.pow(10, Math.floor(magRaw)) : 1;
      const normalizedStep = (magnitude !== 0 && isFinite(magnitude)) ? roughStep / magnitude : 1;

      let cleanStep = magnitude;
      if (isNaN(normalizedStep) || !isFinite(normalizedStep)) {
        cleanStep = Math.max(1, magnitude);
      } else if (normalizedStep > 5) {
        cleanStep = 10 * magnitude;
      } else if (normalizedStep > 2.5) {
        cleanStep = 5 * magnitude;
      } else if (normalizedStep > 1.5) {
        cleanStep = 2 * magnitude;
      }
      
      // Ensure cleanStep is valid
      if (!isFinite(cleanStep) || cleanStep <= 0) cleanStep = 1;

      // CRITICAL: Ensure cleanStep is large enough relative to maxBound to avoid floating point stuck loops
      const minSafeStep = Math.max(1e-12, Math.abs(rawMax) * 1e-14);
      if (cleanStep < minSafeStep || isNaN(cleanStep)) cleanStep = minSafeStep;

      const cleanMin = Math.floor(finalMin / cleanStep) * cleanStep;
      const cleanMax = Math.ceil(rawMax / cleanStep) * cleanStep;

      const ticks: number[] = [];
      let curr = cleanMin;
      let safetyCounter = 0;
      
      // Limit to 50 ticks to satisfy E2E test constraints and prevent UI clutter/crashes
      while (isFinite(curr) && curr <= cleanMax + cleanStep / 10 && safetyCounter < 50) {
        // toFixed 容错
        const precision = curr < 0.1 ? 6 : curr < 1 ? 4 : 2;
        ticks.push(Number(curr.toFixed(precision)));
        curr += cleanStep;
        safetyCounter++;
      }
      
      const finalMinBound = (!isFinite(cleanMin) || isNaN(cleanMin)) ? 0 : cleanMin;
      const finalMaxBound = (!isFinite(cleanMax) || isNaN(cleanMax)) ? (finalMinBound + 100) : cleanMax;
      const finalTicks = ticks.filter(t => isFinite(t) && !isNaN(t));
      const safeTicks = finalTicks.length > 0 ? finalTicks : [finalMinBound, finalMaxBound];

      return { step: cleanStep, minBound: finalMinBound, maxBound: finalMaxBound, ticks: safeTicks };
    } catch (err) {
      console.error("getCleanAxisConfig failed:", err);
      return { step: 100, minBound: 0, maxBound: 1000, ticks: [0, 500, 1000] };
    }
  }

  const growthConfig = getCleanAxisConfig(0, dataMaxVal)

  if (typeof window !== 'undefined') {
    ;(window as unknown as { __CHART_GLOBAL_MAX: number }).__CHART_GLOBAL_MAX = dataMaxVal
  }

  // v1.1 鲁棒的数据聚合：基于日期对齐而非索引 (修复不同标的数据长度/日期不一导致的崩溃)
  const chartData = React.useMemo(() => {
    if (!results || results.length === 0) return []
    
    // 1. 获取所有结果中出现过的所有唯一日期，并排序
    const dateSet = new Set<string>()
    results.forEach(res => {
      res.history?.forEach(h => dateSet.add(h.date))
    })
    const sortedDates = Array.from(dateSet).sort()

    // 2. 为每个策略构建日期索引 Map 以提高查找速度
    const strategyMaps = results.map((res: any) => {
      const map = new Map<string, any>()
      res.history?.forEach((h: any) => map.set(h.date, h))
      return { name: res.strategyName, map }
    })

    // 3. 构建聚合数据行
    return sortedDates.map(date => {
      const row: Record<string, string | number> = { date }
      strategyMaps.forEach(({ name, map }: any) => {
        const state = map.get(date)
        if (state) {
          row[name] = state.totalValue
        }
      })
      // Add dummy point to anchor Y-axis (hidden in Line)
      row['_yAnchor'] = growthConfig.maxBound
      return row
    })
  }, [results, growthConfig])

  // v1.1 手动日期区间过滤
  const dateFilteredChartData = React.useMemo(() => {
    if (!appliedDateRange.start && !appliedDateRange.end) return chartData
    return chartData.filter((d) => {
      const date = d.date as string
      if (appliedDateRange.start && date < appliedDateRange.start) return false
      if (appliedDateRange.end && date > appliedDateRange.end) return false
      return true
    })
  }, [chartData, appliedDateRange])

  // Visible Data based on Zoom (combines zoom + date filter)
  const visibleChartData = React.useMemo(() => {
    const data =
      !zoomState.left || !zoomState.right
        ? dateFilteredChartData
        : dateFilteredChartData.filter(
            (d) => (d.date as string) >= zoomState.left! && (d.date as string) <= zoomState.right!,
          )
    return data
  }, [dateFilteredChartData, zoomState])

  // Local Y-Axis Config for Zoomed Data
  const currentGrowthConfig = React.useMemo(() => {
    if (!zoomState.left || !zoomState.right) return growthConfig

    let max = -Infinity
    let min = Infinity
    visibleChartData.forEach((row) => {
      results.forEach((res) => {
        const val = Number(row[res.strategyName] || 0)
        if (val > max) max = val
        if (val < min) min = val
      })
    })

    if (max === -Infinity || min === Infinity) return growthConfig
    return getCleanAxisConfig(min, max)
  }, [visibleChartData, results, growthConfig, zoomState])

  // Prepare Drawdown Data
  const drawdownData = React.useMemo(() => {
    const dateSet = new Set<string>()
    results.forEach((res: any) => res.history?.forEach((h: any) => dateSet.add(h.date)))
    const sortedDates = Array.from(dateSet).sort()

    const strategyMaps = results.map((res: any) => {
      const map = new Map<string, any>()
      res.history?.forEach((h: any) => map.set(h.date, h))
      return { name: res.strategyName, map }
    })

    return sortedDates.map(date => {
      const row: Record<string, string | number> = { date }
      strategyMaps.forEach(({ name, map }: any) => {
        const state = map.get(date)
        if (state) row[name] = state.drawdownFromAth ?? 0
      })
      return row
    })
  }, [results])

  // Prepare LTV Data
  const leveragedProfiles = results.filter((r) => r.isLeveraged)
  const ltvData = React.useMemo(() => {
    if (!results || results.length === 0 || leveragedProfiles.length === 0) return []
    
    const dateSet = new Set<string>()
    leveragedProfiles.forEach((res: any) => res.history?.forEach((h: any) => dateSet.add(h.date)))
    const sortedDates = Array.from(dateSet).sort()

    const strategyMaps = leveragedProfiles.map((res: any) => {
      const map = new Map<string, any>()
      res.history?.forEach((h: any) => map.set(h.date, h))
      return { name: res.strategyName, map }
    })

    return sortedDates.map(date => {
      const row: Record<string, string | number> = { date }
      strategyMaps.forEach(({ name, map }: any) => {
        const state = map.get(date)
        if (state) row[name] = state.ltv ?? 0
      })
      return row
    })
  }, [results, leveragedProfiles])

  // Prepare Beta Data
  const betaData = React.useMemo(() => {
    if (!results || results.length === 0) return []
    
    const dateSet = new Set<string>()
    results.forEach((res: any) => res.history?.forEach((h: any) => dateSet.add(h.date)))
    const sortedDates = Array.from(dateSet).sort()

    const strategyMaps = results.map((res: any) => {
      const map = new Map<string, any>()
      res.history?.forEach((h: any) => map.set(h.date, h))
      return { name: res.strategyName, map }
    })

    return sortedDates.map(date => {
      const row: Record<string, string | number> = { date }
      strategyMaps.forEach(({ name, map }: any) => {
        const state = map.get(date)
        if (state) row[name] = state.beta ?? 0
      })
      return row
    })
  }, [results])

  // Prepare Cash Data for ALL profiles that have cash usage
  const cashCharts = results
    .map((res) => {
      const history = res.history || []
      const data = history.map((h) => ({
        date: h.date,
        cashPct: h.totalValue > 0 ? (h.cashBalance / h.totalValue) * 100 : 0,
        equityPct: h.totalValue > 0 ? 100 - (h.cashBalance / h.totalValue) * 100 : 0,
        cashAmount: h.cashBalance,
      }))
      // Only show if there is ever significant cash (>0.5%)
      const maxCash = Math.max(...data.map((d) => d.cashPct))
      return { res, data, hasCash: maxCash > 0.5 }
    })
    .filter((item) => item.hasCash)

  // Calculate winners for each primary metric (using safeResults to prefer non-bankrupt)
  const bestBalance = [...safeResults].sort(
    (a, b) => b.metrics.finalBalance - a.metrics.finalBalance,
  )[0]
  const bestCAGR = [...safeResults].sort((a, b) => b.metrics.cagr - a.metrics.cagr)[0]
  const bestIRR = [...safeResults].sort((a, b) => b.metrics.irr - a.metrics.irr)[0]
  const bestDrawdown = [...safeResults].sort(
    (a, b) => a.metrics.maxDrawdown - b.metrics.maxDrawdown,
  )[0] // Lowest is best
  const bestSharpe = [...safeResults].sort(
    (a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio,
  )[0]
  const bestRecoveryMonths = [...safeResults].sort(
    (a, b) => a.metrics.maxRecoveryMonths - b.metrics.maxRecoveryMonths,
  )[0] // Lowest is best
  const bestPainIndex = [...safeResults].sort(
    (a, b) => a.metrics.painIndex - b.metrics.painIndex,
  )[0] // Lowest is best
  const bestCalmar = [...safeResults].sort(
    (a, b) => b.metrics.calmarRatio - a.metrics.calmarRatio,
  )[0]

  const bankruptStrategies = results.filter((r) => r.isBankrupt)

  const sortedResults = React.useMemo(() => {
    if (!sortConfig) return results
    return [...results].sort((a, b) => {
      let aVal: string | number
      let bVal: string | number

      if (sortConfig.key === 'strategyName') {
        aVal = a.strategyName
        bVal = b.strategyName
      } else {
        aVal = a.metrics[sortConfig.key]
        bVal = b.metrics[sortConfig.key]
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [results, sortConfig])

  // 操作点数据聚合（PRD §3.5）
  const operationDots = useMemo(() => {
    const dotsMap = new Map<string, OperationDot[]>()
    chartResults.forEach((res) => {
      if (!res.history) return
      res.history.forEach((state) => {
        const dateKey = state.date
        if (!state.events || state.events.length === 0) return

        // 过滤有意义的事件
        const significantEvents = state.events.filter(
          (e) => e.type !== 'INTEREST_INC' && e.type !== 'ALERT_SENT'
        )
        if (significantEvents.length === 0) return

        if (!dotsMap.has(dateKey)) dotsMap.set(dateKey, [])
        const existing = dotsMap.get(dateKey)!

        for (const evt of significantEvents) {
          existing.push({
            date: dateKey,
            type: evt.type,
            color: DOT_COLOR[evt.type] ?? '#94a3b8',
            r: DOT_RADIUS[evt.type] ?? 3,
            strategyName: res.strategyName,
            strategyColor: res.color,
            totalValue: state.totalValue,
            description: evt.description,
            amount: evt.amount,
            phasePct: evt.phasePct,
          })
        }
      })
    })
    return dotsMap
  }, [chartResults])

  // 每个日期的主要标注点（按优先级选出一个，PRD §3.2）
  const primaryDots = useMemo(() => {
    const result: Array<{ date: string; dot: OperationDot; totalValue: number }> = []
    operationDots.forEach((dots, date) => {
      // 按优先级排序，选出每个 date 的主要标注点
      const sorted = [...dots].sort(
        (a, b) => (DOT_PRIORITY[a.type] ?? 99) - (DOT_PRIORITY[b.type] ?? 99)
      )
      const top = sorted[0]
      if (top) {
        // 找到该日期第一个策略的净值作为 Y 坐标
        result.push({ date, dot: top, totalValue: top.totalValue })
      }
    })
    return result
  }, [operationDots])

  // 市场周期识别 (PRD v1.1 §3.3) - 支持自定义阈値
  const cycleSegments = useMemo(() => {
    if (chartResults.length === 0) return []
    // 安全检查 history
    const history = chartResults[0]?.history
    if (!history || history.length === 0) return []
    return detectCycleSegments(history, cycleThresholds)
  }, [chartResults, cycleThresholds])

  const handleDownloadReport = async () => {
    setIsGeneratingReport(true)
    try {
      await generateProfessionalReport(results)
    } catch (err) {
      console.error(err)
    } finally {
      setIsGeneratingReport(false)
    }
  }

  const SortIcon = ({ column }: { column: keyof SimulationResult['metrics'] | 'strategyName' }) => {
    if (!sortConfig || sortConfig.key !== column)
      return (
        <ArrowUpDown className="w-3 h-3 ml-1 opacity-20 group-hover:opacity-100 transition-opacity" />
      )
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="w-3 h-3 ml-1 text-blue-600" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1 text-blue-600" />
    )
  }

  if (!results || results.length === 0) return null

  return (
    <div className="space-y-8">
      {showMath && <MathModelModal onClose={() => setShowMath(false)} />}

      {bankruptStrategies.length > 0 && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <AlertTriangle className="text-red-600 w-6 h-6 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-800 font-bold text-sm">{t('bankruptcyAlert')}</h3>
            <p className="text-red-700 text-xs mt-1">{t('bankruptcyDesc')}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {bankruptStrategies.map((s) => (
                <span
                  key={s.strategyName}
                  className="inline-flex items-center gap-1 bg-white border border-red-200 text-red-700 px-2 py-1 rounded text-xs font-bold"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  ></span>
                  {s.strategyName} ({s.bankruptcyDate})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Chart */}
      <div
        id="portfolio-growth-chart"
        className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm transition-all"
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-800">{t('portfolioGrowth')}</h3>
            {isSelectionMode && (
              <span className="flex items-center gap-1 text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold border border-amber-100 uppercase tracking-wider">
                <BoxSelect className="w-3 h-3" /> {t('selectionModeActive')}
              </span>
            )}
            {(zoomState.left || zoomState.right) && (
              <span className="flex items-center gap-1 text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold border border-blue-100 uppercase tracking-wider">
                <ZoomIn className="w-3 h-3" /> Zoomed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* v1.1：周期色块开关 */}
            <button
              onClick={() => setShowCycles(!showCycles)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all rounded-lg border shadow-sm active:scale-95',
                showCycles
                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
              )}
              title="显示/隐藏市场周期色块"
            >
              {showCycles ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">周期色块</span>
            </button>
            {/* PRD C6：标注点总开关 */}
            <button
              onClick={() => setShowDots(!showDots)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all rounded-lg border shadow-sm active:scale-95',
                showDots
                  ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
              )}
              title="显示/隐藏操作标注点"
            >
              {showDots ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">标注点</span>
            </button>
            <button
              onClick={() => setIsSelectionMode(!isSelectionMode)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all rounded-lg border shadow-sm active:scale-95',
                isSelectionMode
                  ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              )}
              title={t('selectionMode')}
            >
              {isSelectionMode ? (
                <BoxSelect className="w-3.5 h-3.5" />
              ) : (
                <MousePointer2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{t('selectionMode')}</span>
            </button>
            {(zoomState.left || zoomState.right) && (
              <button
                onClick={handleZoomOut}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 shadow-sm active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('resetZoom') || 'Reset Zoom'}
              </button>
            )}
            {/* v1.1: 日期区间按钮 */}
            <button
              onClick={() => { 
                const isOpen = !showDatePanel;
                setShowDatePanel(isOpen); 
                setShowThresholdPanel(false);
                // 打开时如果尚未设置，则默认填入：结束日期为系统今天，开始日期为结束日期的年初
                if (isOpen && !tempDateRange.start && !tempDateRange.end) {
                  const now = new Date();
                  const year = now.getFullYear();
                  const month = String(now.getMonth() + 1).padStart(2, '0');
                  const day = String(now.getDate()).padStart(2, '0');
                  const today = `${year}-${month}-${day}`;
                  const startOfYear = `${year}-01-01`;
                  setTempDateRange({ start: startOfYear, end: today });
                }
              }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all rounded-lg border shadow-sm active:scale-95',
                (appliedDateRange.start || appliedDateRange.end)
                  ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                  : showDatePanel
                    ? 'bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
              )}
              title="设置日期区间过滤"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">日期区间</span>
              {(appliedDateRange.start || appliedDateRange.end) && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
            </button>
            {/* v1.1: 阈值设置按钮 */}
            <button
              onClick={() => { setShowThresholdPanel(!showThresholdPanel); setShowDatePanel(false) }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all rounded-lg border shadow-sm active:scale-95',
                showThresholdPanel
                  ? 'bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
              )}
              title="调整周期识别阈值"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">周期阈值</span>
            </button>
            <p className="text-[10px] text-slate-400 font-medium hidden sm:block italic">
              {t('dragToZoom') || 'Drag to Zoom region'}
            </p>
          </div>
        </div>

        {/* v1.1: 日期区间面板 */}
        {showDatePanel && (
          <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100 flex flex-wrap gap-4 items-center">
            <span className="text-xs font-bold text-blue-700">📅 日期区间过滤</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">开始</label>
              <input
                type="date"
                value={tempDateRange.start}
                onChange={(e) => setTempDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">结束</label>
              <input
                type="date"
                value={tempDateRange.end}
                onChange={(e) => setTempDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex items-center gap-2 ml-auto sm:ml-0">
              <button
                onClick={() => setAppliedDateRange({ ...tempDateRange })}
                className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-md hover:bg-blue-700 transition-colors shadow-sm"
              >
                确认应用
              </button>
              <button
                onClick={() => {
                  setAppliedDateRange({ start: '', end: '' });
                  setTempDateRange({ start: '', end: '' });
                }}
                className="text-xs text-slate-500 hover:text-slate-700 underline px-2"
              >
                重置
              </button>
            </div>
          </div>
        )}

        {/* v1.1: 周期阈值面板 */}
        {showThresholdPanel && (
          <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700">⚙️ 市场周期识别阈值</span>
              <button
                onClick={() => setCycleThresholds({ drawdownThreshold: 0.10, recoveryThreshold: 0.10, athBuffer: 0.01, mergeGapMonths: 2 })}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                重置默认值
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">下行触发跌幅 (%)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="range" min="3" max="30" step="1"
                    value={Math.round(cycleThresholds.drawdownThreshold * 100)}
                    onChange={(e) => setCycleThresholds(prev => ({ ...prev, drawdownThreshold: Number(e.target.value) / 100 }))}
                    className="flex-1 h-1 accent-red-500"
                  />
                  <span className="text-xs font-mono text-red-600 w-8 text-right">
                    -{Math.round(cycleThresholds.drawdownThreshold * 100)}%
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">修复触发反弹 (%)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="range" min="3" max="30" step="1"
                    value={Math.round(cycleThresholds.recoveryThreshold * 100)}
                    onChange={(e) => setCycleThresholds(prev => ({ ...prev, recoveryThreshold: Number(e.target.value) / 100 }))}
                    className="flex-1 h-1 accent-green-500"
                  />
                  <span className="text-xs font-mono text-green-600 w-8 text-right">
                    +{Math.round(cycleThresholds.recoveryThreshold * 100)}%
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">新高容差 (%)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="range" min="0" max="5" step="0.5"
                    value={(cycleThresholds.athBuffer * 100).toFixed(1)}
                    onChange={(e) => setCycleThresholds(prev => ({ ...prev, athBuffer: Number(e.target.value) / 100 }))}
                    className="flex-1 h-1 accent-blue-500"
                  />
                  <span className="text-xs font-mono text-blue-600 w-8 text-right">
                    {(cycleThresholds.athBuffer * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">短段合并月数</label>
                <div className="flex items-center gap-1">
                  <input
                    type="range" min="0" max="12" step="1"
                    value={cycleThresholds.mergeGapMonths}
                    onChange={(e) => setCycleThresholds(prev => ({ ...prev, mergeGapMonths: Number(e.target.value) }))}
                    className="flex-1 h-1 accent-amber-500"
                  />
                  <span className="text-xs font-mono text-amber-600 w-8 text-right">
                    {cycleThresholds.mergeGapMonths}mo
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              💡 增大"下行触发跌幅"或"短段合并月数"可将多个小周期合并为一个大周期
            </p>
          </div>
        )}

        <div style={{ height: `${calculateChartHeight(400)}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={visibleChartData}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMouseDown={(e: any) => e && setRefAreaLeft(e.activeLabel || null)}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMouseMove={(e: any) => refAreaLeft && setRefAreaRight(e.activeLabel || null)}
              onMouseUp={handleZoom}
              {...({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onTouchStart: (e: any) => e && setRefAreaLeft(e.activeLabel || null),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onTouchMove: (e: any) => refAreaLeft && setRefAreaRight(e.activeLabel || null),
                onTouchEnd: handleZoom,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any)}
              style={{ cursor: isSelectionMode ? 'crosshair' : 'default' }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickFormatter={(val) => val.substring(0, 4)}
                stroke="#94a3b8"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#94a3b8"
                tickFormatter={(val) => `$${val / 1000}k`}
                domain={[currentGrowthConfig.minBound, currentGrowthConfig.maxBound]}
                ticks={currentGrowthConfig.ticks}
                interval={0}
                allowDataOverflow={true}
              />
              <Tooltip content={<CustomTooltip formatType="currency" operationDots={operationDots} cycleSegments={cycleSegments} />} />
              <Legend />
              {/* 隐藏锤点用于强制 Y 轴 domain */}
              <Line
                dataKey="_yAnchor"
                stroke="none"
                dot={false}
                activeDot={false}
                legendType="none"
                connectNulls
              />
              {/* 市场周期色块渲染 (PRD v1.1 §3.4) */}
              {showCycles && cycleSegments.map((seg, i) => (
                <ReferenceArea
                  key={`cycle-${i}`}
                  x1={seg.startDate}
                  x2={seg.endDate}
                  fill={CYCLE_COLORS[seg.type]}
                  fillOpacity={0.2}
                  ifOverflow="visible"
                />
              ))}
              {refAreaLeft && refAreaRight && (
                <ReferenceArea
                  x1={refAreaLeft}
                  x2={refAreaRight}
                  strokeOpacity={0.3}
                  fill="#3b82f6"
                  fillOpacity={0.1}
                />
              )}
              {/* 操作标注点（PRD §3.2） */}
              {showDots && primaryDots.map(({ date, dot, totalValue }) => (
                <ReferenceDot
                  key={`${date}-${dot.strategyName}`}
                  x={date}
                  y={totalValue}
                  r={dot.r}
                  fill={dot.color}
                  stroke="white"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              ))}
              {chartResults.map((res) => {
                const isBenchmark = res.strategyName.toLowerCase().includes('benchmark')
                return (
                  <Line
                    key={res.strategyName}
                    type="monotone"
                    dataKey={res.strategyName}
                    stroke={isBenchmark ? '#cbd5e1' : res.color}
                    strokeWidth={isBenchmark ? 1.5 : 2.5}
                    strokeDasharray={isBenchmark ? '5 5' : undefined}
                    dot={false}
                    isAnimationActive={!isLargeSet}
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>

          {/* v1.1 周期图例 (PRD §3.5) */}
          {showCycles && (
            <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 py-3 px-4 bg-slate-50 rounded-xl border border-slate-100">
              {Object.entries(CYCLE_LABELS).map(([type, label]) => (
                <div key={type} className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                  <span className="w-3 h-3 rounded shadow-sm" style={{ backgroundColor: CYCLE_COLORS[type] }} />
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>
        {isLargeSet && (
          <p className="text-[10px] text-slate-400 mt-2 text-center">
            {t('largeSetWarning') ||
              'Displaying Top 10 + Bottom 5 strategies for optimal performance.'}
          </p>
        )}
      </div>

      {/* Annual Returns Chart */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-4">{t('worstYear')}</h3>
        <div style={{ height: `${calculateChartHeight(300)}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={(() => {
                const yearMap: { [year: string]: Record<string, number | string> } = {}
                chartResults.forEach((res) => {
                  if (!res.history) return
                  const annuals = res.history.reduce(
                    (acc: Record<string, { start: number; end: number }>, h, idx) => {
                      const year = h.date.substring(0, 4)
                      if (!acc[year])
                        acc[year] = {
                          start: idx > 0 ? res.history[idx - 1].totalValue : h.totalValue,
                          end: h.totalValue,
                        }
                      else acc[year].end = h.totalValue
                      return acc
                    },
                    {},
                  )
                  Object.entries(annuals).forEach(([year, val]) => {
                    if (!yearMap[year]) yearMap[year] = { year }
                    yearMap[year][res.strategyName] =
                      val.start === 0 ? 0 : ((val.end - val.start) / val.start) * 100
                  })
                })
                return Object.values(yearMap).sort((a, b) =>
                  (a.year as string).localeCompare(b.year as string),
                )
              })()}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" unit="%" />
              <Tooltip content={<CustomTooltip formatType="percent" />} />
              <Legend iconType="circle" />
              {chartResults.map((res) => (
                <Bar
                  key={res.strategyName}
                  dataKey={res.strategyName}
                  fill={res.color}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!isLargeSet}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Drawdown Chart */}
      <div
        id="drawdown-chart"
        className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-4">{t('historicalDrawdown')}</h3>
        <div style={{ height: `${calculateChartHeight(300)}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={drawdownData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickFormatter={(val) => val.substring(0, 4)}
                stroke="#94a3b8"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#94a3b8"
                unit="%"
                domain={[
                  (dataMin: number) =>
                    Math.max(-100, -getCleanAxisConfig(0, Math.abs(dataMin)).maxBound),
                  0,
                ]}
                ticks={(() => {
                  const dataMin = results.reduce((min, res) => {
                    let peak = -Infinity
                    const m = res.history.reduce((low, h) => {
                      if (h.totalValue > peak) peak = h.totalValue
                      const dd = peak === 0 ? 0 : ((h.totalValue - peak) / peak) * 100
                      return Math.min(low, Math.max(-100, dd))
                    }, 0)
                    return Math.min(min, m)
                  }, 0)
                  const config = getCleanAxisConfig(0, Math.abs(dataMin))
                  return config.ticks
                    .filter((t) => t <= 100)
                    .map((t) => -t)
                    .reverse()
                })()}
                interval={0}
              />
              <Tooltip content={<CustomTooltip formatType="percent" />} />
              <Legend />
              {chartResults.map((res) => {
                const isBenchmark = res.strategyName.toLowerCase().includes('benchmark')
                return (
                  <Line
                    key={res.strategyName}
                    type="monotone"
                    dataKey={res.strategyName}
                    stroke={isBenchmark ? '#cbd5e1' : res.color}
                    strokeWidth={isBenchmark ? 1.5 : 2}
                    strokeDasharray={isBenchmark ? '5 5' : undefined}
                    dot={false}
                    isAnimationActive={!isLargeSet}
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Beta Chart */}
      <div id="beta-chart" className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-lg font-bold text-slate-800">{t('betaChartTitle')}</h3>
          <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded font-bold border border-blue-200 flex items-center gap-1">
            <Zap className="w-3 h-3" /> Risk
          </span>
        </div>
        <p className="text-sm text-slate-500 mb-4">{t('betaChartDesc')}</p>
        <div style={{ height: `${calculateChartHeight(300)}px` }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={betaData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickFormatter={(val) => val.substring(0, 4)}
                stroke="#94a3b8"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="#94a3b8"
                domain={[
                  0,
                  (dataMax: number) => getCleanAxisConfig(0, Math.max(1, dataMax), 5).maxBound,
                ]}
                ticks={(() => {
                  const dataMax = results.reduce((max, res) => {
                    if (!res.history) return max
                    const hMax = res.history.reduce((m, h) => Math.max(m, h.beta), 0)
                    return Math.max(max, hMax)
                  }, 0)
                  return getCleanAxisConfig(0, Math.max(1, dataMax), 5).ticks
                })()}
                interval={0}
              />
              <Tooltip content={<CustomTooltip formatType="number" />} />
              <Legend />
              {chartResults.map((res) => {
                const isBenchmark = res.strategyName.toLowerCase().includes('benchmark')
                return (
                  <Line
                    key={res.strategyName}
                    type="monotone"
                    dataKey={res.strategyName}
                    stroke={isBenchmark ? '#cbd5e1' : res.color}
                    strokeWidth={isBenchmark ? 1.5 : 2}
                    strokeDasharray={isBenchmark ? '5 5' : undefined}
                    dot={false}
                    name={`${res.strategyName} Beta`}
                    isAnimationActive={!isLargeSet}
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LTV Chart - Only visible if leverage is used */}
      {leveragedProfiles.length > 0 && (
        <div id="ltv-chart" className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-bold text-slate-800">{t('ltvChartTitle')}</h3>
            <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded font-bold border border-yellow-200 flex items-center gap-1">
              <Scale className="w-3 h-3" /> Leveraged
            </span>
          </div>
          <p className="text-sm text-slate-500 mb-4">{t('ltvChartDesc')}</p>
          <div style={{ height: `${calculateChartHeight(300)}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ltvData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(val) => val.substring(0, 4)}
                  stroke="#94a3b8"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="#94a3b8"
                  unit="%"
                  domain={[
                    0,
                    (dataMax: number) =>
                      Math.min(100, getCleanAxisConfig(0, Math.max(10, dataMax), 5).maxBound),
                  ]}
                  ticks={(() => {
                    const dataMax = results.reduce((max, res) => {
                      if (!res.history) return max
                      const hMax = res.history.reduce((m, h) => Math.max(m, h.ltv), 0)
                      return Math.max(max, hMax)
                    }, 0)
                    const config = getCleanAxisConfig(0, Math.max(10, dataMax), 5)
                    return config.ticks.filter((t) => t <= 100)
                  })()}
                  interval={0}
                  allowDataOverflow={false}
                />
                <Tooltip content={<CustomTooltip formatType="percent" />} />
                <Legend iconType="circle" />
                {chartResults.map((res) => (
                  <Line
                    key={res.strategyName}
                    type="monotone"
                    dataKey={res.strategyName}
                    stroke={res.color}
                    strokeWidth={2}
                    dot={false}
                    name={`${res.strategyName} LTV`}
                    isAnimationActive={!isLargeSet}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Cash Exposure Grid */}
      {cashCharts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="md:col-span-2 lg:col-span-3">
            <h3 className="text-lg font-bold text-slate-800">{t('cashAllocationAnalysis')}</h3>
            <p className="text-sm text-slate-500">{t('cashAnalysisDesc')}</p>
          </div>
          {cashCharts.map(({ res, data }) => (
            <div
              key={res.strategyName}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col"
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: res.color }}
                ></span>
                <h4 className="font-bold text-sm text-slate-700">{res.strategyName}</h4>
              </div>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(val) => val.substring(0, 4)}
                      stroke="#cbd5e1"
                      minTickGap={50}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#cbd5e1" unit="%" />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10 }}
                      stroke="#047857"
                      tickFormatter={(val) =>
                        `$${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`
                      }
                    />
                    <Tooltip content={<CustomTooltip formatType="auto" />} />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="equityPct"
                      stackId="1"
                      stroke={res.color}
                      fill={res.color}
                      fillOpacity={0.6}
                      name={t('equityPct')}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="cashPct"
                      stackId="1"
                      stroke="#16a34a"
                      fill="#10b981"
                      fillOpacity={0.5}
                      name={t('cashPct')}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="cashAmount"
                      stroke="#047857"
                      strokeWidth={2}
                      dot={false}
                      name={t('cashAmount')}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Performance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">{t('perfComparison')}</h3>
            <button
              onClick={() => setShowMath(true)}
              className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-1 rounded-full transition-colors"
              title={t('math_title')}
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleDownloadReport}
            disabled={isGeneratingReport}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              isGeneratingReport
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md'
            }`}
          >
            <FileDown className={`w-4 h-4 ${isGeneratingReport ? 'animate-bounce' : ''}`} />
            {isGeneratingReport ? '...' : t('downloadReport')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th
                  className="px-4 py-3 cursor-pointer group select-none"
                  onClick={() => handleSort('strategyName')}
                >
                  <div className="flex items-center">
                    {t('col_strategy')}
                    <SortIcon column="strategyName" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('finalBalance')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_balance')}
                    <SortIcon column="finalBalance" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('cagr')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_cagr')}
                    <SortIcon column="cagr" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('irr')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_irr')}
                    <SortIcon column="irr" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('maxDrawdown')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_maxDD')}
                    <SortIcon column="maxDrawdown" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('sharpeRatio')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_sharpe')}
                    <SortIcon column="sharpeRatio" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('calmarRatio')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_calmar')}
                    <SortIcon column="calmarRatio" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right cursor-pointer group select-none"
                  onClick={() => handleSort('painIndex')}
                >
                  <div className="flex items-center justify-end">
                    {t('col_pain')}
                    <SortIcon column="painIndex" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((res) => (
                <tr
                  key={res.strategyName}
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${res.isBankrupt ? 'bg-red-50 hover:bg-red-100' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-900 flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: res.color }}
                    ></span>
                    {res.strategyName}
                    {res.isBankrupt && (
                      <span title="Bankrupt">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    ${Math.round(res.metrics.finalBalance).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">
                    {res.metrics.cagr.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right text-blue-600 font-medium">
                    {res.metrics.irr.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right text-red-500">
                    {res.metrics.maxDrawdown.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {res.metrics.sharpeRatio.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-orange-600 font-medium">
                    {res.metrics.calmarRatio.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-purple-600 font-medium">
                    {res.metrics.painIndex.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Results Perspectives */}
      <div className="space-y-6">
        {/* Perspective: Absolute Return */}
        <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-2 mb-4 px-1">
            <Trophy className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-slate-800">{t('perspective_return')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title={t('bestBalance')}
              value={bestBalance ? `$${Math.round(bestBalance.metrics.finalBalance).toLocaleString()}` : '--'}
              icon={<TrendingUp className="w-5 h-5" />}
              winnerName={bestBalance?.strategyName || '--'}
              winnerColor={bestBalance?.color || '#ccc'}
              highlight
            />
            <MetricCard
              title={t('bestCagr')}
              value={bestCAGR ? `${bestCAGR.metrics.cagr.toFixed(2)}%` : '--'}
              icon={<Zap className="w-5 h-5" />}
              winnerName={bestCAGR?.strategyName || '--'}
              winnerColor={bestCAGR?.color || '#ccc'}
              highlight
            />
            <MetricCard
              title={t('bestIrr')}
              value={bestIRR ? `${bestIRR.metrics.irr.toFixed(2)}%` : '--'}
              icon={<Zap className="w-5 h-5" />}
              winnerName={bestIRR?.strategyName || '--'}
              winnerColor={bestIRR?.color || '#ccc'}
              highlight
            />
          </div>
        </div>

        {/* Perspective: Risk & Drawdown */}
        <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-2 mb-4 px-1">
            <ShieldAlert className="w-5 h-5 text-red-500" />
            <h3 className="font-bold text-slate-800">{t('perspective_risk')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title={t('lowestDrawdown')}
              value={bestDrawdown ? `${bestDrawdown.metrics.maxDrawdown.toFixed(2)}%` : '--'}
              icon={<ShieldAlert className="w-5 h-5" />}
              winnerName={bestDrawdown?.strategyName || '--'}
              winnerColor={bestDrawdown?.color || '#ccc'}
            />
            <MetricCard
              title={t('maxRecoveryTime')}
              value={bestRecoveryMonths ? `${bestRecoveryMonths.metrics.maxRecoveryMonths} ${t('recoveryMonths')}` : '--'}
              icon={<Clock className="w-5 h-5" />}
              winnerName={bestRecoveryMonths?.strategyName || '--'}
              winnerColor={bestRecoveryMonths?.color || '#ccc'}
            />
            <MetricCard
              title={t('painIndex')}
              value={bestPainIndex ? `${bestPainIndex.metrics.painIndex.toFixed(2)}` : '--'}
              icon={<Percent className="w-5 h-5" />}
              winnerName={bestPainIndex?.strategyName || '--'}
              winnerColor={bestPainIndex?.color || '#ccc'}
            />
          </div>
        </div>

        {/* Perspective: Risk-Reward Ratio */}
        <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-2 mb-4 px-1">
            <Scale className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-slate-800">{t('perspective_ratio')}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title={t('bestSharpe')}
              value={bestSharpe ? bestSharpe.metrics.sharpeRatio.toFixed(2) : '--'}
              icon={<Activity className="w-5 h-5" />}
              winnerName={bestSharpe?.strategyName || '--'}
              winnerColor={bestSharpe?.color || '#ccc'}
            />
            <MetricCard
              title={t('calmarRatio')}
              value={bestCalmar ? `${bestCalmar.metrics.calmarRatio.toFixed(2)}` : '--'}
              icon={<Scale className="w-5 h-5" />}
              winnerName={bestCalmar?.strategyName || '--'}
              winnerColor={bestCalmar?.color || '#ccc'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
