import { useState, useEffect, useCallback, useRef } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { ConfigPanel } from './components/ConfigPanel'
import { ResultsDashboard } from './components/ResultsDashboard'
import { MarketMonitor } from './components/MarketMonitor'
import { FinancialReportModal } from './components/FinancialReportModal'
import { PriceUpdatePanel } from './components/PriceUpdatePanel'
import { MARKET_DATA, buildMarketDataWithCustom, getExtendedMarketData } from './constants'
import { runBacktest } from './services/simulationEngine'
import { getStrategyByType } from './services/strategies'
import { fetchTickerHistoryData, refetchTickerHistoryData } from './services/marketDataService'
import { AssetConfig, MarketDataRow, Profile, SimulationResult } from './types'
import {
  LayoutDashboard,
  Settings2,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  LineChart,
  Database,
} from 'lucide-react'
import { LanguageProvider, useTranslation, Language } from './services/i18n'
import { version } from './package.json'

const DEFAULT_CONFIG_A: AssetConfig = {
  initialCapital: 1000000,
  contributionAmount: 5000, // Adjusted relative to 1M capital
  contributionIntervalMonths: 1,
  yearlyContributionMonth: 12, // Default to December
  qqqWeight: 50,
  qldWeight: 40,
  // Conservative DCA: Just buy QQQ
  contributionQqqWeight: 100,
  contributionQldWeight: 0,
  cashYieldAnnual: 2.0,
  leverage: {
    enabled: false,
    interestRate: 5.0,
    qqqPledgeRatio: 0.7,
    qldPledgeRatio: 0.0,
    cashPledgeRatio: 0.95,
    maxLtv: 100, // Default 100% of PLEDGED value (Broker Limit)
    withdrawType: 'PERCENT',
    withdrawValue: 2.0,
    inflationRate: 0.0,
    interestType: 'CAPITALIZED',
    ltvBasis: 'TOTAL_ASSETS',
  },
  annualExpenseAmount: 30000,
  cashCoverageYears: 15,
}

const DEFAULT_CONFIG_B: AssetConfig = {
  initialCapital: 1000000,
  contributionAmount: 5000,
  contributionIntervalMonths: 1,
  yearlyContributionMonth: 12, // Default to December
  qqqWeight: 10,
  qldWeight: 80,
  // Aggressive DCA: Match the portfolio weights
  contributionQqqWeight: 10,
  contributionQldWeight: 80,
  cashYieldAnnual: 2.0,
  leverage: {
    enabled: false,
    interestRate: 5.0,
    qqqPledgeRatio: 0.7,
    qldPledgeRatio: 0.0,
    cashPledgeRatio: 0.95,
    maxLtv: 100,
    withdrawType: 'PERCENT',
    withdrawValue: 2.0,
    inflationRate: 0.0,
    interestType: 'CAPITALIZED',
    ltvBasis: 'TOTAL_ASSETS',
  },
  annualExpenseAmount: 30000,
  cashCoverageYears: 15,
}

const INITIAL_PROFILES: Profile[] = [
  {
    id: '1',
    name: 'Conservative',
    color: '#2563eb', // Blue
    strategyType: 'NO_REBALANCE',
    config: DEFAULT_CONFIG_A,
  },
  {
    id: '2',
    name: 'Aggressive',
    color: '#ea580c', // Orange (High contrast)
    strategyType: 'SMART',
    config: DEFAULT_CONFIG_B,
  },
]

