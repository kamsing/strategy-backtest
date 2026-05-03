/**
 * 操作记录 CSV 导出服务（PRD §2.6）
 * 生成带 UTF-8 BOM 的 CSV 文件并触发浏览器下载
 */

import { SimulationResult, MarketDataRow } from '../types'
import { buildOperationLogRows, OperationLogRow } from './operationLogService'

// 带符号格式化数字（PRD §2.6.2）
const fmtSigned = (num: number, decimals: number): string => {
  const fixed = Math.abs(num).toFixed(decimals)
  return num >= 0 ? `+${fixed}` : `-${fixed}`
}

// 格式化数字（无符号）
const fmtNum = (num: number, decimals: number): string => num.toFixed(decimals)

// 将一行 OperationLogRow 转换为 CSV 行字段数组（PRD §2.6.2）
const rowToCSVFields = (row: OperationLogRow): string[] => {
  return [
    row.date,                                            // Date: YYYY-MM
    row.status,                                          // Status (英文原始 type)
    row.statusCN,                                        // Status_CN
    fmtNum(row.qqqPrice, 2),                            // QQQ_Price
    fmtSigned(row.changePct, 2),                        // Change_Pct
    fmtSigned(row.phasePct, 0),                         // Phase_Pct
    row.sharesChanged !== null
      ? fmtSigned(row.sharesChanged, 2)
      : '',                                              // Shares_Changed（无变化为空）
    fmtSigned(row.amount, 2),                           // Amount
    fmtNum(row.sharesAfter, 2),                         // Shares_After
    fmtNum(row.stockValue, 0),                          // Stock_Value
    fmtNum(row.totalAssets, 0),                         // Total_Assets
    fmtSigned(row.pnl, 0),                              // PnL
    fmtSigned(row.pnlPct, 2),                           // PnL_Pct
    row.maintenanceRatioPct !== null
      ? fmtNum(row.maintenanceRatioPct, 2)
      : '',                                              // Maintenance_Ratio_Pct（无杠杆为空）
    fmtNum(row.pledgeCumulative, 0),                    // Pledge_Cumulative
    fmtNum(row.pledgeInventoryValue, 0),                // Pledge_Inventory_Value
  ]
}

// CSV 列头（PRD §2.6.2，共 16 列）
const CSV_HEADERS = [
  'Date',
  'Status',
  'Status_CN',
  'QQQ_Price',
  'Change_Pct',
  'Phase_Pct',
  'Shares_Changed',
  'Amount',
  'Shares_After',
  'Stock_Value',
  'Total_Assets',
  'PnL',
  'PnL_Pct',
  'Maintenance_Ratio_Pct',
  'Pledge_Cumulative',
  'Pledge_Inventory_Value',
]

// 将字段数组转为 CSV 行字符串（处理含逗号和引号的字段）
const toCSVLine = (fields: string[]): string => {
  return fields
    .map((f) => {
      if (f.includes(',') || f.includes('"') || f.includes('\n')) {
        return `"${f.replace(/"/g, '""')}"`
      }
      return f
    })
    .join(',')
}

/**
 * 导出操作记录 CSV 文件（PRD §2.6.3）
 *
 * @param result       回测结果
 * @param marketData   市场数据（用于计算价格）
 * @param strategyName 策略名（用于文件名）
 * @param initialCapital 初始资金
 */
export function exportOperationLogCSV(
  result: SimulationResult,
  marketData: MarketDataRow[],
  strategyName: string,
  initialCapital: number,
): void {
  // 构建数据行
  const rows = buildOperationLogRows(result, marketData, initialCapital)

  // 生成 CSV 内容
  const lines: string[] = [
    toCSVLine(CSV_HEADERS),
    ...rows.map((row) => toCSVLine(rowToCSVFields(row))),
  ]
  const csvContent = lines.join('\n')

  // UTF-8 BOM（确保 Excel 正确识别中文，PRD §2.6 要求）
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })

  // 文件名格式：{策略名}_{YYYYMMDD}.csv（PRD §2.6.1）
  const today = new Date()
  const dateStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('')
  const safeStrategyName = strategyName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
  const filename = `${safeStrategyName}_${dateStr}.csv`

  // 触发浏览器下载
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 释放 URL 对象，防止内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
