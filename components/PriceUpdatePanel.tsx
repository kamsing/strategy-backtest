/**
 * 历史股价更新管理面板 (Issue #1)
 * 功能：
 * 1. 展示所有已缓存标的及其状态（最新月份、是否过期）
 * 2. 手动输入标的代码并下载缓存
 * 3. 一键刷新所有已缓存标的
 */

import React, { useState, useCallback, useEffect } from 'react'
import {
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Loader2,
  Trash2,
  Plus,
  Database,
  FileDown,
  Upload,
} from 'lucide-react'
import {
  getAllCachedSymbols,
  batchRefetchSymbols,
  fetchTickerHistoryData,
  clearTickerCache,
  CacheInfo,
} from '../services/marketDataService'

interface FetchStatus {
  status: 'idle' | 'loading' | 'ok' | 'error'
  message?: string
}

export const PriceUpdatePanel: React.FC = () => {
  const [cachedSymbols, setCachedSymbols] = useState<CacheInfo[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  // 每个标的的刷新状态
  const [statusMap, setStatusMap] = useState<Record<string, FetchStatus>>({})
  const [isBatchRefreshing, setIsBatchRefreshing] = useState(false)

  // 刷新缓存列表显示
  const refreshList = useCallback(() => {
    setCachedSymbols(getAllCachedSymbols())
  }, [])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  // 下载/更新单个标的
  const handleFetchSymbol = useCallback(async (symbol: string) => {
    const upper = symbol.toUpperCase().trim()
    if (!upper) return

    setStatusMap(prev => ({ ...prev, [upper]: { status: 'loading' } }))
    try {
      await fetchTickerHistoryData(upper, false)
      setStatusMap(prev => ({ ...prev, [upper]: { status: 'ok' } }))
      refreshList()
    } catch (err) {
      setStatusMap(prev => ({
        ...prev,
        [upper]: { status: 'error', message: (err as Error).message },
      }))
      alert(`获取 ${upper} 失败:\n${(err as Error).message}`)
    }
  }, [refreshList])

  // 添加新标的
  const handleAddSymbol = async (e: React.FormEvent) => {
    e.preventDefault()
    const symbolToFetch = newSymbol.trim()
    if (!symbolToFetch) return
    await handleFetchSymbol(symbolToFetch)
    // 如果没有报错，或者已经加入缓存，则清空
    if (getAllCachedSymbols().find(c => c.symbol === symbolToFetch.toUpperCase())) {
      setNewSymbol('')
    }
  }

  // 批量刷新所有
  const handleBatchRefresh = async () => {
    setIsBatchRefreshing(true)
    await batchRefetchSymbols([], (symbol, status, error) => {
      setStatusMap(prev => ({
        ...prev,
        [symbol]: { status, message: error },
      }))
    })
    setIsBatchRefreshing(false)
    refreshList()
  }

  // 清除缓存
  const handleClearCache = (symbol: string) => {
    clearTickerCache(symbol)
    setStatusMap(prev => {
      const next = { ...prev }
      delete next[symbol]
      return next
    })
    refreshList()
  }
  // 导出所有数据
  const handleExportAll = () => {
    const allData: Record<string, any> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('ticker_daily_cache_v2_')) {
        const val = localStorage.getItem(key)
        if (val) allData[key] = JSON.parse(val)
      }
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest_data_backup_${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 导入数据
  const handleImportAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string)
        Object.entries(data).forEach(([key, val]) => {
          localStorage.setItem(key, JSON.stringify(val))
        })
        alert('恢复成功！')
        refreshList()
      } catch (err) {
        alert('恢复失败：文件格式错误')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold text-slate-800">历史股价缓存管理</h3>
          <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold">
            本地 localStorage
          </span>
        </div>
        <button
          onClick={handleBatchRefresh}
          disabled={isBatchRefreshing || cachedSymbols.length === 0}
          className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
        >
          {isBatchRefreshing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {isBatchRefreshing ? '更新中...' : '全部更新'}
        </button>
      </div>

      {/* 添加新标的表单 */}
      <form onSubmit={handleAddSymbol} className="flex gap-2 mb-4">
        <input
          type="text"
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
          placeholder="输入股票代码，如 TQQQ、SPY、NVDA..."
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder-slate-300"
        />
        <button
          type="submit"
          disabled={!newSymbol.trim() || statusMap[newSymbol.toUpperCase()]?.status === 'loading'}
          className="flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white px-4 py-2 rounded-lg transition-colors font-medium"
        >
          {statusMap[newSymbol.toUpperCase()]?.status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          下载
        </button>
        <button
          type="button"
          onClick={handleExportAll}
          className="flex items-center gap-1.5 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg transition-colors"
          title="导出所有缓存到文件"
        >
          <FileDown className="w-4 h-4" />
          备份
        </button>
        <label className="flex items-center gap-1.5 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg transition-colors cursor-pointer">
          <Upload className="w-4 h-4" />
          恢复
          <input
            type="file"
            className="hidden"
            accept=".json"
            onChange={handleImportAll}
          />
        </label>
      </form>

      {/* 缓存列表 */}
      {cachedSymbols.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>暂无缓存数据</p>
          <p className="text-xs mt-1">输入股票代码并点击"下载"开始缓存</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cachedSymbols.map((info) => {
            const s = statusMap[info.symbol]
            return (
              <div
                key={info.symbol}
                className={`flex items-center gap-3 p-3 rounded-lg border text-sm transition-all ${
                  info.isExpired
                    ? 'bg-amber-50 border-amber-100'
                    : 'bg-slate-50 border-slate-100'
                }`}
              >
                {/* 标的代码 */}
                <span className="font-mono font-bold text-slate-700 w-16 flex-shrink-0">
                  {info.symbol}
                </span>

                {/* 缓存信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>最新：<span className="font-mono text-slate-700">{info.latestMonth}</span></span>
                    <span className="text-slate-300">·</span>
                    <span>{info.dataPoints} 条</span>
                    <span className="text-slate-300">·</span>
                    <span className={info.isExpired ? 'text-amber-600 font-medium' : 'text-slate-400'}>
                      {info.isExpired ? '⚠ 已过期' : `更新：${info.cachedAt.toLocaleDateString()}`}
                    </span>
                  </div>

                  {/* 错误信息 */}
                  {s?.status === 'error' && (
                    <p className="text-xs text-red-500 mt-0.5 truncate" title={s.message}>
                      ❌ {s.message}
                    </p>
                  )}
                </div>

                {/* 状态图标 */}
                <div className="flex-shrink-0">
                  {s?.status === 'loading' && (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  )}
                  {s?.status === 'ok' && (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                  {s?.status === 'error' && (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  )}
                </div>

                {/* 操作按钮 */}
                <button
                  onClick={() => handleFetchSymbol(info.symbol)}
                  disabled={s?.status === 'loading'}
                  className="flex-shrink-0 p-1.5 hover:bg-blue-100 text-blue-600 rounded-md transition-colors"
                  title="更新此标的数据"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleClearCache(info.symbol)}
                  className="flex-shrink-0 p-1.5 hover:bg-red-100 text-red-400 hover:text-red-600 rounded-md transition-colors"
                  title="清除此标的缓存"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3">
        💡 数据缓存在浏览器 localStorage 中，24小时有效。关闭后下次启动时只要在有效期内则无需重新下载。
      </p>
    </div>
  )
}
