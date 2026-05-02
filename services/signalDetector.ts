/**
 * 信号检测服务（PRD A5）
 * 定时扫描均线金叉、回撤买点等买入信号，触发推送告警
 */

import { MarketDataRow } from '../types'
import { calculateSMA, detectGoldenCross, detectMACrossover } from './maUtils'
import {
  AlertChannel,
  AlertMessage,
  sendAlert,
  saveAlertHistory,
} from './alertService'

// ----------------------------------------------------------------
// 信号定义
// ----------------------------------------------------------------

export interface SignalDefinition {
  id: string
  name: string
  priority: 'high' | 'medium' | 'low'
  cooldownMonths: number // 同档位至少 N 个月不重复触发
}

export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    id: 'GOLDEN_CROSS_20_50',
    name: '均线金叉-20/50',
    priority: 'high',
    cooldownMonths: 1,
  },
  {
    id: 'GOLDEN_CROSS_50_200',
    name: '均线金叉-50/200（黄金交叉）',
    priority: 'high',
    cooldownMonths: 3,
  },
  {
    id: 'MA200_CROSSOVER',
    name: '回撤买点（价格从下方穿越200M均线）',
    priority: 'medium',
    cooldownMonths: 1,
  },
  {
    id: 'CUSTOM_DRAWDOWN',
    name: '自定义回撤阈值',
    priority: 'medium',
    cooldownMonths: 1,
  },
]

// ----------------------------------------------------------------
// Cooldown 管理（localStorage）
// ----------------------------------------------------------------

const COOLDOWN_KEY = 'clec_signal_cooldown'

interface CooldownRecord {
  [signalId: string]: {
    [ticker: string]: string // ISO 日期字符串，上次触发时间
  }
}

const getCooldownRecord = (): CooldownRecord => {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY)
    return raw ? (JSON.parse(raw) as CooldownRecord) : {}
  } catch {
    return {}
  }
}

const saveCooldownRecord = (record: CooldownRecord): void => {
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(record))
  } catch {
    // ignore
  }
}

/**
 * 检查信号是否在 cooldown 期内（防止重复推送）
 */
const isInCooldown = (signalId: string, ticker: string, cooldownMonths: number): boolean => {
  const record = getCooldownRecord()
  const lastTriggered = record[signalId]?.[ticker]
  if (!lastTriggered) return false

  const lastDate = new Date(lastTriggered)
  const now = new Date()
  const monthsDiff =
    (now.getFullYear() - lastDate.getFullYear()) * 12 + (now.getMonth() - lastDate.getMonth())
  return monthsDiff < cooldownMonths
}

/**
 * 标记信号已触发（更新 cooldown）
 */
const markSignalTriggered = (signalId: string, ticker: string): void => {
  const record = getCooldownRecord()
  if (!record[signalId]) record[signalId] = {}
  record[signalId][ticker] = new Date().toISOString()
  saveCooldownRecord(record)
}

// ----------------------------------------------------------------
// 信号检测核心逻辑
// ----------------------------------------------------------------

interface DetectedSignal {
  signalId: string
  ticker: string
  signalName: string
  currentPrice: number
  priority: 'high' | 'medium' | 'low'
}

/**
 * 对给定市场数据执行所有信号检测
 * @param data - 市场数据（按时间升序）
 * @param ticker - 标的代码（用于 cooldown key）
 * @param prices - 该标的的历史收盘价数组（与 data 对应）
 * @param drawdownThreshold - 自定义回撤阈值（如 -0.10 表示 -10%）
 * @returns 检测到的信号列表（已排除 cooldown）
 */
