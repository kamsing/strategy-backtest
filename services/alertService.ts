/**
 * 推送服务（PRD A5）
 * 封装微信企业机器人、钉钉、Telegram、邮件等推送渠道
 */

// ----------------------------------------------------------------
// 类型定义
// ----------------------------------------------------------------

export interface AlertChannel {
  type: 'wechat' | 'dingtalk' | 'telegram' | 'email'
  enabled: boolean
  config: WechatConfig | DingtalkConfig | TelegramConfig | EmailConfig
}

export interface WechatConfig {
  webhookUrl: string // 企业微信机器人 Webhook URL
}

export interface DingtalkConfig {
  webhookUrl: string // 钉钉机器人 Webhook URL
  secret?: string // 钉钉签名密钥（可选）
}

export interface TelegramConfig {
  botToken: string // Telegram Bot Token
  chatId: string // Telegram Chat ID
  proxyUrl?: string // 代理服务 URL（解决 CORS 限制）
}

export interface EmailConfig {
  smtpHost: string
  smtpPort: number
  username: string
  password: string
  toAddress: string
  proxyUrl: string // 邮件代理服务 URL（必须，浏览器无法直接发 SMTP）
}

export interface AlertMessage {
  title: string
  content: string
  ticker?: string
  price?: number
  signal?: string
  timestamp?: string
}

export interface AlertResult {
  channel: string
  success: boolean
  error?: string
}

// ----------------------------------------------------------------
// 工具函数
// ----------------------------------------------------------------

/**
 * 生成推送消息文本（PRD 格式模板）
 */
export const formatAlertMessage = (msg: AlertMessage): string => {
  const time = msg.timestamp || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  return [
    `【CLEC 信号】${msg.title}`,
    msg.signal ? `信号：${msg.signal}` : '',
    msg.ticker ? `标的：${msg.ticker}` : '',
    msg.price !== undefined ? `当前价：$${msg.price.toFixed(2)}` : '',
    `时间：${time}`,
    `---`,
    msg.content,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 钉钉签名计算（HMAC-SHA256）
 */
const calcDingtalkSign = async (secret: string): Promise<{ timestamp: number; sign: string }> => {
  const timestamp = Date.now()
  const stringToSign = `${timestamp}\n${secret}`
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const msgData = encoder.encode(stringToSign)
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, msgData)
  const base64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  const sign = encodeURIComponent(base64)
  return { timestamp, sign }
}

// ----------------------------------------------------------------
// 各渠道推送实现
// ----------------------------------------------------------------

/**
 * 微信企业机器人推送
 */
const sendWechat = async (config: WechatConfig, msg: AlertMessage): Promise<AlertResult> => {
  const text = formatAlertMessage(msg)
  try {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    })
    const data = await resp.json()
    if (data.errcode === 0) return { channel: 'wechat', success: true }
    return { channel: 'wechat', success: false, error: data.errmsg }
  } catch (e) {
    return { channel: 'wechat', success: false, error: String(e) }
  }
}

/**
 * 钉钉机器人推送（支持签名）
 */
const sendDingtalk = async (config: DingtalkConfig, msg: AlertMessage): Promise<AlertResult> => {
  const text = formatAlertMessage(msg)
  try {
    let url = config.webhookUrl
    if (config.secret) {
      const { timestamp, sign } = await calcDingtalkSign(config.secret)
      url += `&timestamp=${timestamp}&sign=${sign}`
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { title: msg.title, text: text.replace(/\n/g, '\n\n') },
      }),
    })
    const data = await resp.json()
    if (data.errcode === 0) return { channel: 'dingtalk', success: true }
    return { channel: 'dingtalk', success: false, error: data.errmsg }
  } catch (e) {
    return { channel: 'dingtalk', success: false, error: String(e) }
  }
}

/**
 * Telegram Bot 推送（需代理解决 CORS，或直接访问）
 */
const sendTelegram = async (config: TelegramConfig, msg: AlertMessage): Promise<AlertResult> => {
  const text = formatAlertMessage(msg)
  try {
    // 通过代理或直接调用 Telegram API
    const apiBase = config.proxyUrl
      ? `${config.proxyUrl.replace(/\/$/, '')}/bot${config.botToken}`
      : `https://api.telegram.org/bot${config.botToken}`

    const resp = await fetch(`${apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: 'HTML' }),
    })
    const data = await resp.json()
    if (data.ok) return { channel: 'telegram', success: true }
    return { channel: 'telegram', success: false, error: data.description }
  } catch (e) {
    return { channel: 'telegram', success: false, error: String(e) }
  }
}

/**
 * 邮件推送（需代理后端）
 */
const sendEmail = async (config: EmailConfig, msg: AlertMessage): Promise<AlertResult> => {
  const text = formatAlertMessage(msg)
  try {
    const resp = await fetch(`${config.proxyUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtp: {
          host: config.smtpHost,
          port: config.smtpPort,
          user: config.username,
          pass: config.password,
        },
        to: config.toAddress,
        subject: `[CLEC] ${msg.title}`,
        body: text,
      }),
    })
    const data = await resp.json()
    if (data.success) return { channel: 'email', success: true }
    return { channel: 'email', success: false, error: data.error }
  } catch (e) {
    return { channel: 'email', success: false, error: String(e) }
  }
}

// ----------------------------------------------------------------
// 主入口
// ----------------------------------------------------------------

/**
 * 向所有已启用渠道发送告警
 * @param channels - 推送渠道配置列表
 * @param message - 告警消息
 * @returns 各渠道推送结果
 */
export const sendAlert = async (
  channels: AlertChannel[],
  message: AlertMessage,
): Promise<AlertResult[]> => {
  const results: AlertResult[] = []

  for (const channel of channels) {
    if (!channel.enabled) continue

    let result: AlertResult

    switch (channel.type) {
      case 'wechat':
        result = await sendWechat(channel.config as WechatConfig, message)
        break
      case 'dingtalk':
        result = await sendDingtalk(channel.config as DingtalkConfig, message)
        break
      case 'telegram':
        result = await sendTelegram(channel.config as TelegramConfig, message)
        break
      case 'email':
        result = await sendEmail(channel.config as EmailConfig, message)
        break
      default:
        result = { channel: channel.type, success: false, error: 'Unknown channel type' }
    }

    results.push(result)
  }

  return results
}

// ----------------------------------------------------------------
// 推送历史管理（localStorage，最多 50 条）
// ----------------------------------------------------------------

const ALERT_HISTORY_KEY = 'clec_alert_history'
const MAX_HISTORY = 50

export interface AlertHistoryItem {
  id: string
  timestamp: string
  title: string
  content: string
  channels: string[]
  success: boolean
}

/**
 * 保存推送记录到 localStorage
 */
export const saveAlertHistory = (item: Omit<AlertHistoryItem, 'id'>): void => {
  try {
    const existing = getAlertHistory()
    const newItem: AlertHistoryItem = {
      ...item,
      id: Math.random().toString(36).slice(2),
    }
    const updated = [newItem, ...existing].slice(0, MAX_HISTORY)
    localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(updated))
  } catch {
    // localStorage 可能不可用（无痕模式等）
  }
}

/**
 * 获取推送历史记录
 */
export const getAlertHistory = (): AlertHistoryItem[] => {
  try {
    const raw = localStorage.getItem(ALERT_HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AlertHistoryItem[]
  } catch {
    return []
  }
}

/**
 * 清空推送历史记录
 */
export const clearAlertHistory = (): void => {
  localStorage.removeItem(ALERT_HISTORY_KEY)
}
