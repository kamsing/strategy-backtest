import { MarketDataRow } from './types'
import qqqHistory from './data/qqq-history.json'
import qldHistory from './data/qld-history.json'
import { TickerHistoryData } from './services/marketDataService'

// ----------------------------------------------------------------
// 基础数据：QQQ + QLD 月度历史（静态 JSON）
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// 基础数据：QQQ + QLD 月度历史（静态 JSON + 本地缓存）
// ----------------------------------------------------------------
/**
 * 核心逻辑：从静态 JSON 开始，尝试合并本地 localStorage 中的最新缓存数据，以延伸回测范围。
 */
export const getExtendedMarketData = (): MarketDataRow[] => {
  // 1. 加载静态基础数据
  const qqqMap = new Map<string, any>()
  qqqHistory.forEach((item: any) => qqqMap.set(item.month || item.date, item))
  
  const qldMap = new Map<string, any>()
  qldHistory.forEach((item: any) => qldMap.set(item.month || item.date, item))

  // 2. 尝试从 localStorage 合并更新的数据 (Issue #1)
  if (typeof localStorage !== 'undefined') {
    const qqqCache = localStorage.getItem('ticker_daily_cache_v2_QQQ')
    const qldCache = localStorage.getItem('ticker_daily_cache_v2_QLD')
    
    if (qqqCache) {
      try {
        const entry = JSON.parse(qqqCache)
        const data = Array.isArray(entry) ? entry : (entry.data || [])
        if (data.length > 500) { // 简单校验：如果是每日数据，点数应较多
          qqqMap.clear() // 有每日数据时，清空静态月度数据，以每日数据为准
          data.forEach((item: any) => qqqMap.set(item.date || item.month, item))
        } else {
          data.forEach((item: any) => qqqMap.set(item.date || item.month, item))
        }
      } catch (e) {}
    }
    if (qldCache) {
      try {
        const entry = JSON.parse(qldCache)
        const data = Array.isArray(entry) ? entry : (entry.data || [])
        if (data.length > 500) {
          qldMap.clear() 
          data.forEach((item: any) => qldMap.set(item.date || item.month, item))
        } else {
          data.forEach((item: any) => qldMap.set(item.date || item.month, item))
        }
      } catch (e) {}
    }
  }

  // 3. 取两者共有日期（交集）
  const allDates = Array.from(new Set([...qqqMap.keys(), ...qldMap.keys()])).sort()

  return allDates
    .map((dateKey) => {
      const qqqData = qqqMap.get(dateKey)
      const qldData = qldMap.get(dateKey)

      // 规范化日期格式 YYYY-MM -> YYYY-MM-01
      const normalizedDate = dateKey.length === 7 ? `${dateKey}-01` : dateKey

      return {
        date: normalizedDate,
        qqqClose: qqqData?.close ?? 0,
        qqqLow: qqqData?.low ?? 0,
        qldClose: qldData?.close ?? 0,
        qldLow: qldData?.low ?? 0,
      }
    })
    .filter((row) => row.qqqClose > 0 && row.qldClose > 0)
}

// 默认导出初始静态数据，但在 App.tsx 运行前会调用 getExtendedMarketData
export const MARKET_DATA: MarketDataRow[] = getExtendedMarketData()

// ----------------------------------------------------------------
// 动态合并函数：将第三标的数据融合进 MarketDataRow[]
// ----------------------------------------------------------------
/**
 * 将自定义标的（如 TQQQ）的历史数据合并进基础市场数据中。
 */
export const buildMarketDataWithCustom = (
  customData: TickerHistoryData[],
  baseData?: MarketDataRow[]
): MarketDataRow[] => {
  // 构建自定义标的索引
  const customMap = new Map<string, TickerHistoryData>()
  customData.forEach(item => customMap.set(item.date, item))

  const actualBaseData = baseData || getExtendedMarketData()

  // 匹配逻辑
  return actualBaseData
    .map((row) => {
      // 1. 尝试精确匹配日期 (YYYY-MM-DD)
      let customItem = customMap.get(row.date)
      
      // 2. 如果基础数据是月末点 (YYYY-MM-01)，且 custom 数据中没有，尝试匹配该月份 (YYYY-MM)
      if (!customItem && row.date.endsWith('-01')) {
        const month = row.date.substring(0, 7)
        // 搜索该月份的所有数据，取最后一天（最接近月末）
        const monthData = customData.filter(d => d.date.startsWith(month))
        if (monthData.length > 0) {
          customItem = monthData[monthData.length - 1]
        }
      }

      if (!customItem) return null

      return {
        ...row,
        customClose: customItem.close,
        customLow: customItem.low,
      } as MarketDataRow
    })
    .filter((row): row is MarketDataRow => row !== null)
}

// ----------------------------------------------------------------
// v1.1 市场周期识别参数 (PRD §3.3)
// ----------------------------------------------------------------
export const CYCLE_PARAMS = {
  PEAK_CONFIRMATION_MONTHS: 3, // 高点确认所需月数
  DRAWDOWN_THRESHOLD: 0.10,    // 触发下行阶段的最小跌幅
  RECOVERY_THRESHOLD: 0.10,    // 从低点反弹确认修复的最小涨幅
  ATH_BUFFER: 0.01,            // 突破前高的容差
}

// v1.1 周期显示配置 (PRD §3.4)
export const CYCLE_COLORS: Record<string, string> = {
  CYCLE_PEAK: '#fef08a',     // 黄
  CYCLE_DRAWDOWN: '#fecaca', // 红
  CYCLE_RECOVERY: '#bbf7d0', // 绿
  CYCLE_NEW_HIGH: '#bfdbfe', // 蓝
}

export const CYCLE_LABELS: Record<string, string> = {
  CYCLE_PEAK: '周期高点',
  CYCLE_DRAWDOWN: '下行阶段',
  CYCLE_RECOVERY: '周期修复',
  CYCLE_NEW_HIGH: '新周期开始',
}
