/**
 * 移动均线（SMA）计算工具
 * PRD A3：支持 20M/50M/200M 均线
 */

/**
 * 计算简单移动平均线（SMA）
 * @param data - 价格数组（按时间顺序）
 * @param period - 均线周期（如 20、50、200）
 * @returns (number | null)[] - 每个时间点对应的 SMA 值，数据不足时返回 null
 */
export const calculateSMA = (data: number[], period: number): (number | null)[] => {
  if (period <= 0) return data.map(() => null)

  return data.map((_, index) => {
    // 数据不足时返回 null（图例置灰）
    if (index + 1 < period) return null

    const slice = data.slice(index - period + 1, index + 1)
    const sum = slice.reduce((a, b) => a + b, 0)
    return sum / period
  })
}

/**
 * 检测均线金叉（短期均线由下穿上突破长期均线）
 * @param shortSMA - 短期均线数组（如 20M SMA）
 * @param longSMA - 长期均线数组（如 50M SMA）
 * @param index - 当前时间点索引
 * @returns true 表示在 index 处发生金叉
 */
export const detectGoldenCross = (
  shortSMA: (number | null)[],
  longSMA: (number | null)[],
  index: number,
): boolean => {
  if (index < 1) return false
  const prevShort = shortSMA[index - 1]
  const prevLong = longSMA[index - 1]
  const currShort = shortSMA[index]
  const currLong = longSMA[index]

  if (prevShort === null || prevLong === null || currShort === null || currLong === null) return false

  // 金叉：上一期短期 <= 长期，本期短期 > 长期
  return prevShort <= prevLong && currShort > currLong
}

/**
 * 检测均线死叉（短期均线由上穿下跌破长期均线）
 * @param shortSMA - 短期均线数组
 * @param longSMA - 长期均线数组
 * @param index - 当前时间点索引
 * @returns true 表示在 index 处发生死叉
 */
export const detectDeathCross = (
  shortSMA: (number | null)[],
  longSMA: (number | null)[],
  index: number,
): boolean => {
  if (index < 1) return false
  const prevShort = shortSMA[index - 1]
  const prevLong = longSMA[index - 1]
  const currShort = shortSMA[index]
  const currLong = longSMA[index]

  if (prevShort === null || prevLong === null || currShort === null || currLong === null) return false

  // 死叉：上一期短期 >= 长期，本期短期 < 长期
  return prevShort >= prevLong && currShort < currLong
}

/**
 * 检测价格是否首次从 MA 下方回升到 MA 上方
 * @param prices - 价格数组
 * @param ma - 均线数组
 * @param index - 当前时间点索引
 * @returns true 表示当期首次回升穿越均线
 */
export const detectMACrossover = (
  prices: number[],
  ma: (number | null)[],
  index: number,
): boolean => {
  if (index < 1) return false
  const prevPrice = prices[index - 1]
  const currPrice = prices[index]
  const prevMA = ma[index - 1]
  const currMA = ma[index]

  if (prevMA === null || currMA === null) return false

  // 上一期价格 <= 均线，本期价格 > 均线
  return prevPrice <= prevMA && currPrice > currMA
}
