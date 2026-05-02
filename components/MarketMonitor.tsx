import React, { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, Maximize2, X, Bell, History, Monitor } from 'lucide-react'
import { useTranslation } from '../services/i18n'
import { AlertSettings } from './AlertSettings'
import { AlertHistory } from './AlertHistory'
import { PriceComparisonChart } from './PriceComparisonChart'
import { MARKET_DATA } from '../constants'

export const MarketMonitor: React.FC = () => {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(true)
  const [showWarning, setShowWarning] = useState(true)
  const [key, setKey] = useState(0) // Used to force iframe reload
  const [activeTab, setActiveTab] = useState<'monitor' | 'alerts' | 'history'>('monitor')

  const MONITOR_URL = 'https://qqq-buyer-monitor.vercel.app/'

  // Load warning visibility from localStorage
  useEffect(() => {
    const hidden = localStorage.getItem('hide_monitor_warning') === 'true'
    if (hidden) {
      setShowWarning(false)
    }
  }, [])

  const handleDismissWarning = () => {
    setShowWarning(false)
    localStorage.setItem('hide_monitor_warning', 'true')
  }

  const handleRefresh = () => {
    setIsLoading(true)
    setKey((prev) => prev + 1)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-6rem)] w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header / Tabs */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 mr-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="font-bold text-slate-700 hidden sm:block">
              {t('liveMonitorTitle') || 'Market Signal Center'}
            </h3>
          </div>
          
          <nav className="flex bg-slate-200/50 p-1 rounded-xl gap-1">
            <button
              onClick={() => setActiveTab('monitor')}
              className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'monitor' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              {t('monitor') || '监控'}
            </button>
            <button
              onClick={() => setActiveTab('alerts')}
              className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'alerts' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              {t('alerts') || '推送'}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'history' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              {t('history') || '历史'}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'monitor' && (
            <>
              <button
                onClick={handleRefresh}
                className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <a
                href={MONITOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 transition-colors"
                title="Open in new tab"
              >
                <Maximize2 className="w-4 h-4" />
              </a>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* Experimental Disclaimer (only shown on monitor tab) */}
        {activeTab === 'monitor' && showWarning && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-start gap-3 relative group shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-amber-900 text-[11px] leading-relaxed pr-8">
              <span className="font-bold underline decoration-amber-300">【声明】</span>
              本信号仅供个人研究参考，不构成任何投资建议。
            </div>
            <button
              onClick={handleDismissWarning}
              className="absolute top-1.5 right-2 p-1 rounded-full hover:bg-amber-100 text-amber-400 transition-all opacity-0 group-hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-50/30">
          {activeTab === 'monitor' && (
            <div className="h-full flex flex-col gap-6">
              {/* Iframe Monitor */}
              <div className="relative flex-1 min-h-[400px] w-full bg-[#0a0a0a] rounded-xl overflow-hidden border border-slate-200 shadow-inner">
                {isLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white z-10">
                    <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
                    <p className="text-sm font-medium animate-pulse">Connecting to Live Signals...</p>
                  </div>
                )}
                <iframe
                  key={key}
                  src={MONITOR_URL}
                  className="w-full h-full border-none"
                  onLoad={() => setIsLoading(false)}
                  title="QQQ Buyer Monitor"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              </div>

              {/* MA Chart Integration */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Monitor className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-700">价格归一化对比与均线</h4>
                </div>
                <PriceComparisonChart 
                  data={MARKET_DATA} 
                  tickers={[
                    { ticker: 'QQQ', color: '#2563eb', prices: MARKET_DATA.map(d => d.qqqClose) },
                    { ticker: 'QLD', color: '#9333ea', prices: MARKET_DATA.map(d => d.qldClose) }
                  ]}
                  showSMA={true}
                />
              </div>
            </div>
          )}

          {activeTab === 'alerts' && (
            <div className="max-w-3xl mx-auto animate-in slide-in-from-bottom-2 duration-300">
              <AlertSettings />
            </div>
          )}

          {activeTab === 'history' && (
            <div className="max-w-3xl mx-auto animate-in slide-in-from-bottom-2 duration-300">
              <AlertHistory />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 flex items-center gap-2">
        <AlertCircle className="w-3 h-3" />
        <span>Signals provided by QQQ-Buyer-Monitor & Internal Signal Detector. For research reference only.</span>
      </div>
    </div>
  )
}

