// 历史市场数据抓取服务
// 数据源优先级：
//   1. Yahoo Finance 直连
//   2. Yahoo Finance via allorigins.win 代理
//   3. Stooq 直连
//   4. Stooq via allorigins.win 代理
// 使用 localStorage 缓存（24小时有效期），减少重复网络请求

export interface TickerHistoryData {
  date: string // 格式：'YYYY-MM-DD'
  low: number
  close: number
}

// 缓存有效期：24小时（毫秒）
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// 缓存键前缀（更新版本以强制刷新每日数据）
const CACHE_KEY_PREFIX = 'ticker_daily_cache_v2_'

interface CacheEntry {
  timestamp: number
  data: TickerHistoryData[]
}

// ----------------------------------------------------------------
// localStorage 缓存操作
// ----------------------------------------------------------------

// 从 localStorage 读取缓存数据
const readCache = (symbol: string): TickerHistoryData[] | null => {
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
const writeCache = (symbol: string, data: TickerHistoryData[]): void => {
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

// 将 YYYY-MM-DD 日期对象转换为 'YYYY-MM-DD' 格式
const formatDateToISO = (d: Date): string => {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
const parseYahooResponse = (jsonData: YahooChartResponse): TickerHistoryData[] => {
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

  const resultList: TickerHistoryData[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    const low = lows[i]
    if (!close || !low || close <= 0 || low <= 0) continue
    resultList.push({
      date: formatDateToISO(new Date(timestamps[i] * 1000)),
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
    })
  }

  return resultList.sort((a, b) => a.date.localeCompare(b.date))
}

// ---- JSONP 助手：绕过 CORS 的利器 ----
const fetchJsonp = (url: string, callbackName: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('JSONP 请求超时'))
    }, 15000)

    const cleanup = () => {
      clearTimeout(timeout)
      script.remove()
      delete (window as any)[callbackName]
    }

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      resolve(data)
    }

    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${callbackName}`
    script.onerror = () => {
      cleanup()
      reject(new Error('JSONP 脚本加载失败'))
    }
    document.body.appendChild(script)
  })
}

// 尝试从 Yahoo Finance 获取数据（增量或全量）
const fetchFromYahoo = async (symbol: string, range = 'max'): Promise<TickerHistoryData[]> => {
  const url = `/api-yahoo/v8/finance/chart/${symbol}?interval=1d&range=${range}&includeAdjustedClose=true`
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000), 
  })
  if (!resp.ok) {
    if (range === 'max') return fetchFromYahoo(symbol, '10y') // 回退到 10 年
    throw new Error(`Yahoo HTTP ${resp.status}`)
  }
  const json: YahooChartResponse = await resp.json()
  return parseYahooResponse(json)
}

const fetchFromYahooProxy = async (symbol: string, range = 'max'): Promise<TickerHistoryData[]> => {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`
  const resp = await fetch(proxyUrl, {
    signal: AbortSignal.timeout(20000), 
  })
  if (!resp.ok) throw new Error(`Yahoo 代理失败: HTTP ${resp.status}`)
  const wrapper: { contents: string } = await resp.json()
  const json: YahooChartResponse = JSON.parse(wrapper.contents)
  return parseYahooResponse(json)
}

