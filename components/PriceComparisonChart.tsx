import React, { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { MarketDataRow } from '../types'
import { calculateSMA } from '../services/maUtils'
import { useTranslation } from '../services/i18n'

// ----------------------------------------------------------------
// 类型定义
// ----------------------------------------------------------------

interface TickerSeries {
  ticker: string
  color: string
  prices: number[]
}

interface PriceComparisonChartProps {
  data: MarketDataRow[] // 市场数据（按时间升序）
  tickers: TickerSeries[] // 要展示的标的列表
  showSMA?: boolean // 是否叠加均线
}

type TimeRange = '1Y' | '3Y' | 'ALL'

// ----------------------------------------------------------------
// 归一化工具
// ----------------------------------------------------------------

const normalizeToBase100 = (prices: number[]): (number | null)[] => {
  const first = prices.find((p) => p > 0)
  if (!first) return prices.map(() => null)
  return prices.map((p) => (p > 0 ? (p / first) * 100 : null))
}

// ----------------------------------------------------------------
// 颜色（均线固定颜色，PRD A3 规范）
// ----------------------------------------------------------------
const SMA_COLORS = {
  '20M': '#f59e0b',
  '50M': '#3b82f6',
  '200M': '#8b5cf6',
}

// ----------------------------------------------------------------
// 组件
// ----------------------------------------------------------------

export const PriceComparisonChart: React.FC<PriceComparisonChartProps> = ({
  data,
  tickers,
  showSMA = true,
}) => {
  const { t } = useTranslation()
  const [timeRange, setTimeRange] = useState<TimeRange>('ALL')
  const [smaVisible, setSmaVisible] = useState(showSMA)

  // 根据时间范围筛选数据
  const filteredData = useMemo(() => {
    if (timeRange === 'ALL') return data
    const now = new Date()
    const months = timeRange === '1Y' ? 12 : 36
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1)
    return data.filter((row) => new Date(row.date) >= cutoff)
  }, [data, timeRange])

  // 组装图表数据点
  const chartData = useMemo(() => {
    if (filteredData.length === 0) return []

    // 各标的的原始价格（与 filteredData 对齐）
    const priceArrays: Record<string, number[]> = {}
    for (const ts of tickers) {
      priceArrays[ts.ticker] = ts.prices.slice(
        data.length - filteredData.length,
      )
    }

    // 归一化
    const normalizedArrays: Record<string, (number | null)[]> = {}
    for (const ts of tickers) {
      normalizedArrays[ts.ticker] = normalizeToBase100(priceArrays[ts.ticker])
    }

    // SMA（基于 QQQ，若有的话）
    const qqqPrices = priceArrays['QQQ'] ?? (tickers[0] ? priceArrays[tickers[0].ticker] : [])
    const sma20 = calculateSMA(qqqPrices, 20)
    const sma50 = calculateSMA(qqqPrices, 50)
    const sma200 = calculateSMA(qqqPrices, 200)

    const sma20Normalized = normalizeToBase100(sma20.map((v) => v ?? 0).filter((v) => v > 0))
    void sma20Normalized // 将在各 index 单独处理

    return filteredData.map((row, i) => {
      const point: Record<string, unknown> = {
        date: row.date.substring(0, 7), // YYYY-MM
      }

      // 各标的归一化价格
      for (const ts of tickers) {
        const val = normalizedArrays[ts.ticker][i]
        if (val !== null) point[ts.ticker] = parseFloat(val.toFixed(2))
      }

      // 均线（使用 QQQ 的均线）
      if (smaVisible) {
        const base = qqqPrices[0] > 0 ? qqqPrices[0] : 1
        if (sma20[i] !== null) point['SMA20M'] = parseFloat(((sma20[i]! / base) * 100).toFixed(2))
        if (sma50[i] !== null) point['SMA50M'] = parseFloat(((sma50[i]! / base) * 100).toFixed(2))
        if (sma200[i] !== null) point['SMA200M'] = parseFloat(((sma200[i]! / base) * 100).toFixed(2))
      }

      return point
    })
  }, [filteredData, tickers, data.length, smaVisible])

  // 计算各标的当前涨跌幅（相对起始点）
  const currentChanges = useMemo(() => {
    const result: Record<string, number> = {}
    for (const ts of tickers) {
      const prices = ts.prices.slice(data.length - filteredData.length)
      const first = prices.find((p) => p > 0) ?? 0
      const last = prices[prices.length - 1] ?? 0
      result[ts.ticker] = first > 0 ? ((last - first) / first) * 100 : 0
    }
    return result
  }, [filteredData, tickers, data.length])

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        暂无数据
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 uppercase font-bold">时间范围</span>
          {(['1Y', '3Y', 'ALL'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {range === '1Y' ? '近1年' : range === '3Y' ? '近3年' : '全部'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSmaVisible((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            smaVisible ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SMA_COLORS['200M'] }} />
          {t('sma') || '均线'}
        </button>
      </div>

      {/* 图表 */}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            interval={Math.floor(filteredData.length / 6)}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)} (基准=100)`,
              name,
            ]}
          />
          <Legend
            formatter={(value) => {
              const change = currentChanges[value]
              if (change !== undefined) {
                return `${value} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)`
              }
              return value
            }}
            wrapperStyle={{ fontSize: 10 }}
          />
          <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 2" strokeWidth={1} />

          {/* 标的价格线 */}
          {tickers.map((ts) => (
            <Line
              key={ts.ticker}
              type="monotone"
              dataKey={ts.ticker}
              stroke={ts.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          ))}

          {/* 均线叠加 */}
          {smaVisible && (
            <>
              <Line
                type="monotone"
                dataKey="SMA20M"
                name="20M均线"
                stroke={SMA_COLORS['20M']}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="SMA50M"
                name="50M均线"
                stroke={SMA_COLORS['50M']}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="SMA200M"
                name="200M均线"
                stroke={SMA_COLORS['200M']}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                connectNulls
              />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-slate-400 text-center">
        归一化指数（起始日 = 100），便于不同价格量级标的对比
      </p>
    </div>
  )
}

export default PriceComparisonChart
