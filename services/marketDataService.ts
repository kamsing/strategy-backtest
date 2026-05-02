// 历史市场数据抓取服务
// 数据源优先级：
//   1. Yahoo Finance 直连
//   2. Yahoo Finance via allorigins.win 代理
//   3. Stooq 直连
//   4. Stooq via allorigins.win 代理
// 使用 localStorage 缓存（24小时有效期），减少重复网络请求

export interface TickerMonthlyData {
  month: string // 格式：'YYYY-MM'
  low: number
  close: number
}

// 缓存有效期：24小时（毫秒）
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// 缓存键前缀
const CACHE_KEY_PREFIX = 'ticker_cache_'

interface CacheEntry {
  timestamp: number
  data: TickerMonthlyData[]
}

// ----------------------------------------------------------------
// localStorage 缓存操作
// ----------------------------------------------------------------

// 从 localStorage 读取缓存数据
const readCache = (symbol: string): TickerMonthlyData[] | null => {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${symbol.toUpperCase()}`)
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    // 检查缓存是否过期
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${symbol.toUpperCase()}`)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

// 将数据写入 localStorage 缓存
const writeCache = (symbol: string, data: TickerMonthlyData[]): void => {
  try {
    const entry: CacheEntry = { timestamp: Date.now(), data }
    localStorage.setItem(`${CACHE_KEY_PREFIX}${symbol.toUpperCase()}`, JSON.stringify(entry))
  } catch {
    // localStorage 写入失败（如存储已满）时静默忽略
  }
}

// ----------------------------------------------------------------
// 数据格式转换工具
// ----------------------------------------------------------------

// 将 Unix 时间戳转换为 'YYYY-MM' 格式
const timestampToMonth = (ts: number): string => {
  const d = new Date(ts * 1000)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

// 将 YYYY-MM-DD 日期字符串转换为 'YYYY-MM' 格式
const dateStringToMonth = (dateStr: string): string => {
  return dateStr.substring(0, 7) // 'YYYY-MM-DD' -> 'YYYY-MM'
}

// ----------------------------------------------------------------
// 数据源 1：Yahoo Finance
// ----------------------------------------------------------------

// Yahoo Finance Chart API 响应结构（仅定义需要的字段）
interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[]
      indicators: {
        quote: Array<{
          close: (number | null)[]
          low: (number | null)[]
        }>
      }
    }> | null
    error: { message: string } | null
  }
}

// 解析 Yahoo Finance API JSON 响应
const parseYahooResponse = (jsonData: YahooChartResponse): TickerMonthlyData[] => {
  if (!jsonData?.chart?.result || jsonData.chart.result.length === 0) {
    const errMsg = jsonData?.chart?.error?.message || '未找到该标的数据'
    throw new Error(errMsg)
  }

  const result = jsonData.chart.result[0]
  const timestamps = result.timestamp
  const closes = result.indicators.quote[0]?.close ?? []
  const lows = result.indicators.quote[0]?.low ?? []

  if (!timestamps || timestamps.length === 0) {
    throw new Error('无历史价格数据')
  }

  // 同月数据取最后一条（月末收盘），过滤无效价格
  const monthMap = new Map<string, TickerMonthlyData>()
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    const low = lows[i]
    if (!close || !low || close <= 0 || low <= 0) continue
    const month = timestampToMonth(timestamps[i])
    monthMap.set(month, {
      month,
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
    })
  }

  return Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month))
}

// 尝试从 Yahoo Finance 直连获取数据
const fetchFromYahooDirect = async (symbol: string): Promise<TickerMonthlyData[]> => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=max&includeAdjustedClose=true`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000), // 8秒超时
  })
  if (!resp.ok) throw new Error(`Yahoo 直连失败: HTTP ${resp.status}`)
  const json: YahooChartResponse = await resp.json()
  const data = parseYahooResponse(json)
  if (data.length === 0) throw new Error('Yahoo 返回数据为空')
  return data
}

// 尝试通过 allorigins 代理访问 Yahoo Finance
const fetchFromYahooProxy = async (symbol: string): Promise<TickerMonthlyData[]> => {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=max`
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`
  const resp = await fetch(proxyUrl, {
    signal: AbortSignal.timeout(12000), // 代理请求允许更长超时
  })
  if (!resp.ok) throw new Error(`Yahoo 代理失败: HTTP ${resp.status}`)
  const wrapper: { contents: string } = await resp.json()
  const json: YahooChartResponse = JSON.parse(wrapper.contents)
  const data = parseYahooResponse(json)
  if (data.length === 0) throw new Error('Yahoo 代理返回数据为空')
  return data
}

// ----------------------------------------------------------------
// 数据源 2：Stooq（免费、无需 API Key，CSV 格式）
// ----------------------------------------------------------------

// Stooq 月度 CSV URL 格式（美股加 .US 后缀）
const buildStooqUrl = (symbol: string): string =>
  `https://stooq.com/q/d/l/?s=${symbol}.US&i=m`