// ----------------------------------------------------------------
// 数据源 2：Stooq（免费、无需 API Key，CSV 格式）
// ----------------------------------------------------------------
// ---- 新增数据源：Yahoo Finance v7 CSV 下载 (通过代理) ----
const fetchFromYahooCSVProxy = async (symbol: string, range = 'max'): Promise<TickerHistoryData[]> => {
  const now = Math.floor(Date.now() / 1000)
  const tenYearsAgo = now - 10 * 365 * 24 * 3600
  const p1 = range === 'max' ? 0 : tenYearsAgo
  
  const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/download/${symbol}?period1=${p1}&period2=${now}&interval=1d&events=history&includeAdjustedClose=true`
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`
  
  const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) })
  if (!resp.ok) throw new Error(`Yahoo CSV 代理失败: HTTP ${resp.status}`)
  
  const wrapper: { contents: string } = await resp.json()
  const csv = wrapper.contents
  
  // 解析 CSV (Date,Open,High,Low,Close,Adj Close,Volume)
  const lines = csv.trim().split('\n')
  if (lines.length < 2) throw new Error('Yahoo CSV 行数不足')
  
  const headers = lines[0].toLowerCase().split(',')
  const dateIdx = headers.indexOf('date')
  const closeIdx = headers.indexOf('adj close') !== -1 ? headers.indexOf('adj close') : headers.indexOf('close')
  const lowIdx = headers.indexOf('low')

  const result: TickerHistoryData[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 4) continue
    const date = cols[dateIdx]
    const close = parseFloat(cols[closeIdx])
    const low = lowIdx !== -1 ? parseFloat(cols[lowIdx]) : close
    if (!date || isNaN(close)) continue
    result.push({
      date,
      low: parseFloat((isNaN(low) ? close : low).toFixed(4)),
      close: parseFloat(close.toFixed(4))
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

// ---- 新增数据源：新浪财经 (Sina) US 股日线 (JSONP 方式) ----
const fetchFromSina = async (symbol: string): Promise<TickerHistoryData[]> => {
  const sinaSym = symbol.toLowerCase().replace('.us', '')
  // 新浪 JSONP 回调名必须是全局唯一的，且符合 IO.XSRV2.CallbackList 格式
  const cbName = `jsonp_${Date.now()}`
  const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20${cbName}=/US_MinKService.getDailyK?symbol=${sinaSym}`
  
  // 由于新浪接口返回的 JSONP 格式比较特殊，我们需要手动处理回调
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Sina JSONP 超时')) }, 15000)
    
    ;(window as any)[cbName] = (data: any) => {
      clearTimeout(timeout)
      script.remove()
      if (!Array.isArray(data)) {
        reject(new Error('Sina 返回数据格式错误'))
        return
      }
      const result = data.map((item: any) => ({
        date: item.d,
        low: parseFloat(item.l),
        close: parseFloat(item.c)
      })).sort((a: any, b: any) => a.date.localeCompare(b.date))
      resolve(result)
    }
    
    script.src = url
    script.onerror = () => { script.remove(); reject(new Error('Sina 脚本加载失败')) }
    document.body.appendChild(script)
  })
}

// Stooq 每日 CSV URL 格式 (i=d)
const buildStooqUrl = (symbol: string): string => {
  const stooqSym = symbol.includes('.') ? symbol : `${symbol}.US`
  return `https://stooq.com/q/d/l/?s=${stooqSym}&i=d`
}

// 解析 Stooq 返回的 CSV 字符串
// CSV 格式：Date,Open,High,Low,Close,Volume
// 日期格式：YYYY-MM-DD（每月最后一个交易日）
const parseStooqCsv = (csv: string): TickerHistoryData[] => {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) throw new Error('Stooq CSV 数据行数不足')

  const header = lines[0].toLowerCase()
  if (!header.includes('date') || !header.includes('close')) {
    throw new Error('Stooq CSV 格式不符合预期')
  }

  // 检测是否为错误响应
  if (csv.includes('No data') || csv.includes('404') || lines.length < 3) {
    throw new Error('Stooq 未找到该标的数据，请检查股票代码')
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const dateIdx = headers.indexOf('date')
  const closeIdx = headers.indexOf('close')
  const lowIdx = headers.indexOf('low')

  const result: TickerHistoryData[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < Math.max(dateIdx, closeIdx, lowIdx) + 1) continue

    const date = cols[dateIdx]?.trim()
    const closeStr = cols[closeIdx]?.trim()
    const lowStr = lowIdx !== -1 ? cols[lowIdx]?.trim() : closeStr

    if (!date || !closeStr) continue

    const close = parseFloat(closeStr)
    const low = lowStr ? parseFloat(lowStr) : close

    if (isNaN(close) || close <= 0) continue

    result.push({
      date,
      low: parseFloat((isNaN(low) || low <= 0 ? close : low).toFixed(4)),
      close: parseFloat(close.toFixed(4)),
    })
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}

// 尝试通过 allorigins 代理访问 Stooq（Stooq 不支持跨域直连）
const fetchFromStooqProxy = async (symbol: string): Promise<TickerHistoryData[]> => {
  const stooqUrl = buildStooqUrl(symbol)
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(stooqUrl)}`
  const resp = await fetch(proxyUrl, {
    signal: AbortSignal.timeout(20000),
  })
  if (!resp.ok) throw new Error(`Stooq 代理失败: HTTP ${resp.status}`)
  const wrapper: { contents: string } = await resp.json()
  const data = parseStooqCsv(wrapper.contents)
  return data
}

// 尝试从 Stooq 获取数据（通过本地代理）
const fetchFromStooqDirect = async (symbol: string): Promise<TickerHistoryData[]> => {
  // 增加 .US 兼容性逻辑
  const stooqSym = symbol.includes('.') ? symbol : `${symbol}.US`
  const url = `/api-stooq/q/d/l/?s=${stooqSym}&i=d`
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000),
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
export const fetchTickerHistoryData = async (
  symbol: string,
  useCache = true,
): Promise<TickerHistoryData[]> => {
  const upperSymbol = symbol.toUpperCase().trim()
  if (!upperSymbol) throw new Error('股票代码不能为空')

  let cachedData: TickerHistoryData[] = []
  if (useCache) {
    const cached = readCache(upperSymbol)
    if (cached && cached.length > 0) {
      cachedData = cached
      // 如果缓存数据点多于 1000 且距离现在不足 12 小时，视为足够新鲜
      const latestDate = new Date(cached[cached.length - 1].date)
      const hoursSinceUpdate = (Date.now() - latestDate.getTime()) / (1000 * 3600)
      if (hoursSinceUpdate < 12 && cached.length > 500) {
        return cached
      }
    }
  }

  // 记录每个数据源的错误信息
  const errors: string[] = []

  // 合并函数：增量更新逻辑
  const mergeData = (newData: TickerHistoryData[]) => {
    if (cachedData.length === 0) return newData
    const existingDates = new Set(cachedData.map(d => d.date))
    const merged = [...cachedData]
    newData.forEach(item => {
      if (!existingDates.has(item.date)) {
        merged.push(item)
      }
    })
    return merged.sort((a, b) => a.date.localeCompare(b.date))
  }

  // ---- 尝试各数据源 ----
  // 1. Yahoo 直连
  try {
    const data = await fetchFromYahoo(upperSymbol, cachedData.length > 500 ? '1y' : 'max')
    const final = mergeData(data)
    writeCache(upperSymbol, final)
    return final
  } catch (e) { errors.push(`Yahoo直连: ${(e as Error).message}`) }

  // 2. Yahoo 代理
  try {
    const data = await fetchFromYahooProxy(upperSymbol, cachedData.length > 500 ? '1y' : 'max')
    const final = mergeData(data)
    writeCache(upperSymbol, final)
    return final
  } catch (e) { errors.push(`Yahoo代理: ${(e as Error).message}`) }

  // 3. Yahoo CSV 代理 (NEW)
  try {
    const data = await fetchFromYahooCSVProxy(upperSymbol, cachedData.length > 500 ? '1y' : 'max')
    const final = mergeData(data)
    writeCache(upperSymbol, final)
    return final
  } catch (e) { errors.push(`Yahoo CSV代理: ${(e as Error).message}`) }

  // 4. 新浪财经 (NEW - 适合国内环境)
  try {
    const data = await fetchFromSina(upperSymbol)
    const final = mergeData(data)
    writeCache(upperSymbol, final)
    return final
  } catch (e) { errors.push(`Sina财经: ${(e as Error).message}`) }

  // 5. Stooq 直连

  // 5. Stooq 代理
  try {
    const data = await fetchFromStooqProxy(upperSymbol)
    const final = mergeData(data)
    writeCache(upperSymbol, final)
    return final
  } catch (e) { errors.push(`Stooq代理: ${(e as Error).message}`) }

  // 所有数据源均失败，抛出汇总错误
  throw new Error(
    `无法获取 ${upperSymbol} 的历史数据（已尝试 4 个数据源）:\n${errors.join('\n')}`,
  )
}

/**
 * 强制刷新：清除缓存并重新抓取
 * @param symbol - 股票代码
 */
export const refetchTickerHistoryData = async (symbol: string): Promise<TickerHistoryData[]> => {
  const upperSymbol = symbol.toUpperCase().trim()
  clearTickerCache(upperSymbol)
  return fetchTickerHistoryData(upperSymbol, false)
}

/**
 * 清除指定标的的本地缓存
 * @param symbol - 股票代码
 */
export const clearTickerCache = (symbol: string): void => {
  localStorage.removeItem(`${CACHE_KEY_PREFIX}${symbol.toUpperCase()}`)
}

/**
 * 获取所有已缓存的标的列表（及其缓存时间）
 */
export interface CacheInfo {
  symbol: string
  cachedAt: Date
  dataPoints: number
  latestMonth: string
  isExpired: boolean
}

export const getAllCachedSymbols = (): CacheInfo[] => {
  const result: CacheInfo[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(CACHE_KEY_PREFIX)) continue
    const symbol = key.replace(CACHE_KEY_PREFIX, '')
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const entry: CacheEntry = JSON.parse(raw)
      const isExpired = Date.now() - entry.timestamp > CACHE_TTL_MS
      const latestMonth = entry.data.length > 0
        ? entry.data[entry.data.length - 1].date
        : '—'
      result.push({
        symbol,
        cachedAt: new Date(entry.timestamp),
        dataPoints: entry.data.length,
        latestMonth,
        isExpired,
      })
    } catch {
      // 忽略解析失败
    }
  }
  return result.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/**
 * 批量刷新多个标的的历史数据（带并发控制）
 */
export const batchRefetchSymbols = async (
  symbols: string[],
  onProgress?: (symbol: string, status: 'loading' | 'ok' | 'error', error?: string) => void,
): Promise<void> => {
  const toFetch = symbols.length > 0
    ? symbols
    : getAllCachedSymbols().map(c => c.symbol)

  // 并发限制：最大 3 个标的同时下载
  const CONCURRENCY = 3
  const queue = [...toFetch]
  
  const worker = async () => {
    while (queue.length > 0) {
      const symbol = queue.shift()
      if (!symbol) break
      
      onProgress?.(symbol, 'loading')
      try {
        await refetchTickerHistoryData(symbol)
        onProgress?.(symbol, 'ok')
      } catch (err) {
        onProgress?.(symbol, 'error', (err as Error).message)
      }
      // 并发下载时增加随机微小延迟，防止接口屏蔽
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 500))
    }
  }

  // 启动并行任务
  await Promise.all(Array.from({ length: CONCURRENCY }).map(() => worker()))
}

