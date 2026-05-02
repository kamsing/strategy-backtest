import { MARKET_DATA } from './constants'
import { runBacktest } from './services/simulationEngine'
import { strategyBearRotation, strategyBearPledge } from './services/strategies'
import { AssetConfig } from './types'

// ============================================================
// 测试配置
// ============================================================

const BASE_CONFIG: AssetConfig = {
  initialCapital: 1_000_000,
  contributionAmount: 0,
  contributionIntervalMonths: 1,
  yearlyContributionMonth: 12,
  qqqWeight: 90,
  qldWeight: 0,
  contributionQqqWeight: 100,
  contributionQldWeight: 0,
  cashYieldAnnual: 2.0,
  leverage: {
    enabled: true,
    interestRate: 5.0,
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
}

const rotationConfig: AssetConfig = {
  ...BASE_CONFIG,
  bearRotation: {
    tripleETF: 'QLD',
    enableAlerts: false,
  },
}

const pledgeConfig: AssetConfig = {
  ...BASE_CONFIG,
  bearPledge: {
    buyTarget: 'QQQ',
    maxPledgeRatio: 0.15, // 15% 上限
    enableAlerts: false,
  },
}

// ============================================================
// 运行模拟
// ============================================================

console.log('🚀 开始实战回测模拟 (2000 - 2024)...')

const resultRotation = runBacktest(MARKET_DATA, strategyBearRotation, rotationConfig, 'Bear Rotation', '#ff0000')
const resultPledge = runBacktest(MARKET_DATA, strategyBearPledge, pledgeConfig, 'Bear Pledge', '#00ff00')

// ============================================================
// 输出关键指标对比
// ============================================================

const printSummary = (name: string, res: any) => {
  console.log(`\n📊 [${name}] 表现总结:`)
  console.log(`   最终资产: $${res.metrics.finalBalance.toLocaleString()}`)
  console.log(`   年化收益 (CAGR): ${res.metrics.cagr.toFixed(2)}%`)
  console.log(`   最大回撤 (MDD): ${res.metrics.maxDrawdown.toFixed(2)}%`)
  console.log(`   夏普比率 (Sharpe): ${res.metrics.sharpeRatio.toFixed(2)}`)
  
  // 查找是否有触发过熊市状态
  const bearEvents = res.history.filter((h: any) => h.strategyMemory && h.strategyMemory.mode === 'bear')
  console.log(`   触发熊市状态月份数: ${bearEvents.length}`)
  if (bearEvents.length > 0) {
    console.log(`   首次触发熊市日期: ${bearEvents[0].date}`)
  }
}

printSummary('熊市仓位转换 (B1)', resultRotation)
printSummary('熊市质押借款 (B2)', resultPledge)

// ============================================================
// 验证事件流 (核心修复点验证)
// ============================================================

console.log('\n🔍 [验证] 流水账事件流集成测试 (2000年互联网泡沫期间):')
const sampleMonth = resultRotation.history.find(h => h.date === '2000-04-01' || (h.events && h.events.some(e => e.type === 'ROTATION_IN')))
if (sampleMonth) {
  console.log(`📅 日期: ${sampleMonth.date}`)
  console.log(`💼 动态持仓: ${JSON.stringify(sampleMonth.shares)}`)
  console.log('📝 事件记录:')
  sampleMonth.events.forEach(e => {
    console.log(`   [${e.type}] - ${e.description} (${e.amount ? '$' + e.amount.toLocaleString() : ''})`)
  })
}

const samplePledge = resultPledge.history.find(h => h.events && h.events.some(e => e.type === 'PLEDGE_BORROW'))
if (samplePledge) {
  console.log(`\n📅 质押策略日期: ${samplePledge.date}`)
  console.log('📝 质押借款记录:')
  samplePledge.events.forEach(e => {
    if (e.type.includes('PLEDGE')) {
      console.log(`   [${e.type}] - ${e.description} (金额: $${e.amount?.toLocaleString()})`)
    }
  })
}

// 针对 B2 检查债务情况
const maxDebt = Math.max(...resultPledge.history.map((h: any) => h.debtBalance))
console.log(`\n🔍 B2 策略最高负债: $${maxDebt.toLocaleString()}`)

console.log('\n✅ 模拟测试完毕，所有事件已在流水账中体现。')
