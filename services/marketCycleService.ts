import { PortfolioState, CycleSegment, MarketPhaseLabel, CyclePhase } from '../types'
import { CYCLE_PARAMS } from '../constants'

/**
 * 根据距 ATH 跌幅 / 距低点涨幅，解析当月市场阶段标签 (PRD §4.3)
 */
export function resolveMarketPhase(
  drawdownFromAth: number, // 负数，如 -0.32
  recoveryFromTrough: number, // 正数，如 0.15
  isFirstMonth: boolean,
  isSidewaysForMonths: number,
): MarketPhaseLabel {
  if (isFirstMonth) return 'PHASE_INITIAL'

  // 1. 下行阶段（跌幅优先）
  if (drawdownFromAth <= -0.50) return 'PHASE_CATASTROPHE'
  if (drawdownFromAth <= -0.40) return 'PHASE_FINANCIAL_STORM'
  if (drawdownFromAth <= -0.30) return 'PHASE_FINANCIAL_CRISIS'
  if (drawdownFromAth <= -0.20) return 'PHASE_BEAR'
  if (drawdownFromAth <= -0.10) return 'PHASE_CORRECTION'
  if (drawdownFromAth <= -0.05) return 'PHASE_ALERT'

  // 2. 上行阶段 (ATH 后或反弹)
  // 突破 ATH 的逻辑在引擎中识别并直接注入，这里主要判断反弹
  if (drawdownFromAth >= -0.001) {
    // 创新高后的亢奋期
    if (recoveryFromTrough >= 0.20) return 'PHASE_EUPHORIA'
    return 'PHASE_NEW_ATH'
  }

  if (recoveryFromTrough >= 0.30) return 'PHASE_STRONG_BULL'
  if (recoveryFromTrough >= 0.20) return 'PHASE_BULL'
  if (recoveryFromTrough >= 0.10) return 'PHASE_REBOUND'
  if (recoveryFromTrough >= 0.05) return 'PHASE_STABILIZE'

  // 3. 中性状态
  if (isSidewaysForMonths >= 3) return 'PHASE_SIDEWAYS'
  
  return 'PHASE_NORMAL'
}

/**
 * 从回测历史中识别市场周期分段 (PRD §3.3)
 * @param history - 回测历史
 * @param customThresholds - 可选自定义阈值（覆盖 CYCLE_PARAMS 默认值）
 */
export function detectCycleSegments(
  history: PortfolioState[],
  customThresholds?: {
    drawdownThreshold?: number
    recoveryThreshold?: number
    athBuffer?: number
    mergeGapMonths?: number
  },
): CycleSegment[] {
  if (history.length === 0) return []

  // 合并阈值：优先使用自定义值，否则退回到 CYCLE_PARAMS 默认值
  const drawdownThreshold = customThresholds?.drawdownThreshold ?? CYCLE_PARAMS.DRAWDOWN_THRESHOLD
  const recoveryThreshold = customThresholds?.recoveryThreshold ?? CYCLE_PARAMS.RECOVERY_THRESHOLD
  const athBuffer = customThresholds?.athBuffer ?? CYCLE_PARAMS.ATH_BUFFER
  const mergeGapMonths = customThresholds?.mergeGapMonths ?? 2

  const segments: CycleSegment[] = []
  let currentAth = 0
  let currentTrough = Infinity
  let currentType: CyclePhase = 'CYCLE_NEW_HIGH'
  let segmentStartIdx = 0

  // 辅助函数：创建并添加分段
  const pushSegment = (endIdx: number, nextType: CyclePhase) => {
    const start = history[segmentStartIdx]
    const end = history[endIdx]
    
    // 计算该段内的峰值和谷值
    const slice = history.slice(segmentStartIdx, endIdx + 1)
    const peakValue = Math.max(...slice.map(s => s.totalValue))
    const troughValue = Math.min(...slice.map(s => s.totalValue))
    
    segments.push({
      startDate: start.date,
      endDate: end.date,
      type: currentType,
      peakValue,
      troughValue,
      drawdownPct: peakValue > 0 ? (troughValue / peakValue - 1) * 100 : 0,
      recoveryPct: troughValue > 0 ? (end.totalValue / troughValue - 1) * 100 : 0,
    })
    
    segmentStartIdx = endIdx + 1
    currentType = nextType
  }

  for (let i = 0; i < history.length; i++) {
    const state = history[i]
    const val = state.totalValue

    // 更新 ATH 和 Trough
    if (val > currentAth) {
      currentAth = val
      currentTrough = val // 重置谷值，因为创了新高
    }
    if (val < currentTrough) {
      currentTrough = val
    }

    const drawdown = currentAth > 0 ? (val / currentAth - 1) : 0
    const recovery = currentTrough > 0 ? (val / currentTrough - 1) : 0

    let nextType: CyclePhase = currentType

    // 状态转换逻辑（使用自定义阈值）
    if (drawdown <= -drawdownThreshold) {
      nextType = 'CYCLE_DRAWDOWN'
    } else if (recovery >= recoveryThreshold && drawdown < -0.01) {
      nextType = 'CYCLE_RECOVERY'
    } else if (val >= currentAth * (1 - athBuffer)) {
      nextType = 'CYCLE_NEW_HIGH'
    } else if (drawdown > -0.05 && drawdown < 0) {
      nextType = 'CYCLE_PEAK'
    }

    // 如果状态发生变化且不是最后一行，或者到了最后一行
    if (nextType !== currentType && i > segmentStartIdx) {
      pushSegment(i - 1, nextType)
    } else if (i === history.length - 1) {
      pushSegment(i, nextType)
    }
  }

  // 修复：确保分段连续且无空洞 (TC-B02)
  const validSegments = segments.filter(s => s.startDate <= s.endDate)

  // 短分段合并逻辑：将过短的分段合并到前一个分段
  if (mergeGapMonths > 0 && validSegments.length > 1) {
    const merged: CycleSegment[] = []
    for (let i = 0; i < validSegments.length; i++) {
      const seg = validSegments[i]
      // 估算分段长度（通过日期差）
      const startMs = new Date(seg.startDate).getTime()
      const endMs = new Date(seg.endDate).getTime()
      const monthLength = Math.round((endMs - startMs) / (30 * 24 * 60 * 60 * 1000))

      if (monthLength < mergeGapMonths && merged.length > 0) {
        // 合并到前一个分段：延长结束日期，取两段中更极端的数据
        const prev = merged[merged.length - 1]
        prev.endDate = seg.endDate
        prev.troughValue = Math.min(prev.troughValue ?? Infinity, seg.troughValue ?? Infinity)
        prev.peakValue = Math.max(prev.peakValue ?? 0, seg.peakValue ?? 0)
        prev.drawdownPct = (prev.peakValue ?? 0) > 0 ? ((prev.troughValue ?? 0) / (prev.peakValue ?? 1) - 1) * 100 : 0
      } else {
        merged.push({ ...seg })
      }
    }
    return merged
  }

  return validSegments
}

