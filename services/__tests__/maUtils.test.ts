import { describe, it, expect } from 'vitest'
import { calculateSMA, detectGoldenCross, detectDeathCross, detectMACrossover } from '../maUtils'

describe('maUtils - 移动均线工具函数', () => {
  describe('calculateSMA - 基础计算', () => {
    it('应该正确计算 3 期 SMA', () => {
      const data = [10, 20, 30, 40, 50]
      const sma = calculateSMA(data, 3)
      expect(sma[0]).toBeNull() // 数据不足
      expect(sma[1]).toBeNull() // 数据不足
      expect(sma[2]).toBeCloseTo(20) // (10+20+30)/3
      expect(sma[3]).toBeCloseTo(30) // (20+30+40)/3
      expect(sma[4]).toBeCloseTo(40) // (30+40+50)/3
    })

    it('数据不足周期时应返回 null', () => {
      const data = [100, 200]
      const sma = calculateSMA(data, 5)
      expect(sma[0]).toBeNull()
      expect(sma[1]).toBeNull()
    })

    it('单期数据应该等于自身', () => {
      const data = [42, 100, 55]
      const sma = calculateSMA(data, 1)
      expect(sma[0]).toBeCloseTo(42)
      expect(sma[1]).toBeCloseTo(100)
      expect(sma[2]).toBeCloseTo(55)
    })

    it('period <= 0 时应返回全 null', () => {
      const data = [1, 2, 3]
      const sma = calculateSMA(data, 0)
      expect(sma.every((v) => v === null)).toBe(true)
    })

    it('20 期 SMA 前19个应为 null', () => {
      const data = Array.from({ length: 25 }, (_, i) => (i + 1) * 10)
      const sma = calculateSMA(data, 20)
      for (let i = 0; i < 19; i++) {
        expect(sma[i]).toBeNull()
      }
      // 第20个：(10+20+...+200)/20 = 105
      expect(sma[19]).toBeCloseTo(105)
    })
  })

  describe('detectGoldenCross - 金叉检测', () => {
    it('应该检测到金叉（短期由下穿上）', () => {
      // shortSMA: [8, 12], longSMA: [10, 10]
      // 前一期: 8 < 10，当期: 12 > 10 → 金叉
      const shortSMA: (number | null)[] = [8, 12]
      const longSMA: (number | null)[] = [10, 10]
      expect(detectGoldenCross(shortSMA, longSMA, 1)).toBe(true)
    })

    it('无金叉时应返回 false（均线平行）', () => {
      const shortSMA: (number | null)[] = [12, 14]
      const longSMA: (number | null)[] = [10, 10]
      expect(detectGoldenCross(shortSMA, longSMA, 1)).toBe(false)
    })

    it('数据为 null 时应返回 false', () => {
      const shortSMA: (number | null)[] = [null, 12]
      const longSMA: (number | null)[] = [10, 10]
      expect(detectGoldenCross(shortSMA, longSMA, 1)).toBe(false)
    })

    it('index=0 时应返回 false', () => {
      const shortSMA: (number | null)[] = [12]
      const longSMA: (number | null)[] = [10]
      expect(detectGoldenCross(shortSMA, longSMA, 0)).toBe(false)
    })
  })

  describe('detectDeathCross - 死叉检测', () => {
    it('应该检测到死叉（短期由上穿下）', () => {
      // 前一期: 12 > 10，当期: 8 < 10 → 死叉
      const shortSMA: (number | null)[] = [12, 8]
      const longSMA: (number | null)[] = [10, 10]
      expect(detectDeathCross(shortSMA, longSMA, 1)).toBe(true)
    })

    it('无死叉时应返回 false', () => {
      const shortSMA: (number | null)[] = [8, 6]
      const longSMA: (number | null)[] = [10, 10]
      expect(detectDeathCross(shortSMA, longSMA, 1)).toBe(false)
    })
  })

  describe('detectMACrossover - 价格穿越均线', () => {
    it('应该检测到价格从下穿越均线上方', () => {
      const prices = [90, 110]
      const ma: (number | null)[] = [100, 100]
      expect(detectMACrossover(prices, ma, 1)).toBe(true)
    })

    it('价格一直在均线上方不应触发', () => {
      const prices = [110, 120]
      const ma: (number | null)[] = [100, 100]
      expect(detectMACrossover(prices, ma, 1)).toBe(false)
    })

    it('index=0 时应返回 false', () => {
      const prices = [110]
      const ma: (number | null)[] = [100]
      expect(detectMACrossover(prices, ma, 0)).toBe(false)
    })
  })
})