const MainApp = () => {
  const { t, language, setLanguage } = useTranslation()
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    const saved = localStorage.getItem('app_profiles')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        console.error('Failed to parse saved profiles:', e)
      }
    }
    return INITIAL_PROFILES
  })
  const [results, setResults] = useState<SimulationResult[]>([])
  const [currentMarketData, setCurrentMarketData] = useState<MarketDataRow[]>(MARKET_DATA)
  const [isCalculated, setIsCalculated] = useState(false)
  const [showBenchmarks, setShowBenchmarks] = useState<boolean>(() => {
    const saved = localStorage.getItem('app_show_benchmark')
    return saved === 'true'
  })
  const [isCalculating, setIsCalculating] = useState(false)

  // 自定义标的历史数据缓存：key=symbol, value=已护取的历史数据
  const [customMarketDataMap, setCustomMarketDataMap] = useState<
    Record<string, ReturnType<typeof buildMarketDataWithCustom>>
  >({})
  const [fetchingSymbols, setFetchingSymbols] = useState<Set<string>>(new Set())
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({})
  // 使用 ref 跟踪当前已经加载过的标的，防止重复请求
  const loadedSymbolsRef = useRef<Set<string>>(new Set())

  // Reporting Modal State
  const [reportResult, setReportResult] = useState<SimulationResult | null>(null)

  // View state: 'backtest' | 'monitor' | 'stocks'
  const [currentView, setCurrentView] = useState<'backtest' | 'monitor' | 'stocks'>('backtest')

  // Sidebar state
  const [isSidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('app_sidebar_open')
    return saved !== null ? saved === 'true' : true
  })

  // Clear results if market data has changed (cache busting)
  useEffect(() => {
    const lastDataDate = MARKET_DATA[MARKET_DATA.length - 1].date
    const savedLastDate = localStorage.getItem('app_last_market_date')
    const savedVersion = localStorage.getItem('app_version')

    // Only clear if the version has major change or market data extended significantly
    // and we are NOT in a testing environment (though window.CI isn't always set)
    if (savedLastDate && savedLastDate !== lastDataDate) {
      // Market data updated - just record the new date, don't necessarily clear everything
      // unless the user explicitly wants to reset. For now, let's just update the tracker.
      localStorage.setItem('app_last_market_date', lastDataDate)
    }

    if (savedVersion && savedVersion !== version) {
      localStorage.setItem('app_version', version)
      // If major version changed, we could clear, but let's be conservative to not break tests
    }

    if (!savedLastDate) localStorage.setItem('app_last_market_date', lastDataDate)
    if (!savedVersion) localStorage.setItem('app_version', version)
  }, [])

  // Auto-collapse on small screens initially
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false)
    }
  }, [])

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem('app_profiles', JSON.stringify(profiles))
  }, [profiles])

  useEffect(() => {
    localStorage.setItem('app_show_benchmark', String(showBenchmarks))
  }, [showBenchmarks])

  useEffect(() => {
    localStorage.setItem('app_sidebar_open', String(isSidebarOpen))
  }, [isSidebarOpen])

  useEffect(() => {
    if (profiles.length === 0) {
      setResults([])
      setIsCalculated(false)
    }
  }, [profiles])

  // 监听配置方案中的 customSymbol 变化，自动抓取历史数据
  useEffect(() => {
    const symbolsToFetch = new Set<string>()
    profiles.forEach((profile) => {
      const sym = profile.config.customSymbol?.toUpperCase().trim()
      if (sym && !loadedSymbolsRef.current.has(sym) && !fetchingSymbols.has(sym)) {
        symbolsToFetch.add(sym)
      }
    })

    if (symbolsToFetch.size === 0) return

    const fetchAll = async () => {
      setFetchingSymbols((prev) => new Set([...prev, ...symbolsToFetch]))

      await Promise.allSettled(
        Array.from(symbolsToFetch).map(async (sym) => {
          try {
            const rawData = await fetchTickerHistoryData(sym)
            const mergedData = buildMarketDataWithCustom(rawData)
            setCustomMarketDataMap((prev) => ({ ...prev, [sym]: mergedData }))
            setFetchErrors((prev) => {
              const next = { ...prev }
              delete next[sym]
              return next
            })
            loadedSymbolsRef.current.add(sym)
          } catch (err) {
            setFetchErrors((prev) => ({ ...prev, [sym]: (err as Error).message }))
            loadedSymbolsRef.current.add(sym) // 防止无限重试
          } finally {
            setFetchingSymbols((prev) => {
              const next = new Set(prev)
              next.delete(sym)
              return next
            })
          }
        }),
      )
    }

    fetchAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles])

  // ----------------------------------------------------------------
  // 手动重试抓取指定标的的历史数据
  // 清除缓存 → 从 loadedSymbolsRef 移除 → 重新触发 useEffect
  // ----------------------------------------------------------------
  const handleUpdateAllData = async () => {
    setIsCalculating(true) // 借用计算状态显示 Loading
    try {
      const symbolsToUpdate = ['QQQ', 'QLD']
      profiles.forEach(p => {
        const sym = p.config.customSymbol?.toUpperCase().trim()
        if (sym) symbolsToUpdate.push(sym)
      })
      
      const uniqueSymbols = Array.from(new Set(symbolsToUpdate))
      for (const symbol of uniqueSymbols) {
        await refetchTickerHistoryData(symbol)
      }
      // 刷新基准行情
      const currentFullData = getExtendedMarketData()
      setCurrentMarketData(currentFullData)
      
      alert(t('dataUpdatedSuccess') || '行情数据已更新为每日精度！')
    } catch (e) {
      alert(t('dataUpdateError') || '更新失败: ' + (e as Error).message)
    } finally {
      setIsCalculating(false)
    }
  }

  const handleRefetchSymbol = useCallback(
    async (symbol: string) => {
      const upperSym = symbol.toUpperCase().trim()
      if (!upperSym) return

      // 1. 将该 symbol 从「已尝试」集合中移除，允许重新触发
      loadedSymbolsRef.current.delete(upperSym)

      // 2. 标记为正在加载
      setFetchingSymbols((prev) => new Set([...prev, upperSym]))
      setFetchErrors((prev) => {
        const next = { ...prev }
        delete next[upperSym]
        return next
      })

      try {
        // 3. 强制清缓存后重新抓取（4级回退策略）
        const rawData = await refetchTickerHistoryData(upperSym)
        const mergedData = buildMarketDataWithCustom(rawData)
        setCustomMarketDataMap((prev) => ({ ...prev, [upperSym]: mergedData }))
        loadedSymbolsRef.current.add(upperSym)
      } catch (err) {
        setFetchErrors((prev) => ({ ...prev, [upperSym]: (err as Error).message }))
        loadedSymbolsRef.current.add(upperSym)
      } finally {
        setFetchingSymbols((prev) => {
          const next = new Set(prev)
          next.delete(upperSym)
          return next
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const handleRunSimulation = useCallback(() => {
    setIsCalculating(true)

    // 使用 setTimeout 让 UI 先渲染“计算中”状态
    setTimeout(() => {
      try {
        const newResults: SimulationResult[] = []
        // 0. 刷新基础市场数据 (支持从本地缓存延伸日期范围)
        const baseMarketData = getExtendedMarketData()
        setCurrentMarketData(baseMarketData)

        // 1. 运行策略回测
        profiles.forEach((profile) => {
          const strategyFunc = getStrategyByType(profile.strategyType)
          // 选择市场数据：如果有自定义标的，使用最新的基础数据进行合并
          const sym = profile.config.customSymbol?.toUpperCase().trim()
          let marketDataToUse: MarketDataRow[] = baseMarketData

          if (sym) {
            // 如果 customMarketDataMap 中已有该标的的数据，确保它是基于最新的 baseMarketData 构建的
            // 简单起见，我们从 localStorage 实时构建或使用缓存
            const cachedCustom = localStorage.getItem(`ticker_cache_${sym}`)
            if (cachedCustom) {
              try {
                const entry = JSON.parse(cachedCustom)
                const rawData = Array.isArray(entry) ? entry : (entry.data || [])
                marketDataToUse = buildMarketDataWithCustom(rawData, baseMarketData)
              } catch (e) {
                marketDataToUse = customMarketDataMap[sym] || baseMarketData
              }
            } else {
              marketDataToUse = customMarketDataMap[sym] || baseMarketData
            }
          }

          newResults.push(
            runBacktest(marketDataToUse, strategyFunc, profile.config, profile.name, profile.color),
          )
        })

        // 2. Add Benchmarks (based on the first profile's capital/contribution settings)
        if (profiles.length > 0 && showBenchmarks) {
          const firstProfile = profiles[0]
          if (!firstProfile) return
          const baseConfig = firstProfile.config

          // Benchmark: QQQ (Nasdaq 100)
          const qqqConfig: AssetConfig = {
            ...baseConfig,
            qqqWeight: 100,
            qldWeight: 0,
            contributionQqqWeight: 100,
            contributionQldWeight: 0,
            leverage: {
              ...baseConfig.leverage,
              enabled: false, // Benchmarks are unleveraged
            },
          }

          // Benchmark: QLD (2x Leveraged Nasdaq 100)
          const qldConfig: AssetConfig = {
            ...baseConfig,
            qqqWeight: 0,
            qldWeight: 100,
            contributionQqqWeight: 0,
            contributionQldWeight: 100,
            leverage: {
              ...baseConfig.leverage,
              enabled: false, // Benchmarks are unleveraged
            },
          }

          // Run Benchmarks (QQQ & QLD)
          newResults.push(
            runBacktest(
              baseMarketData,
              getStrategyByType('NO_REBALANCE'),
              qqqConfig,
              'Benchmark: QQQ',
              '#64748b', // Slate-500
            ),
          )

          newResults.push(
            runBacktest(
              baseMarketData,
              getStrategyByType('NO_REBALANCE'),
              qldConfig,
              'Benchmark: QLD',
              '#94a3b8', // Slate-400
            ),
          )
        }

        setResults(newResults)
        setIsCalculated(true)
      } catch (err) {
        console.error('Simulation failed:', err)
        alert('Simulation failed: ' + (err as Error).message)
      } finally {
        setIsCalculating(false)
        // Auto close on mobile only
        if (window.innerWidth < 1024) {
          setSidebarOpen(false)
        }
      }
    }, 100) // Small delay to yield to UI thread
  }, [profiles, showBenchmarks])

  useEffect(() => {
    handleRunSimulation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleViewDetails = (profileId: string) => {
    if (!isCalculated) return
    // We need to map the profile ID to the result index.
    // Since results map 1:1 to profiles array order:
    const index = profiles.findIndex((p) => p.id === profileId)
    if (index >= 0 && results[index]) {
      setReportResult(results[index])
    }
  }

  const LangButton = ({ code, label }: { code: Language; label: string }) => (
    <button
      onClick={() => setLanguage(code)}
      className={`text-xs px-2 py-1 rounded transition-colors font-medium ${language === code ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans text-slate-900 relative overflow-x-hidden">
      {/* Financial Report Modal */}
      {reportResult && (
        <FinancialReportModal result={reportResult} onClose={() => setReportResult(null)} />
      )}

      {/* Mobile/Tablet Portrait Header (< 1024px) */}
      <div className="lg:hidden bg-white p-4 border-b border-slate-200 sticky top-0 z-40 flex flex-col gap-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="text-blue-600" />
            <h1 className="font-bold text-lg">
              {t('appTitle')}
              <span className="ml-1 text-[10px] font-mono text-slate-400 font-normal">
                v{version}
              </span>
            </h1>
          </div>

          <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${isSidebarOpen ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-600'}`}
          >
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Settings2 className="w-5 h-5" />}
            <span className="text-sm font-medium">{isSidebarOpen ? t('done') : t('profiles')}</span>
          </button>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-400 font-medium">
            {isCalculated ? `${t('comparingPerformance')} ${results.length}` : ''}
          </span>
          <div className="flex gap-1">
            <LangButton code="en" label="EN" />
            <LangButton code="fr" label="FR" />
            <LangButton code="zh-CN" label="简" />
            <LangButton code="zh-TW" label="繁" />
          </div>
        </div>
      </div>

      {/* Mobile Backdrop Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Calculating Overlay */}
      {isCalculating && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-[2px] z-[100] flex flex-col items-center justify-center">
          <div className="bg-white p-8 rounded-2xl shadow-2xl border border-slate-100 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-200">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
              <Activity className="absolute inset-0 m-auto w-6 h-6 text-blue-600 animate-pulse" />
            </div>
            <div className="text-center">
              <h3 className="font-bold text-slate-800 text-lg">{t('calculating')}</h3>
              <p className="text-sm text-slate-400 mt-1">{t('calculationDesc')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Container */}
      <aside
        className={`
            fixed inset-y-0 left-0 z-50 
            bg-slate-50 border-r border-slate-200 
            flex flex-col flex-shrink-0
            transition-all duration-300 ease-in-out
            shadow-2xl lg:shadow-none
            
            /* Mobile Logic: slide in/out */
            ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            w-80
            
            /* Desktop Logic: Sticky, variable width, reset fixed positioning */
            lg:translate-x-0 lg:static lg:inset-auto lg:h-screen lg:sticky lg:top-0
            ${isSidebarOpen ? 'lg:w-80 xl:w-96 lg:border-r' : 'lg:w-0 lg:border-none lg:overflow-hidden'}
          `}
      >
        {/* Sidebar Header (Fixed within sidebar) */}
        <div className="flex-shrink-0 p-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-4">
          <div className="hidden lg:flex justify-between items-center">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="text-blue-600 w-6 h-6" />
              <h1 className="font-bold text-xl tracking-tight text-slate-800">
                {t('appTitle')}
                <span className="ml-2 text-xs font-mono text-slate-400 font-normal tracking-normal">
                  v{version}
                </span>
              </h1>
            </div>

            {/* Desktop Collapse Button */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 transition-colors"
              title="Collapse Sidebar"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          <div className="hidden lg:flex gap-1">
            <LangButton code="en" label="English" />
            <LangButton code="fr" label="Français" />
            <LangButton code="zh-CN" label="简体中文" />
            <LangButton code="zh-TW" label="繁體中文" />
          </div>

          <div className="flex bg-slate-200/50 p-1 rounded-xl gap-1">
            <button
              onClick={() => setCurrentView('backtest')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                currentView === 'backtest'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LineChart className="w-4 h-4" />
              {t('backtestView')}
            </button>
            <button
              onClick={() => setCurrentView('monitor')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                currentView === 'monitor'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Activity className="w-4 h-4" />
              {t('liveMonitor')}
            </button>
            <button
              onClick={() => setCurrentView('stocks')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                currentView === 'stocks'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Database className="w-4 h-4" />
              数据管理
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-8">
          {/* Wrapper to ensure width stability during transitions */}
          <div className="min-w-[18rem]">
            <ConfigPanel
              profiles={profiles}
              onProfilesChange={setProfiles}
              onRun={handleRunSimulation}
              onViewDetails={handleViewDetails}
              hasResults={isCalculated}
              showBenchmark={showBenchmarks}
              onShowBenchmarkChange={setShowBenchmarks}
              fetchingSymbols={fetchingSymbols}
              fetchErrors={fetchErrors}
              onRefetchSymbol={handleRefetchSymbol}
            />

            <div className="mt-8 px-2 text-xs text-slate-400 leading-relaxed hidden lg:block">
              <p>
                {t('dataRange')}: {currentMarketData.length > 0 ? currentMarketData[0].date.substring(0, 4) : '—'} -{' '}
                {currentMarketData.length > 0 ? currentMarketData[currentMarketData.length - 1].date.substring(0, 4) : '—'}
              </p>
              <p className="mt-2">{t('appDesc')}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 lg:p-8 relative">
        {/* Desktop Expand Button (Floating) */}
        <div
          className={`fixed top-6 left-6 z-30 transition-opacity duration-300 hidden lg:block ${!isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="hidden lg:flex bg-white p-2.5 rounded-lg shadow-lg border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-300 transition-all"
            title="Open Sidebar"
          >
            <PanelLeftOpen className="w-6 h-6" />
          </button>
        </div>

        {currentView === 'stocks' ? (
          <div className="max-w-3xl mx-auto animate-in fade-in duration-500">
            <div className="mb-6 hidden lg:block">
              <h2 className="text-2xl font-bold text-slate-800">历史股价管理</h2>
              <p className="text-slate-500">下载并缓存标的历史数据到本地，支持自定义标的回测。</p>
            </div>
            <PriceUpdatePanel />
          </div>
        ) : currentView === 'monitor' ? (
          <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
            <MarketMonitor />
          </div>
        ) : isCalculated && results.length > 0 ? (
          <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
            <div className="mb-6 hidden lg:block">
              <h2 className="text-2xl font-bold text-slate-800">{t('simulationResults')}</h2>
              <p className="text-slate-500">
                {t('comparingPerformance')} {results.length} {t('profiles')}.
              </p>
            </div>
            <ResultsDashboard 
              results={results} 
              onUpdateMarketData={handleUpdateAllData}
              isUpdatingData={isCalculating}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            {profiles.length === 0 ? t('addProfile') : t('runComparison')}
          </div>
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <MainApp />
      <Analytics />
    </LanguageProvider>
  )
}
