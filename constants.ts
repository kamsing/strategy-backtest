import { MarketDataRow } from './types'
import qqqHistory from './data/qqq-history.json'
import qldHistory from './data/qld-history.json'
import type { TickerMonthlyData } from './services/marketDataService'

// ----------------------------------------------------------------
// 基础数据：QQQ + QLD 月度历史（静态 JSON）
// ----------------------------------------------------------------
export const MARKET_DATA: MarketDataRow[] = (() => {
  // 构建月份索引 Map
  const qqqMap = new Map(
    qqqHistory.map((item: { month: string; low: number; close: number }) => [item.month, item]),
  )
  const qldMap = new Map(
    qldHistory.map((item: { month: string; low: number; close: number }) => [item.month, item]),
  )

  // 取两者共有月份（需同时有 QQQ 和 QLD 数据）
  const months = Array.from(new Set([...qqqMap.keys(), ...qldMap.keys()])).sort()

  return months
    .map((month) => {
      const qqqData = qqqMap.get(month)
      const qldData = qldMap.get(month)

      return {
        date: `${month}-01`, // 'YYYY-MM' -> 'YYYY-MM-01'
        qqqClose: qqqData?.close ?? 0,
        qqqLow: qqqData?.low ?? 0,
        qldClose: qldData?.close ?? 0,
        qldLow: qldData?.low ?? 0,
      }
    })
    .filter((row) => row.qqqClose > 0 && row.qldClose > 0)
})()

// ----------------------------------------------------------------
// 动态合并函数：将第三标的数据融合进 MarketDataRow[]
// ----------------------------------------------------------------
/**
 * 将自定义标的（如 TQQQ）的月度数据合并进基础市场数据中。
 * 仅保留三者同时有数据的月份（交集），以保证模拟引擎正常运行。
 *
 * @param customData - 第三标的月度数据数组
 * @returns 合并后的 MarketDataRow[]，包含 customClose / customLow 字段
 */
export const buildMarketDataWithCustom = (
  customData: TickerMonthlyData[],
): MarketDataRow[] => {
  // 构建自定义标的月份索引
  const customMap = new Map(customData.map((item) => [item.month, item]))

  // 取三者共有月份交集
  return MARKET_DATA
    .map((row) => {
      const month = row.date.substring(0, 7) // 'YYYY-MM-DD' -> 'YYYY-MM'
      const customItem = customMap.get(month)
      if (!customItem) return null // 无自定义数据的月份跳过

      return {
        ...row,
        customClose: customItem.close,
        customLow: customItem.low,
      }
    })
    .filter((row): row is MarketDataRow => row !== null)
}
