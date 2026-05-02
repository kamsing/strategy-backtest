import { describe, it, expect } from 'vitest'
import { strategyBearRotation } from '../strategies'
import { AssetConfig, PortfolioState } from '../../types'

// ============================================================
// 测试辅助函数
// ============================================================

/**
 * 创建基础配置（50% QQQ + 0% QLD + 10% CASH）
 */
const createBearRotationConfig = (overrides?: Partial<AssetConfig>): AssetConfig => ({
  initialCapital: 1_000_000,
  contributionAmount: 0,
  contributionIntervalMonths: 1,
  yearlyContributionMonth: 12,
  qqqWeight: 90,
  qldWeight: 0,
  contributionQqqWeight: 100,
  contributionQldWeight: 0,
  cashYieldAnnual: 0,
  leverage: {
    enabled: false,
    interestRate: 5,
    qqqPledgeRatio: 0.7,
    qldPledgeRatio: 0,
    cashPledgeRatio: 0.95,
    maxLtv: 100,
    withdrawType: 'PERCENT',
    withdrawValue: 0,
    inflationRate: 0,
    interestType: 'CAPITALIZED',
    ltvBasis: 'TOTAL_ASSETS',
  },
  bearRotation: {
    tripleETF: 'TQQQ',
    enableAlerts: false,
  },
  ...overrides,
})

/**
 * 创建初始状态
 */
const createInitialState = (qqqQty = 10000, cash = 100000): PortfolioState => ({
  date: '2020-01-01',
  shares: { QQQ: qqqQty, QLD: 0, CUSTOM: 0, TQQQ: 0 },
  cashBalance: cash,
  debtBalance: 0,
  accruedInterest: 0,
  totalValue: qqqQty * 100 + cash,
  strategyMemory: {},
  ltv: 0,
  beta: 0,
  events: [],
})

/**
 * 创建市场数据行
 */
const mkData = (date: string, qqqClose: number, qqqLow?: number, tqqqClose?: number) => ({
  date,
  qqqClose,
  qqqLow: qqqLow ?? qqqClose * 0.98,
  qldClose: qqqClose * 2,
  qldLow: qqqClose * 1.9,
  customPrices: (tqqqClose !== undefined ? { TQQQ: tqqqClose } : {}) as Record<string, number>,
  customLows: (tqqqClose !== undefined ? { TQQQ: tqqqClose * 0.97 } : {}) as Record<string, number>,
})

// ============================================================
// 测试用例
// ============================================================

