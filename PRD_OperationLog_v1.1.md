# Strategy Backtest — 操作记录增强 & 市场周期状态系统
## PRD v1.1 · antigravity 开发团队内部文档

**基于版本**: OperationLog_PRD_v1.0.txt (2026-05-02)  
**本版本日期**: 2026-05-03  
**关联文件**: `FinancialReportModal.tsx` · `ResultsDashboard.tsx` · `types.ts` · `simulationEngine.ts` · `services/marketCycleService.ts`（新建）

---

## 目录

1. [变更摘要（相对 v1.0）](#1-变更摘要)
2. [功能 A：操作记录日期细化至每日](#2-功能-a操作记录日期细化至每日)
3. [功能 B：市场周期状态识别与图表色块标注](#3-功能-b市场周期状态识别与图表色块标注)
4. [功能 C：系统事件状态细化（市场阶段标签）](#4-功能-c系统事件状态细化市场阶段标签)
5. [类型扩展（types.ts）](#5-类型扩展typests)
6. [服务层新增（marketCycleService.ts）](#6-服务层新增marketcycleservicets)
7. [引擎层改动（simulationEngine.ts）](#7-引擎层改动simulationenginets)
8. [UI 层改动](#8-ui-层改动)
9. [测试用例](#9-测试用例)
10. [文件变更清单](#10-文件变更清单)
11. [交付里程碑](#11-交付里程碑)

---

## 1. 变更摘要

| # | 需求 | v1.0 现状 | v1.1 目标 |
|---|------|-----------|-----------|
| A | 操作记录日期粒度 | `YYYY-MM`（月度） | `YYYY-MM-DD`（每日） |
| B | 图表周期识别 | 无 | 识别高点/低点/修复/新周期，用色块区分 |
| C | 系统事件状态细化 | 仅显示「系统事件」 | 按跌幅/涨幅映射为具体市场阶段标签 |

---

## 2. 功能 A：操作记录日期细化至每日

### 2.1 背景

v1.0 中操作记录表的日期字段为 `YYYY-MM`，无法区分同月内多笔操作的先后顺序，也无法与实际日历对齐做二次分析。

### 2.2 数据源调整

当前 `MarketDataRow.date` 已存储 `YYYY-MM-DD` 格式，但 `PortfolioState.date` 在引擎月度迭代时被截断为月份字符串。

**改动点：**

- `simulationEngine.ts`：保留 `marketData[i].date` 的完整日期（`YYYY-MM-DD`）写入 `PortfolioState.date`，不再截断为 `YYYY-MM`
- 对于同月内多个 `FinancialEvent`，各事件的 `date` 字段按**执行顺序**标注日期，规则如下：

| 事件类型 | 日期取值规则 |
|----------|-------------|
| `DEPOSIT` / 定投入金 | 取该月第一个交易日 |
| `TRADE` / 买卖操作 | 取策略触发当日（即 `marketData.date`） |
| `INTEREST_EXP` / `INTEREST_INC` | 取该月最后一个交易日 |
| `INFO` / 系统事件 | 取触发条件成立当日 |
| `ROTATION_IN` / `ROTATION_OUT` | 取信号触发当日 |
| `PLEDGE_BORROW` / `PLEDGE_REPAY` | 取操作执行当日 |

### 2.3 FinancialEvent 接口扩展

```typescript
export interface FinancialEvent {
  // 原有字段...
  type: FinancialEventType
  amount?: number
  description: string
  ticker?: string
  phasePct?: number
  sharesChanged?: number

  // v1.1 新增
  date: string  // YYYY-MM-DD，精确到操作执行日，非可选
}
```

> **向下兼容**：已有事件若无精确日期，回退到 `PortfolioState.date`（月份首日）。

### 2.4 操作记录表 UI 改动

- 日期列宽由 80px 扩展至 **110px**，显示格式：`2024-03-15`
- 同月多行时，默认按日期升序排列（可点击列头切换）
- CSV 导出：`Date` 列输出 `YYYY-MM-DD`，新增 `Time` 列保留 `HH:MM`（若数据源有盘中时间）

---

## 3. 功能 B：市场周期状态识别与图表色块标注

### 3.1 背景与目标

用户需要在净值曲线图上直观看到市场所处的宏观周期阶段，以便验证策略在不同市场环境下的行为。需识别四种核心周期状态，并用不同颜色背景区块覆盖对应时间区间。

### 3.2 四种核心周期状态定义

| 周期状态 | 英文 Key | 定义逻辑 | 图表色块颜色 |
|----------|----------|----------|--------------|
| **周期高点** | `CYCLE_PEAK` | 过去 N 个月（默认 6）中的最高净值点，且此后出现超过 10% 的回撤 | `#fef08a`（黄色，低透明度 20%） |
| **下行阶段** | `CYCLE_DRAWDOWN` | 从高点持续下跌，跌幅 > 10% 且尚未回到前高 | `#fecaca`（红色，低透明度 20%） |
| **周期修复** | `CYCLE_RECOVERY` | 从低点开始反弹，已回升但尚未突破前高 | `#bbf7d0`（绿色，低透明度 20%） |
| **新周期开始** | `CYCLE_NEW_HIGH` | 净值突破前历史高点（All-Time High），确认新周期启动 | `#bfdbfe`（蓝色，低透明度 20%） |

> **说明**：每段时间区间只属于一种周期状态，状态之间无重叠。颜色使用 Tailwind 色板命名，透明度 `opacity-20`，不干扰折线可读性。

### 3.3 周期识别算法（marketCycleService.ts）

```typescript
export interface CycleSegment {
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
  type: CyclePhase    // 'CYCLE_PEAK' | 'CYCLE_DRAWDOWN' | 'CYCLE_RECOVERY' | 'CYCLE_NEW_HIGH'
  peakValue?: number  // 对应高点净值（用于 tooltip 展示）
  troughValue?: number // 对应低点净值
  drawdownPct?: number // 最大回撤%
}

export type CyclePhase = 'CYCLE_PEAK' | 'CYCLE_DRAWDOWN' | 'CYCLE_RECOVERY' | 'CYCLE_NEW_HIGH'
```

**识别逻辑伪代码：**

```
1. 遍历 history，维护滚动 ATH（All-Time High）
2. 当前值 < ATH × 0.90 → 进入 DRAWDOWN（若前一状态为 PEAK 或 NEW_HIGH）
3. 当前值 > trough × 1.10 且 < ATH → 进入 RECOVERY
4. 当前值 >= ATH → 打破前高，进入 NEW_HIGH，更新 ATH
5. 在 PEAK/NEW_HIGH 之间的平稳段（波动 < ±5%）标注为 CYCLE_PEAK
```

**关键参数（可在 constants.ts 配置）：**

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| `PEAK_CONFIRMATION_MONTHS` | 3 | 高点确认所需月数（防误判） |
| `DRAWDOWN_THRESHOLD` | 0.10 | 触发下行阶段的最小跌幅 |
| `RECOVERY_THRESHOLD` | 0.10 | 从低点反弹确认修复的最小涨幅 |
| `ATH_BUFFER` | 0.01 | 突破前高的容差（避免噪音） |

### 3.4 图表渲染（ResultsDashboard.tsx）

使用 Recharts `<ReferenceArea>` 组件渲染背景色块：

```tsx
{cycleSegments.map((seg, i) => (
  <ReferenceArea
    key={i}
    x1={seg.startDate}
    x2={seg.endDate}
    fill={CYCLE_COLORS[seg.type]}
    fillOpacity={0.2}
    ifOverflow="visible"
  />
))}
```

**颜色映射常量：**

```typescript
export const CYCLE_COLORS: Record<CyclePhase, string> = {
  CYCLE_PEAK:     '#fef08a',  // 黄
  CYCLE_DRAWDOWN: '#fecaca',  // 红
  CYCLE_RECOVERY: '#bbf7d0',  // 绿
  CYCLE_NEW_HIGH: '#bfdbfe',  // 蓝
}
```

### 3.5 图表图例扩展

在操作点标注图例下方新增周期色块图例一行（4个色块 + 文字）：

```
🟡 周期高点  🔴 下行阶段  🟢 周期修复  🔵 新周期开始
```

支持点击切换显示/隐藏，独立 `useState` 控制。

### 3.6 Tooltip 周期信息扩展

当鼠标悬停在 DRAWDOWN / RECOVERY 区间内时，Tooltip 底部追加：

```
📍 周期状态：下行阶段
   距前高回撤：-34.5%  |  距低点反弹：—
   本段起始：2022-01-03  |  已持续：18 个月
```

---

## 4. 功能 C：系统事件状态细化（市场阶段标签）

### 4.1 背景

v1.0 中所有非交易类事件统一显示为「系统事件（INFO）」红色徽章，信息密度低，用户无法判断该月市场处于何种状态。

### 4.2 市场阶段状态枚举

将 `FinancialEvent.type = 'INFO'` 细化为 `MarketPhaseLabel`，新增独立字段 `marketPhase`：

```typescript
export type MarketPhaseLabel =
  // ===== 下行阶段 =====
  | 'PHASE_INITIAL'        // 周期初始状态（建仓月）
  | 'PHASE_ALERT'          // 市场预警（跌幅 -5% ~ -9%）
  | 'PHASE_CORRECTION'     // 市场调整（跌幅 -10% ~ -19%）
  | 'PHASE_BEAR'           // 熊市（跌幅 -20% ~ -29%）
  | 'PHASE_FINANCIAL_CRISIS' // 金融海啸（跌幅 -30% ~ -39%）
  | 'PHASE_FINANCIAL_STORM'  // 金融风暴（跌幅 -40% ~ -49%）
  | 'PHASE_CATASTROPHE'    // 市场崩溃（跌幅 ≥ -50%）
  // ===== 上行阶段 =====
  | 'PHASE_STABILIZE'      // 企稳（从低点反弹 +5% ~ +9%）
  | 'PHASE_REBOUND'        // 技术反弹（+10% ~ +19%，低点起算）
  | 'PHASE_BULL'           // 牛市确认（+20% ~ +29%，低点起算）
  | 'PHASE_STRONG_BULL'    // 强势牛市（+30% ~ +49%，低点起算）
  | 'PHASE_NEW_ATH'        // 创历史新高（突破前高 ATH）
  | 'PHASE_EUPHORIA'       // 市场亢奋（创新高后继续上涨 +20% 以上）
  // ===== 中性状态 =====
  | 'PHASE_NORMAL'         // 正常运行（波动 ±5% 以内，无显著趋势）
  | 'PHASE_SIDEWAYS'       // 横盘整理（区间震荡超过 3 个月）
```

### 4.3 完整状态映射表

#### 4.3.1 下行阶段（以当前价格距最近 ATH 的跌幅计算）

| 状态标签 | `marketPhase` Key | 触发条件（距 ATH 跌幅） | 徽章文字 | 徽章颜色 | 行背景色 |
|----------|-------------------|------------------------|----------|----------|----------|
| 周期初始 | `PHASE_INITIAL` | 首月建仓 | 🟣 初始建仓 | `bg-purple-100 text-purple-800` | `bg-white` |
| 市场预警 | `PHASE_ALERT` | -5% ~ -9.99% | 🟠 市场预警 | `bg-orange-100 text-orange-800` | `bg-orange-50` |
| 市场调整 | `PHASE_CORRECTION` | -10% ~ -19.99% | 🟡 市场调整 | `bg-yellow-100 text-yellow-800` | `bg-yellow-50` |
| 熊市 | `PHASE_BEAR` | -20% ~ -29.99% | 🔴 熊市 | `bg-red-100 text-red-700` | `bg-red-50` |
| 金融海啸 | `PHASE_FINANCIAL_CRISIS` | -30% ~ -39.99% | 🔴 金融海啸 | `bg-red-200 text-red-800` | `bg-red-100` |
| 金融风暴 | `PHASE_FINANCIAL_STORM` | -40% ~ -49.99% | ⛔ 金融风暴 | `bg-red-300 text-red-900` | `bg-red-200` |
| 市场崩溃 | `PHASE_CATASTROPHE` | ≤ -50% | 💀 市场崩溃 | `bg-red-900 text-white` | `bg-red-300` |

#### 4.3.2 上行阶段（以距最近周期低点涨幅计算）

| 状态标签 | `marketPhase` Key | 触发条件（距低点涨幅） | 徽章文字 | 徽章颜色 | 行背景色 |
|----------|-------------------|----------------------|----------|----------|----------|
| 企稳 | `PHASE_STABILIZE` | +5% ~ +9.99% | 🟢 企稳 | `bg-green-100 text-green-700` | `bg-green-50` |
| 技术反弹 | `PHASE_REBOUND` | +10% ~ +19.99% | 🟢 技术反弹 | `bg-green-200 text-green-800` | `bg-green-50` |
| 牛市确认 | `PHASE_BULL` | +20% ~ +29.99% | 🐂 牛市 | `bg-emerald-100 text-emerald-800` | `bg-emerald-50` |
| 强势牛市 | `PHASE_STRONG_BULL` | +30% ~ +49.99% | 🐂 强势牛市 | `bg-emerald-200 text-emerald-900` | `bg-emerald-50` |
| 创历史新高 | `PHASE_NEW_ATH` | 突破前 ATH | 🏆 历史新高 | `bg-blue-100 text-blue-800` | `bg-blue-50` |
| 市场亢奋 | `PHASE_EUPHORIA` | ATH 后继续 +20% | 🚀 市场亢奋 | `bg-blue-200 text-blue-900` | `bg-blue-50` |

#### 4.3.3 中性状态

| 状态标签 | `marketPhase` Key | 触发条件 | 徽章文字 | 行背景色 |
|----------|-------------------|----------|----------|----------|
| 正常运行 | `PHASE_NORMAL` | 波动 ±5%，无显著趋势 | ⚪ 正常运行 | `bg-white` |
| 横盘整理 | `PHASE_SIDEWAYS` | 区间震荡持续 ≥ 3 个月 | ➡️ 横盘整理 | `bg-gray-50` |

### 4.4 通知触发规则

当状态**首次进入**以下阶段时，系统需触发用户通知（Toast / Push，取决于平台配置）：

| 触发阶段 | 通知内容 | 优先级 |
|----------|----------|--------|
| `PHASE_ALERT` | ⚠️ 市场下跌 5%，建议关注仓位 | 低 |
| `PHASE_CORRECTION` | ⚠️ 市场调整 -10%，策略信号观察期 | 中 |
| `PHASE_BEAR` | 🔴 进入熊市（-20%），请检查杠杆安全边际 | 高 |
| `PHASE_FINANCIAL_CRISIS` | 🚨 金融海啸级别（-30%），高风险预警 | 紧急 |
| `PHASE_FINANCIAL_STORM` | 🚨 金融风暴（-40%），检查爆仓风险 | 紧急 |
| `PHASE_CATASTROPHE` | 💀 市场崩溃（-50%+），请立即审查策略 | 紧急 |
| `PHASE_NEW_ATH` | 🏆 投资组合创历史新高！ | 低 |
| `PHASE_EUPHORIA` | 🚀 市场进入亢奋期，注意回调风险 | 中 |

> **实现说明**：通知仅在**状态首次进入**时触发，同一周期内不重复发送。使用 `strategyMemory.lastNotifiedPhase` 记录上次通知的阶段。

### 4.5 操作记录表 UI 改动

- **「状态」列**：对所有行（包括原「系统事件」行）追加 `marketPhase` 徽章，与操作类型徽章并排显示
- **「状态」列宽**：从 80px 扩展至 **140px**（容纳双徽章）
- **筛选控件**新增「市场阶段」下拉，选项来自 `MarketPhaseLabel` 枚举

**双徽章渲染示例：**

```
[🔴 金融海啸]  [卖出]    2022-06-15   -34.21%   ...
[⚪ 正常运行]  [定投买入] 2023-03-01   +2.17%    ...
[🏆 历史新高]  [系统事件] 2024-11-22   +1.88%    ...
```

---

## 5. 类型扩展（types.ts）

### 5.1 新增类型

```typescript
// v1.1 新增
export type MarketPhaseLabel =
  | 'PHASE_INITIAL' | 'PHASE_ALERT' | 'PHASE_CORRECTION'
  | 'PHASE_BEAR' | 'PHASE_FINANCIAL_CRISIS' | 'PHASE_FINANCIAL_STORM' | 'PHASE_CATASTROPHE'
  | 'PHASE_STABILIZE' | 'PHASE_REBOUND' | 'PHASE_BULL' | 'PHASE_STRONG_BULL'
  | 'PHASE_NEW_ATH' | 'PHASE_EUPHORIA'
  | 'PHASE_NORMAL' | 'PHASE_SIDEWAYS'

export type CyclePhase =
  | 'CYCLE_PEAK' | 'CYCLE_DRAWDOWN' | 'CYCLE_RECOVERY' | 'CYCLE_NEW_HIGH'

export interface CycleSegment {
  startDate: string
  endDate: string
  type: CyclePhase
  peakValue?: number
  troughValue?: number
  drawdownPct?: number
  recoveryPct?: number
}
```

### 5.2 现有类型增量扩展

```typescript
// FinancialEvent 新增字段（均为可选，向下兼容）
export interface FinancialEvent {
  // ...原有字段
  date: string            // v1.1 新增，YYYY-MM-DD 精确日期
  marketPhase?: MarketPhaseLabel  // v1.1 新增，该事件发生时的市场阶段
  drawdownFromAth?: number        // v1.1 新增，距 ATH 的跌幅（负数，如 -0.32 = -32%）
  recoveryFromTrough?: number     // v1.1 新增，距低点的涨幅（正数）
}

// PortfolioState 新增字段
export interface PortfolioState {
  // ...原有字段
  marketPhase: MarketPhaseLabel   // v1.1 新增（必填，默认 PHASE_NORMAL）
  cyclePhase: CyclePhase          // v1.1 新增（必填）
  drawdownFromAth: number         // v1.1 新增，当月距 ATH 跌幅
  ath: number                     // v1.1 新增，截至当月的历史最高净值
}
```

---

## 6. 服务层新增（marketCycleService.ts）

**文件路径**：`services/marketCycleService.ts`

### 6.1 导出函数

```typescript
/**
 * 从回测历史中识别市场周期分段
 * @param history - PortfolioState 数组（完整回测历史）
 * @returns CycleSegment 数组，按时间顺序排列
 */
export function detectCycleSegments(history: PortfolioState[]): CycleSegment[]

/**
 * 根据距 ATH 跌幅 / 距低点涨幅，计算当月市场阶段标签
 * @param drawdownFromAth - 负数，如 -0.32 表示距 ATH 下跌 32%
 * @param recoveryFromTrough - 正数，如 0.15 表示距低点上涨 15%
 * @param isFirstMonth - 是否为回测首月（用于标注 PHASE_INITIAL）
 * @param isSidewaysForMonths - 横盘持续月数
 */
export function resolveMarketPhase(
  drawdownFromAth: number,
  recoveryFromTrough: number,
  isFirstMonth: boolean,
  isSidewaysForMonths: number,
): MarketPhaseLabel

/**
 * 获取市场阶段对应的 UI 配置（徽章颜色、行背景色、文字）
 */
export function getMarketPhaseConfig(phase: MarketPhaseLabel): {
  label: string
  badgeClass: string
  rowBgClass: string
  emoji: string
}
```

### 6.2 实现要点

- `detectCycleSegments` 使用**单次遍历 O(n)**，维护 `ath`、`trough`、`currentPhase` 状态机
- 状态转换采用**确认机制**：高点需连续 `PEAK_CONFIRMATION_MONTHS` 个月无新高才确认；低点需反弹 `RECOVERY_THRESHOLD` 才确认
- 所有参数通过 `constants.ts` 导入，测试时可 mock

---

## 7. 引擎层改动（simulationEngine.ts）

### 7.1 月度迭代新增逻辑

在每月 `PortfolioState` 写入 history 前，补充以下计算：

```typescript
// 1. 更新 ATH
const currentAth = Math.max(prevState.ath ?? 0, currentState.totalValue)

// 2. 计算距 ATH 跌幅
const drawdownFromAth = currentAth > 0
  ? (currentState.totalValue / currentAth) - 1
  : 0

// 3. 计算距低点涨幅（需维护 trough）
const trough = currentState.strategyMemory.cycleTrough as number ?? currentState.totalValue
const recoveryFromTrough = trough > 0
  ? (currentState.totalValue / trough) - 1
  : 0

// 4. 计算横盘持续月数
const sidewaysMonths = resolveSidewaysMonths(history, monthIndex)

// 5. 解析市场阶段
const marketPhase = resolveMarketPhase(drawdownFromAth, recoveryFromTrough, monthIndex === 0, sidewaysMonths)

// 6. 解析周期阶段
const cyclePhase = resolveCyclePhase(drawdownFromAth, recoveryFromTrough, currentAth, currentState.totalValue)

// 7. 写入 state
currentState.ath = currentAth
currentState.drawdownFromAth = drawdownFromAth
currentState.marketPhase = marketPhase
currentState.cyclePhase = cyclePhase
```

### 7.2 事件 date 字段注入

在所有 `monthEvents.push(...)` 处注入 `date: marketData.date`（完整 `YYYY-MM-DD`）。

---

## 8. UI 层改动

### 8.1 FinancialReportModal.tsx

| 改动点 | 详情 |
|--------|------|
| 日期列宽 | 80px → 110px，显示 `YYYY-MM-DD` |
| 状态列宽 | 80px → 140px，渲染双徽章 |
| 筛选「市场阶段」 | 新增下拉，枚举值来自 `MarketPhaseLabel` |
| 行背景色 | 优先级：`marketPhase` 背景色 > 事件类型背景色 |

### 8.2 ResultsDashboard.tsx

| 改动点 | 详情 |
|--------|------|
| `ReferenceArea` 色块 | 按 `cycleSegments` 渲染4种周期背景色块 |
| 图例扩展 | 周期色块图例独立一行，可点击切换显示 |
| Tooltip 扩展 | 显示当前周期阶段、距 ATH 跌幅、持续时长 |
| 「显示周期」总开关 | 独立 Toggle，不影响操作点标注 |

---

## 9. 测试用例

### TC-A01：日期精确到日验证

| 属性 | 内容 |
|------|------|
| 测试目标 | 同月内多笔操作（定投 + TRADE）的 `date` 字段不同 |
| 验证方式 | 检查同月 `events` 中 `DEPOSIT` 日期 < `TRADE` 日期 |
| 期望格式 | `2024-03-01`（定投）vs `2024-03-15`（交易触发日） |

### TC-A02：CSV 日期格式

| 属性 | 内容 |
|------|------|
| 测试目标 | CSV 导出后 `Date` 列为 `YYYY-MM-DD` 格式，非 `YYYY-MM` |
| 验证方式 | 解析 CSV 首数据行，正则匹配 `/^\d{4}-\d{2}-\d{2}$/` |

### TC-B01：周期分段识别基准

| 属性 | 内容 |
|------|------|
| 测试目标 | 用 2020-2023 QQQ 历史数据验证周期分段正确 |
| 期望结果 | 2022-01 ~ 2022-10 识别为 `CYCLE_DRAWDOWN`（纳指熊市）；2023-01 之后识别为 `CYCLE_RECOVERY` |
| 允许误差 | 起止日期偏差 ≤ 2 个月 |

### TC-B02：图表色块不重叠

| 属性 | 内容 |
|------|------|
| 测试目标 | `cycleSegments` 数组中相邻 segment 的 `endDate` = 下一个 `startDate` |
| 验证方式 | 单元测试遍历 `detectCycleSegments()` 输出，断言无 gap 无重叠 |

### TC-C01：市场阶段标签映射

| 跌幅输入 | 期望 `marketPhase` |
|----------|--------------------|
| -0.03 | `PHASE_NORMAL` |
| -0.07 | `PHASE_ALERT` |
| -0.15 | `PHASE_CORRECTION` |
| -0.25 | `PHASE_BEAR` |
| -0.35 | `PHASE_FINANCIAL_CRISIS` |
| -0.45 | `PHASE_FINANCIAL_STORM` |
| -0.55 | `PHASE_CATASTROPHE` |

### TC-C02：上行阶段标签映射

| 距低点涨幅 | 同时条件 | 期望 `marketPhase` |
|------------|----------|---------------------|
| +0.07 | 未回到 ATH | `PHASE_STABILIZE` |
| +0.15 | 未回到 ATH | `PHASE_REBOUND` |
| +0.25 | 未回到 ATH | `PHASE_BULL` |
| 突破 ATH | — | `PHASE_NEW_ATH` |
| ATH 后 +0.22 | — | `PHASE_EUPHORIA` |

### TC-C03：通知不重复触发

| 属性 | 内容 |
|------|------|
| 测试目标 | 同一周期内跌幅在 -20% 附近反复波动时，`PHASE_BEAR` 通知仅触发一次 |
| 验证方式 | Mock 通知函数，断言调用次数 = 1 |

---

## 10. 文件变更清单

| 文件路径 | 变更类型 | v1.1 变更内容 |
|----------|----------|---------------|
| `types.ts` | 修改 | 新增 `MarketPhaseLabel`、`CyclePhase`、`CycleSegment` 类型；`FinancialEvent` 新增 `date`、`marketPhase`、`drawdownFromAth`、`recoveryFromTrough`；`PortfolioState` 新增 `marketPhase`、`cyclePhase`、`drawdownFromAth`、`ath` |
| `constants.ts` | 修改 | 新增周期识别参数：`PEAK_CONFIRMATION_MONTHS`、`DRAWDOWN_THRESHOLD`、`RECOVERY_THRESHOLD`、`ATH_BUFFER` |
| `services/marketCycleService.ts` | **新建** | `detectCycleSegments()`、`resolveMarketPhase()`、`getMarketPhaseConfig()` |
| `services/simulationEngine.ts` | 修改 | 月度迭代补充 ATH/drawdown/marketPhase 计算；事件注入精确 `date` 字段 |
| `services/operationLogService.ts` | 修改（来自 v1.0） | `OperationLogRow` 新增 `marketPhase`、`drawdownFromAth`、`recoveryFromTrough` 字段；日期输出改为 `YYYY-MM-DD` |
| `services/operationLogExport.ts` | 修改（来自 v1.0） | CSV `Date` 列改为 `YYYY-MM-DD`；新增 `Market_Phase` 和 `Drawdown_From_ATH_Pct` 列 |
| `components/FinancialReportModal.tsx` | 修改 | 日期列宽扩展；状态列改为双徽章；新增「市场阶段」筛选下拉 |
| `components/ResultsDashboard.tsx` | 修改 | 新增 `ReferenceArea` 周期色块；图例扩展；Tooltip 周期信息；周期显示 Toggle |
| `services/__tests__/marketCycleService.test.ts` | **新建** | TC-B01、TC-B02、TC-C01、TC-C02、TC-C03 |
| `services/__tests__/simulationEngine.test.ts` | 修改 | TC-A01 验证日期注入正确 |
| `e2e/operation_log.spec.ts` | 修改（来自 v1.0） | TC-A02 CSV 日期格式 E2E 验证 |

---

## 11. 交付里程碑

| 阶段 | 目标 | 关键交付物 | 参考工期 |
|------|------|------------|----------|
| **M1** | 类型层 + 常量 | `types.ts` 全量更新；`constants.ts` 周期参数；无破坏性变更 | 0.5 天 |
| **M2** | marketCycleService | `marketCycleService.ts` 完整实现；单元测试 TC-B01~B02、TC-C01~C03 全通过 | 1.5 天 |
| **M3** | 引擎层注入 | `simulationEngine.ts` 完成 ATH/marketPhase 计算注入；TC-A01 通过 | 1 天 |
| **M4** | 操作记录 UI | 日期列/状态列更新；市场阶段筛选；`operationLogService` & `Export` 更新；TC-A02 通过 | 1.5 天 |
| **M5** | 图表周期色块 | `ReferenceArea` 渲染；图例；Tooltip；周期 Toggle；TC-B01 视觉验证 | 1.5 天 |
| **M6** | 通知系统 | 状态首次进入时触发通知；TC-C03 通过；E2E 全套通过 | 1 天 |

**合计预估工期：约 7 个工作日**

---

*Strategy Backtest · PRD v1.1 — 日期细化 & 周期识别 & 市场阶段状态系统 · 仅供 antigravity 开发团队内部使用*