// 解析 Stooq 返回的 CSV 字符串
// CSV 格式：Date,Open,High,Low,Close,Volume
// 日期格式：YYYY-MM-DD（每月最后一个交易日）
const parseStooqCsv = (csv: string): TickerMonthlyData[] => {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) throw new Error('Stooq CSV 数据行数不足')

  const header = lines[0].toLowerCase()
  if (!header.includes('date') || !header.includes('close')) {
    throw new Error('Stooq CSV 格式不符合预期')
  }

  // 检测是否为错误响应（如标的不存在）
  if (csv.includes('No data') || csv.includes('404') || lines.length < 3) {
    throw new Error('Stooq 未找到该标的数据，请检查股票代码')
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const dateIdx = headers.indexOf('date')
  const closeIdx = headers.indexOf('close')
  const lowIdx = headers.indexOf('low')

  if (dateIdx === -1 || closeIdx === -1) throw new Error('Stooq CSV 缺少必要字段')

  const monthMap = new Map<string, TickerMonthlyData>()

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < Math.max(dateIdx, closeIdx, lowIdx) + 1) continue

    const dateStr = cols[dateIdx]?.trim()
    const closeStr = cols[closeIdx]?.trim()
    const lowStr = lowIdx !== -1 ? cols[lowIdx]?.trim() : closeStr

    if (!dateStr || !closeStr) continue

    const close = parseFloat(closeStr)
    const low = lowStr ? parseFloat(lowStr) : close

    if (isNaN(close) || close <= 0) continue

    const month = dateStringToMonth(dateStr)
    // 同月取最新数据（Stooq 返回降序，所以第一条即最新）
    if (!monthMap.has(month)) {
      monthMap.set(month, {
        month,
        low: parseFloat((isNaN(low) || low <= 0 ? close : low).toFixed(4)),
        close: parseFloat(close.toFixed(4)),
      })
    }
  }

  const result = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month))
  if (result.length === 0) throw new Error('Stooq CSV 解析后无有效数据')
  return result
}

// 尝试通过 allorigins 代理访问 Stooq（Stooq 不支持跨域直连）
const fetchFromStooqProxy = async (symbol: string): Promise<TickerMonthlyData[]> => {
  const stooqUrl = buildStooqUrl(symbol)
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(stooqUrl)}`
  const resp = await fetch(proxyUrl, {
    signal: AbortSignal.timeout(12000),
  })
  if (!resp.ok) throw new Error(`Stooq 代理失败: HTTP ${resp.status}`)
  const wrapper: { contents: string } = await resp.json()
  const data = parseStooqCsv(wrapper.contents)
  return data
}

// 尝试直连 Stooq（部分环境下可行）
const fetchFromStooqDirect = async (symbol: string): Promise<TickerMonthlyData[]> => {
  const url = buildStooqUrl(symbol)
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(8000),
  })
  if (!resp.ok) throw new Error(`Stooq 直连失败: HTTP ${resp.status}`)
  const text = await resp.text()
  return parseStooqCsv(text)
}

// ----------------------------------------------------------------
// 主要导出函数
// ----------------------------------------------------------------

/**
 * 从多数据源抓取月度历史数据（带4级回退策略）
 * 优先级：Yahoo直连 → Yahoo代理 → Stooq直连 → Stooq代理
 *
 * @param symbol - 股票代码，如 'TQQQ'
 * @param useCache - 是否使用缓存（默认 true），传入 false 可强制刷新
 * @returns 月度数据数组，按时间升序排列
 */
export const fetchTickerMonthlyData = async (
  symbol: string,
  useCache = true,
): Promise<TickerMonthlyData[]> => {
  const upperSymbol = symbol.toUpperCase().trim()
  if (!upperSymbol) throw new Error('股票代码不能为空')

  // 读取缓存（可选跳过）
  if (useCache) {
    const cached = readCache(upperSymbol)
    if (cached && cached.length > 0) {
      return cached
    }
  }

  // 记录每个数据源的错误信息，最终汇总报告
  const errors: string[] = []

  // ---- 数据源 1：Yahoo Finance 直连 ----
  try {
    const data = await fetchFromYahooDirect(upperSymbol)
    writeCache(upperSymbol, data)
    return data
  } catch (e) {
    errors.push(`Yahoo直连: ${(e as Error).message}`)
  }

  // ---- 数据源 2：Yahoo Finance via allorigins 代理 ----
  try {
    const data = await fetchFromYahooProxy(upperSymbol)
    writeCache(upperSymbol, data)
    return data
  } catch (e) {
    errors.push(`Yahoo代理: ${(e as Error).message}`)
  }

  // ---- 数据源 3：Stooq 直连 ----
  try {
    const data = await fetchFromStooqDirect(upperSymbol)
    writeCache(upperSymbol, data)
    return data
  } catch (e) {
    errors.push(`Stooq直连: ${(e as Error).message}`)
  }

  // ---- 数据源 4：Stooq via allorigins 代理 ----
  try {
    const data = await fetchFromStooqProxy(upperSymbol)
    writeCache(upperSymbol, data)
    return data
  } catch (e) {
    errors.push(`Stooq代理: ${(e as Error).message}`)
  }

  // 所有数据源均失败，抛出汇总错误
  throw new Error(
    `无法获取 ${upperSymbol} 的历史数据（已尝试 4 个数据源）:\n${errors.join('\n')}`,
  )
}

/**
 * 强制刷新：清除缓存并重新抓取
 * @param symbol - 股票代码
 */
export const refetchTickerMonthlyData = async (symbol: string): Promise<TickerMonthlyData[]> => {
  const upperSymbol = symbol.toUpperCase().trim()
  clearTickerCache(upperSymbol)
  return fetchTickerMonthlyData(upperSymbol, false)
}

/**
 * 清除指定标的的本地缓存
 * @param symbol - 股票代码
 */
export const clearTickerCache = (symbol: string): void => {
  localStorage.removeItem(`${CACHE_KEY_PREFIX}${symbol.toUpperCase()}`)
}

/**
 * 检查标的缓存是否存在且未过期
 * @param symbol - 股票代码
 */
export const isTickerCached = (symbol: string): boolean => {
  return readCache(symbol) !== null
}
