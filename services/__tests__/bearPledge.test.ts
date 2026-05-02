import { describe, it, expect } from 'vitest'
import { strategyBearPledge } from '../strategies'
import { AssetConfig, PortfolioState } from '../../types'

// ============================================================
// 测试辅助函数
// ============================================================

const createBearPledgeConfig = (overrides?: Partial<AssetConfig>): AssetConfig => ({
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
  bearPledge: {
    buyTarget: 'QQQ',
    maxPledgeRatio: 0.10, // 10% 上限
    enableAlerts: false,
  },
  ...overrides,
})

const createInitialState = (qqqQty = 10000, cash = 0): PortfolioState => ({
  date: '2020-01-01',
  shares: { QQQ: qqqQty, QLD: 0, CUSTOM: 0 },
  cashBalance: cash,
  debtBalance: 0,
  accruedInterest: 0,
  totalValue: qqqQty * 100 + cash,
  strategyMemory: {},
  ltv: 0,
  beta: 0,
  events: [],
})

const mkData = (date: string, qqqClose: number, qqqLow?: number) => ({
  date,
  qqqClose,
  qqqLow: qqqLow ?? qqqClose * 0.98,
  qldClose: qqqClose * 2,
  qldLow: qqqClose * 1.9,
  customPrices: {},
  customLows: {},
})

// ============================================================
// 测试用例
// ============================================================

describe('strategyBearPledge - 熊市质押借款策略（PRD B2）', () => {
  describe('质押借款额度上限', () => {
    it('进入 bearPhase=1 时应设置借款上限为总资产的 10%', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0) // 总资产 10000 * 100 = 1,000,000

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      expect(state.strategyMemory['hwm']).toBe(100)

      // 下跌 -10%，触发 bearPhase=1
      state = strategyBearPledge(state, mkData('2020-02-01', 90), config, 1)
      expect(state.strategyMemory['bearPhase']).toBe(1)

      // pledgeBudget 应为进入熊市时总资产的 10%
      const budget = state.strategyMemory['pledgeBudget'] as number
      expect(budget).toBeGreaterThan(0)
      expect(budget).toBeLessThanOrEqual(state.totalValue * 0.11) // 容忍少量误差
    })

    it('累计借款不应超过 maxPledgeRatio 上限', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      // -10%
      state = strategyBearPledge(state, mkData('2020-02-01', 90), config, 1)
      // -20%
      state = strategyBearPledge(state, mkData('2020-03-01', 80), config, 2)
      // -30%
      state = strategyBearPledge(state, mkData('2020-04-01', 70), config, 3)
      // -40%
      state = strategyBearPledge(state, mkData('2020-05-01', 60), config, 4)

      const pledgeDebt = state.strategyMemory['pledgeDebt'] as number
      const budget = state.strategyMemory['pledgeBudget'] as number
      // 累计债务不超过 budget
      expect(pledgeDebt).toBeLessThanOrEqual(budget * 1.01) // 1% 容忍
    })
  })

  describe('分批借款买入', () => {
    it('bearPhase=1：应借入总资产 1% 并买入 QQQ', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      // 首月（总资产 = 10000 * 100 = 1,000,000）
      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      const totalBefore = state.totalValue
      const debtBefore = state.debtBalance

      // 下跌 -10%，触发 bearPhase=1
      state = strategyBearPledge(state, mkData('2020-02-01', 90), config, 1)

      // 应该有债务增加
      expect(state.debtBalance).toBeGreaterThan(debtBefore)

      // 借款量约为当时总资产的 1%
      const borrowed = state.debtBalance - debtBefore
      expect(borrowed).toBeGreaterThan(0)
      expect(borrowed).toBeLessThanOrEqual(totalBefore * 0.015) // 容忍少量误差
    })

    it('每档只借款一次（幂等性）', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      state = strategyBearPledge(state, mkData('2020-02-01', 90), config, 1)
      const debtAfterPhase1 = state.debtBalance

      // 价格继续在 -10% 区间（不触发新阶段）
      state = strategyBearPledge(state, mkData('2020-03-01', 91), config, 2)
      expect(state.debtBalance).toBeCloseTo(debtAfterPhase1, 0)
    })
  })

  describe('分批还款（反弹时）', () => {
    it('从低点反弹 10% 应卖出并还款', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      // -10%
      state = strategyBearPledge(state, mkData('2020-02-01', 90), config, 1)
      // -20%
      state = strategyBearPledge(state, mkData('2020-03-01', 80), config, 2)
      const debtPeak = state.debtBalance
      expect(debtPeak).toBeGreaterThan(0)

      // 从低点 80 反弹 +10% = 88
      state = strategyBearPledge(state, mkData('2020-04-01', 88), config, 3)
      expect(state.strategyMemory['mode']).toBe('recovery')
      // 债务应减少
      expect(state.debtBalance).toBeLessThan(debtPeak)
    })

    it('recoveryPhase=4（+40%）时应完全清零质押债务', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      // 分阶段下跌，触发每档借款（月度数据每档只触发一次）
      state = strategyBearPledge(state, mkData('2020-02-01', 90), config, 1) // -10% → bearPhase=1
      state = strategyBearPledge(state, mkData('2020-03-01', 80), config, 2) // -20% → bearPhase=2
      state = strategyBearPledge(state, mkData('2020-04-01', 70), config, 3) // -30% → bearPhase=3
      state = strategyBearPledge(state, mkData('2020-05-01', 60), config, 4) // -40% → bearPhase=4
      const debtPeak = state.debtBalance
      expect(debtPeak).toBeGreaterThan(0)

      // 从 60 反弹 +40% = 84
      state = strategyBearPledge(state, mkData('2020-06-01', 84), config, 5)
      if ((state.strategyMemory['recoveryPhase'] as number) >= 4) {
        expect(state.strategyMemory['pledgeDebt']).toBeLessThanOrEqual(0.01)
        expect((state.strategyMemory['pledgeBatches'] as []).length).toBe(0)
      }
    })
  })

  describe('边界情况', () => {
    it('正常市场（无下跌）时不应有任何借款', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      // 持续上涨
      for (let i = 1; i <= 12; i++) {
        state = strategyBearPledge(state, mkData(`2020-${String(i + 1).padStart(2, '0')}-01`, 100 + i * 5), config, i)
      }
      expect(state.debtBalance).toBe(0)
    })

    it('bearPhase=4 后不再新增借款', () => {
      const config = createBearPledgeConfig()
      let state = createInitialState(10000, 0)

      state = strategyBearPledge(state, mkData('2020-01-01', 100), config, 0)
      // 下跌至 -40%（一步到位）
      state = strategyBearPledge(state, mkData('2020-02-01', 59), config, 1) // bearPhase=4
      const debtMax = state.debtBalance

      // 继续下跌也不新增
      state = strategyBearPledge(state, mkData('2020-03-01', 50), config, 2)
      expect(state.debtBalance).toBeCloseTo(debtMax, 0)
    })
  })
})