export const detectSignals = (
  data: MarketDataRow[],
  ticker: string,
  prices: number[],
  drawdownThreshold: number = -0.10,
): DetectedSignal[] => {
  if (prices.length < 3) return []

  const detected: DetectedSignal[] = []
  const idx = prices.length - 1
  const currentPrice = prices[idx]

  // 计算均线
  const sma20 = calculateSMA(prices, 20)
  const sma50 = calculateSMA(prices, 50)
  const sma200 = calculateSMA(prices, 200)

  // 信号 1：20/50 金叉
  if (detectGoldenCross(sma20, sma50, idx)) {
    const def = SIGNAL_DEFINITIONS.find((s) => s.id === 'GOLDEN_CROSS_20_50')!
    if (!isInCooldown(def.id, ticker, def.cooldownMonths)) {
      detected.push({
        signalId: def.id,
        ticker,
        signalName: def.name,
        currentPrice,
        priority: def.priority,
      })
    }
  }

  // 信号 2：50/200 金叉（黄金交叉）
  if (detectGoldenCross(sma50, sma200, idx)) {
    const def = SIGNAL_DEFINITIONS.find((s) => s.id === 'GOLDEN_CROSS_50_200')!
    if (!isInCooldown(def.id, ticker, def.cooldownMonths)) {
      detected.push({
        signalId: def.id,
        ticker,
        signalName: def.name,
        currentPrice,
        priority: def.priority,
      })
    }
  }

  // 信号 3：价格从200M均线下方回升（回撤买点）
  if (detectMACrossover(prices, sma200, idx)) {
    const def = SIGNAL_DEFINITIONS.find((s) => s.id === 'MA200_CROSSOVER')!
    if (!isInCooldown(def.id, ticker, def.cooldownMonths)) {
      detected.push({
        signalId: def.id,
        ticker,
        signalName: def.name,
        currentPrice,
        priority: def.priority,
      })
    }
  }

  // 信号 4：自定义回撤阈值（从最近高点回撤达指定比例）
  if (prices.length >= 2) {
    const recentHigh = Math.max(...prices.slice(-12)) // 近12个月高点
    const drawdown = (currentPrice - recentHigh) / recentHigh
    if (drawdown <= drawdownThreshold) {
      const def = SIGNAL_DEFINITIONS.find((s) => s.id === 'CUSTOM_DRAWDOWN')!
      if (!isInCooldown(def.id, ticker, def.cooldownMonths)) {
        detected.push({
          signalId: def.id,
          ticker,
          signalName: `${def.name}（${(drawdownThreshold * 100).toFixed(0)}%）`,
          currentPrice,
          priority: def.priority,
        })
      }
    }
  }

  // 标记本次检测到的信号已触发（避免重复）
  for (const sig of detected) {
    markSignalTriggered(sig.signalId, sig.ticker)
  }

  // 保留 data 参数以备将来使用（防止 linter 报错）
  void data

  return detected
}

// ----------------------------------------------------------------
// 自动推送信号
// ----------------------------------------------------------------

/**
 * 检测到信号后，通过已配置渠道发送告警
 */
export const runSignalDetectionAndAlert = async (
  data: MarketDataRow[],
  ticker: string,
  prices: number[],
  channels: AlertChannel[],
  drawdownThreshold: number = -0.10,
): Promise<void> => {
  const signals = detectSignals(data, ticker, prices, drawdownThreshold)

  for (const signal of signals) {
    const message: AlertMessage = {
      title: `${ticker} 买入信号`,
      signal: signal.signalName,
      ticker: signal.ticker,
      price: signal.currentPrice,
      content: `检测到 ${signal.signalName} 信号，优先级：${signal.priority}`,
      timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    }

    const results = await sendAlert(channels, message)
    const anySuccess = results.some((r) => r.success)

    saveAlertHistory({
      timestamp: new Date().toISOString(),
      title: message.title,
      content: message.content,
      channels: results.map((r) => r.channel),
      success: anySuccess,
    })
  }
}

// ----------------------------------------------------------------
// 定时器管理
// ----------------------------------------------------------------

let signalDetectorTimer: ReturnType<typeof setInterval> | null = null

/**
 * 启动定时信号检测
 * @param getData - 获取最新市场数据的回调
 * @param channels - 推送渠道
 * @param intervalMs - 检测间隔（默认1小时）
 */
export const startSignalDetector = (
  getData: () => { data: MarketDataRow[]; ticker: string; prices: number[] } | null,
  channels: AlertChannel[],
  intervalMs: number = 60 * 60 * 1000,
): void => {
  stopSignalDetector() // 先停止旧的
  signalDetectorTimer = setInterval(async () => {
    const ctx = getData()
    if (!ctx) return
    await runSignalDetectionAndAlert(ctx.data, ctx.ticker, ctx.prices, channels)
  }, intervalMs)
}

/**
 * 停止定时信号检测
 */
export const stopSignalDetector = (): void => {
  if (signalDetectorTimer !== null) {
    clearInterval(signalDetectorTimer)
    signalDetectorTimer = null
  }
}
