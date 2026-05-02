import React, { useState, useEffect } from 'react'
import { Clock, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import { AlertHistoryItem, getAlertHistory, clearAlertHistory } from '../services/alertService'

/**
 * 推送历史面板（PRD A5）
 * 展示最近 50 条信号推送记录
 */
export const AlertHistory: React.FC = () => {
  const [history, setHistory] = useState<AlertHistoryItem[]>([])

  const refresh = () => {
    setHistory(getAlertHistory())
  }

  useEffect(() => {
    refresh()
    // 每分钟刷新一次
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
  }, [])

  const handleClear = () => {
    if (window.confirm('确定要清空所有推送历史吗？')) {
      clearAlertHistory()
      setHistory([])
    }
  }

  const formatTime = (isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return isoStr
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-700">推送历史</h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
            最近 {history.length} 条
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {history.length > 0 && (
            <button
              onClick={handleClear}
              className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 transition-colors"
              title="清空历史"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-sm">
          暂无推送记录
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {history.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs ${
                item.success
                  ? 'bg-green-50/50 border-green-100'
                  : 'bg-red-50/50 border-red-100'
              }`}
            >
              {item.success ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700 truncate">{item.title}</span>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                    {formatTime(item.timestamp)}
                  </span>
                </div>
                <p className="text-slate-500 mt-0.5 truncate">{item.content}</p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {item.channels.map((ch) => (
                    <span
                      key={ch}
                      className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[9px]"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AlertHistory
