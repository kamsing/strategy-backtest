import React, { useState, useEffect } from 'react'
import { Bell, Save, TestTube, CheckCircle, XCircle } from 'lucide-react'
import {
  AlertChannel,
  WechatConfig,
  DingtalkConfig,
  TelegramConfig,
  sendAlert,
} from '../services/alertService'
import { useTranslation } from '../services/i18n'

// ----------------------------------------------------------------
// 持久化推送配置到 localStorage
// ----------------------------------------------------------------
const ALERT_CONFIG_KEY = 'clec_alert_config'

const loadAlertConfig = (): AlertChannel[] => {
  try {
    const raw = localStorage.getItem(ALERT_CONFIG_KEY)
    return raw ? (JSON.parse(raw) as AlertChannel[]) : getDefaultChannels()
  } catch {
    return getDefaultChannels()
  }
}

const saveAlertConfig = (channels: AlertChannel[]): void => {
  try {
    localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(channels))
  } catch {
    // ignore
  }
}

const getDefaultChannels = (): AlertChannel[] => [
  {
    type: 'wechat',
    enabled: false,
    config: { webhookUrl: '' } as WechatConfig,
  },
  {
    type: 'dingtalk',
    enabled: false,
    config: { webhookUrl: '', secret: '' } as DingtalkConfig,
  },
  {
    type: 'telegram',
    enabled: false,
    config: { botToken: '', chatId: '', proxyUrl: '' } as TelegramConfig,
  },
]

// ----------------------------------------------------------------
// 推送配置面板
// ----------------------------------------------------------------

interface AlertSettingsProps {
  onChannelsChange?: (channels: AlertChannel[]) => void
}

export const AlertSettings: React.FC<AlertSettingsProps> = ({ onChannelsChange }) => {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<AlertChannel[]>(loadAlertConfig)
  const [testResults, setTestResults] = useState<Record<string, 'success' | 'fail' | 'testing'>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    onChannelsChange?.(channels)
  }, [channels, onChannelsChange])

  const updateChannel = (index: number, updates: Partial<AlertChannel>) => {
    const newChannels = channels.map((ch, i) => (i === index ? { ...ch, ...updates } : ch))
    setChannels(newChannels)
    setSaved(false)
  }

  const updateConfig = (index: number, key: string, value: string) => {
    const newChannels = channels.map((ch, i) =>
      i === index
        ? { ...ch, config: { ...ch.config, [key]: value } }
        : ch,
    )
    setChannels(newChannels)
    setSaved(false)
  }

  const handleSave = () => {
    saveAlertConfig(channels)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async (index: number) => {
    const ch = channels[index]
    setTestResults((prev) => ({ ...prev, [ch.type]: 'testing' }))
    const results = await sendAlert(
      [{ ...ch, enabled: true }],
      {
        title: 'CLEC 推送测试',
        content: '这是一条测试消息，推送配置工作正常！',
        timestamp: new Date().toLocaleString('zh-CN'),
      },
    )
    const success = results[0]?.success ?? false
    setTestResults((prev) => ({ ...prev, [ch.type]: success ? 'success' : 'fail' }))
    setTimeout(() => setTestResults((prev) => { const n = { ...prev }; delete n[ch.type]; return n }), 5000)
  }

  const channelLabels: Record<string, string> = {
    wechat: '微信企业机器人',
    dingtalk: '钉钉机器人',
    telegram: 'Telegram Bot',
    email: '邮件 (SMTP)',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-700">推送渠道配置</h3>
        </div>
        <button
          onClick={handleSave}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            saved
              ? 'bg-green-100 text-green-700'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {saved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? '已保存' : t('save') || '保存'}
        </button>
      </div>

      {channels.map((ch, index) => (
        <div
          key={ch.type}
          className={`border rounded-xl overflow-hidden transition-all ${
            ch.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'
          }`}
        >
          {/* 渠道标题行 */}
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <button
                id={`alert-toggle-${ch.type}`}
                onClick={() => updateChannel(index, { enabled: !ch.enabled })}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  ch.enabled ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    ch.enabled ? 'left-4' : 'left-0.5'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-slate-700">{channelLabels[ch.type]}</span>
            </div>
            {ch.enabled && (
              <div className="flex items-center gap-1">
                {testResults[ch.type] === 'testing' && (
                  <span className="text-[10px] text-blue-500 animate-pulse">测试中...</span>
                )}
                {testResults[ch.type] === 'success' && (
                  <span className="text-[10px] text-green-600 flex items-center gap-0.5">
                    <CheckCircle className="w-3 h-3" /> 成功
                  </span>
                )}
                {testResults[ch.type] === 'fail' && (
                  <span className="text-[10px] text-red-500 flex items-center gap-0.5">
                    <XCircle className="w-3 h-3" /> 失败
                  </span>
                )}
                <button
                  onClick={() => handleTest(index)}
                  disabled={testResults[ch.type] === 'testing'}
                  className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] rounded-md transition-colors"
                >
                  <TestTube className="w-3 h-3" /> 测试
                </button>
              </div>
            )}
          </div>

          {/* 渠道配置表单 */}
          {ch.enabled && (
            <div className="px-3 pb-3 space-y-2 border-t border-slate-100">
              {ch.type === 'wechat' && (
                <div>
                  <label className="text-[10px] text-slate-500 uppercase font-bold">
                    企业微信 Webhook URL
                  </label>
                  <input
                    type="text"
                    value={(ch.config as WechatConfig).webhookUrl}
                    onChange={(e) => updateConfig(index, 'webhookUrl', e.target.value)}
                    placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                    className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                  />
                </div>
              )}

              {ch.type === 'dingtalk' && (
                <>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold">
                      钉钉 Webhook URL
                    </label>
                    <input
                      type="text"
                      value={(ch.config as DingtalkConfig).webhookUrl}
                      onChange={(e) => updateConfig(index, 'webhookUrl', e.target.value)}
                      placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                      className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold">
                      签名密钥（可选）
                    </label>
                    <input
                      type="password"
                      value={(ch.config as DingtalkConfig).secret || ''}
                      onChange={(e) => updateConfig(index, 'secret', e.target.value)}
                      placeholder="SEC..."
                      className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    />
                  </div>
                </>
              )}

              {ch.type === 'telegram' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-bold">Bot Token</label>
                      <input
                        type="password"
                        value={(ch.config as TelegramConfig).botToken}
                        onChange={(e) => updateConfig(index, 'botToken', e.target.value)}
                        placeholder="123456:ABC..."
                        className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-bold">Chat ID</label>
                      <input
                        type="text"
                        value={(ch.config as TelegramConfig).chatId}
                        onChange={(e) => updateConfig(index, 'chatId', e.target.value)}
                        placeholder="-100123456789"
                        className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-bold">
                      代理 URL（解决 CORS，可留空直连）
                    </label>
                    <input
                      type="text"
                      value={(ch.config as TelegramConfig).proxyUrl || ''}
                      onChange={(e) => updateConfig(index, 'proxyUrl', e.target.value)}
                      placeholder="https://your-proxy.vercel.app"
                      className="w-full mt-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[10px] text-amber-700">
        ⚠️ Telegram 和邮件因浏览器 CORS 限制，需配置代理。推荐使用 Vercel Edge Function 或 Docker 代理。
      </div>
    </div>
  )
}

export default AlertSettings