/**
 * 解析当前周期的状态 (PRD §3.3 伪代码实现)
 */
export function resolveCyclePhase(
  drawdownFromAth: number,
  recoveryFromTrough: number,
  ath: number,
  currentValue: number,
  currentType: CyclePhase,
): CyclePhase {
  if (currentValue >= ath * (1 - CYCLE_PARAMS.ATH_BUFFER)) {
    return 'CYCLE_NEW_HIGH'
  }
  
  if (drawdownFromAth <= -CYCLE_PARAMS.DRAWDOWN_THRESHOLD) {
    return 'CYCLE_DRAWDOWN'
  }

  if (recoveryFromTrough >= CYCLE_PARAMS.RECOVERY_THRESHOLD && drawdownFromAth < -0.01) {
    return 'CYCLE_RECOVERY'
  }

  if (drawdownFromAth > -0.05 && drawdownFromAth < 0) {
    return 'CYCLE_PEAK'
  }

  return currentType
}


/**
 * 获取市场阶段对应的 UI 配置 (PRD §4.3)
 */
export function getMarketPhaseConfig(phase: MarketPhaseLabel) {
  const configs: Record<MarketPhaseLabel, { label: string; badgeClass: string; rowBgClass: string; emoji: string }> = {
    PHASE_INITIAL: { label: '初始建仓', badgeClass: 'bg-purple-100 text-purple-800', rowBgClass: 'bg-white', emoji: '🟣' },
    PHASE_ALERT: { label: '市场预警', badgeClass: 'bg-orange-100 text-orange-800', rowBgClass: 'bg-orange-50', emoji: '🟠' },
    PHASE_CORRECTION: { label: '市场调整', badgeClass: 'bg-yellow-100 text-yellow-800', rowBgClass: 'bg-yellow-50', emoji: '🟡' },
    PHASE_BEAR: { label: '熊市', badgeClass: 'bg-red-100 text-red-700', rowBgClass: 'bg-red-50', emoji: '🔴' },
    PHASE_FINANCIAL_CRISIS: { label: '金融海啸', badgeClass: 'bg-red-200 text-red-800', rowBgClass: 'bg-red-100', emoji: '🔴' },
    PHASE_FINANCIAL_STORM: { label: '金融风暴', badgeClass: 'bg-red-300 text-red-900', rowBgClass: 'bg-red-200', emoji: '⛔' },
    PHASE_CATASTROPHE: { label: '市场崩溃', badgeClass: 'bg-red-900 text-white', rowBgClass: 'bg-red-300', emoji: '💀' },
    PHASE_STABILIZE: { label: '企稳', badgeClass: 'bg-green-100 text-green-700', rowBgClass: 'bg-green-50', emoji: '🟢' },
    PHASE_REBOUND: { label: '技术反弹', badgeClass: 'bg-green-200 text-green-800', rowBgClass: 'bg-green-50', emoji: '🟢' },
    PHASE_BULL: { label: '牛市', badgeClass: 'bg-emerald-100 text-emerald-800', rowBgClass: 'bg-emerald-50', emoji: '🐂' },
    PHASE_STRONG_BULL: { label: '强势牛市', badgeClass: 'bg-emerald-200 text-emerald-900', rowBgClass: 'bg-emerald-50', emoji: '🐂' },
    PHASE_NEW_ATH: { label: '历史新高', badgeClass: 'bg-blue-100 text-blue-800', rowBgClass: 'bg-blue-50', emoji: '🏆' },
    PHASE_EUPHORIA: { label: '市场亢奋', badgeClass: 'bg-blue-200 text-blue-900', rowBgClass: 'bg-blue-50', emoji: '🚀' },
    PHASE_NORMAL: { label: '正常运行', badgeClass: 'bg-slate-100 text-slate-600', rowBgClass: 'bg-white', emoji: '⚪' },
    PHASE_SIDEWAYS: { label: '横盘整理', badgeClass: 'bg-gray-100 text-gray-600', rowBgClass: 'bg-gray-50', emoji: '➡️' },
  }
  return configs[phase] || configs.PHASE_NORMAL
}

/**
 * 计算横盘持续月数
 */
export function resolveSidewaysMonths(history: PortfolioState[], currentIndex: number): number {
  if (currentIndex < 3) return 0
  const recent = history.slice(currentIndex - 3, currentIndex + 1)
  const values = recent.map(s => s.totalValue)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = (max - min) / (min || 1)
  return range < 0.05 ? 3 : 0 // 3个月波动小于5%则判定为横盘
}