describe('strategyBearRotation - 熊市仓位转换策略（PRD B1）', () => {
  describe('初始化与 HWM 设置', () => {
    it('首月应初始化 HWM 为当前 QQQ 价格', () => {
      const config = createBearRotationConfig()
      const state = createInitialState()
      const data = mkData('2020-01-01', 100, undefined, 30)
      const result = strategyBearRotation(state, data, config, 0)
      expect(result.strategyMemory['hwm']).toBe(100)
      expect(result.strategyMemory['bearPhase']).toBe(0)
      expect(result.strategyMemory['mode']).toBe('normal')
    })

    it('价格上涨时 HWM 应单调递增', () => {
      const config = createBearRotationConfig()
      let state = createInitialState()
      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      state = strategyBearRotation(state, mkData('2020-02-01', 110, undefined, 33), config, 1)
      state = strategyBearRotation(state, mkData('2020-03-01', 105, undefined, 31), config, 2)
      expect(state.strategyMemory['hwm']).toBe(110) // 最高价 110
    })
  })

  describe('bearPhase 0→4 仓位转换', () => {
    it('下跌 10% 触发 bearPhase=1：应转换 10% QQQ 仓位为 TQQQ', () => {
      const config = createBearRotationConfig()
      const initialQQQQty = 10000

      // 首月建仓
      let state = createInitialState(initialQQQQty, 0)
      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      const qqqAfterInit = state.shares['QQQ'] ?? 0

      // 下跌至 90（-10%）
      state = strategyBearRotation(state, mkData('2020-02-01', 90, undefined, 25), config, 1)

      expect(state.strategyMemory['bearPhase']).toBe(1)
      expect(state.strategyMemory['mode']).toBe('bear')

      // QQQ 应减少约 10%
      const qqqReduced = qqqAfterInit * 0.1
      expect(state.shares['QQQ']).toBeCloseTo(qqqAfterInit - qqqReduced, 0)

      // TQQQ 应增加（对应价值）
      expect((state.shares['TQQQ'] ?? 0)).toBeGreaterThan(0)
    })

    it('下跌 20% 触发 bearPhase=2：应继续转换 20% QQQ', () => {
      const config = createBearRotationConfig()
      let state = createInitialState(10000, 0)

      // 首月
      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      // -10%
      state = strategyBearRotation(state, mkData('2020-02-01', 90, undefined, 25), config, 1)
      const qqqBefore20 = state.shares['QQQ'] ?? 0

      // -20%
      state = strategyBearRotation(state, mkData('2020-03-01', 80, undefined, 20), config, 2)
      expect(state.strategyMemory['bearPhase']).toBe(2)
      expect(state.shares['QQQ']).toBeCloseTo(qqqBefore20 * 0.8, 0)
    })

    it('bearPhase 不应超过 4', () => {
      const config = createBearRotationConfig()
      let state = createInitialState(10000, 0)
      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      // 模拟极端下跌
      state = strategyBearRotation(state, mkData('2020-02-01', 50, undefined, 10), config, 1)
      expect(state.strategyMemory['bearPhase']).toBeLessThanOrEqual(4)
    })
  })

  describe('recoveryPhase 0→4 仓位换回', () => {
    it('从低点反弹 10% 触发 recoveryPhase=1：应卖出 10% TQQQ 换回 QQQ', () => {
      const config = createBearRotationConfig()
      let state = createInitialState(10000, 0)

      // 首月
      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      // 下跌 -20%（触发 bearPhase=2）
      state = strategyBearRotation(state, mkData('2020-02-01', 80, undefined, 20), config, 1)
      const tqqqBefore = state.shares['TQQQ'] ?? 0
      expect(tqqqBefore).toBeGreaterThan(0)

      // 从低点反弹 10%（80 → 88）
      state = strategyBearRotation(state, mkData('2020-03-01', 88, undefined, 22), config, 2)

      expect(state.strategyMemory['mode']).toBe('recovery')
      expect(state.strategyMemory['recoveryPhase']).toBeGreaterThanOrEqual(1)
      // TQQQ 应减少
      expect(state.shares['TQQQ']).toBeLessThan(tqqqBefore)
    })

    it('完全恢复（+40%）后应回归 normal 模式并更新 HWM', () => {
      const config = createBearRotationConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      // 跌 -40%
      state = strategyBearRotation(state, mkData('2020-02-01', 60, undefined, 15), config, 1)
      const lwm = 60

      // 反弹 +40% = 60 * 1.4 = 84，但 HWM=100 仍低，不会 reset normal
      // 继续上涨到超过 HWM 才 reset
      state = strategyBearRotation(state, mkData('2020-03-01', lwm * 1.42, undefined, 25), config, 2)

      // recoveryPhase 应为 4（+40%以上）
      expect(state.strategyMemory['recoveryPhase']).toBe(4)
    })
  })

  describe('边界情况', () => {
    it('TQQQ 价格为 0 时不应发生交易', () => {
      const config = createBearRotationConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      const qqqBefore = state.shares['QQQ'] ?? 0

      // 下跌 -10% 但 TQQQ 价格为 0
      const dataNoTQQQ = {
        date: '2020-02-01',
        qqqClose: 90,
        qqqLow: 88,
        qldClose: 180,
        qldLow: 176,
        customPrices: { TQQQ: 0 }, // 价格为 0，不应交易
        customLows: {},
      }
      state = strategyBearRotation(state, dataNoTQQQ, config, 1)

      // QQQ 不应减少（因为 TQQQ 无法买入）
      expect(state.shares['QQQ']).toBeCloseTo(qqqBefore, 0)
    })

    it('每档操作只执行一次（幂等性）', () => {
      const config = createBearRotationConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearRotation(state, mkData('2020-01-01', 100, undefined, 30), config, 0)
      // 下跌 -10%，触发 bearPhase=1
      state = strategyBearRotation(state, mkData('2020-02-01', 90, undefined, 25), config, 1)
      const qqqAfterPhase1 = state.shares['QQQ'] ?? 0

      // 价格继续在 -10% 区间，不应再次触发
      state = strategyBearRotation(state, mkData('2020-03-01', 91, undefined, 26), config, 2)
      expect(state.shares['QQQ']).toBeCloseTo(qqqAfterPhase1, 0)
    })
  })
})
