/**
 * 列布局求解（纯函数）。
 *
 * 设置里存的是「用户希望的每行个数」1–6；窗口宽度可能装不下，所以真正用的列数
 * 由本函数裁决：窄屏一律降到 1 列，中等宽度最多 2 列。
 *
 * 为什么要 JS 算而不是纯 CSS：`grid-template-columns: repeat(...)` 的重复次数
 * **必须是整数**，写不成 `repeat(min(var(--cols),2), …)`。CSS 只吃算好的结果。
 */

/** 用户可选的每行个数。 */
export const COLUMN_CHOICES = [1, 2, 3, 4, 5, 6] as const
export type ColumnChoice = (typeof COLUMN_CHOICES)[number]

/** 缺省列数（保持升级前的观感）。 */
export const DEFAULT_COLUMNS: ColumnChoice = 3

/** 断点：低于该宽度强制 1 列。 */
export const NARROW_BREAKPOINT = 760
/** 断点：低于该宽度最多 2 列。 */
export const MEDIUM_BREAKPOINT = 1180

/** 把任意输入收敛成合法档位（设置文件可能被手改/来自旧版）。 */
export function normalizeColumns(value: unknown): ColumnChoice {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_COLUMNS
  const rounded = Math.round(n)
  return (COLUMN_CHOICES as readonly number[]).includes(rounded) ? (rounded as ColumnChoice) : DEFAULT_COLUMNS
}

/**
 * 求有效列数。
 * @param setting - 设置里的每行个数（非法值按缺省 3 处理）。
 * @param width - 容器宽度（px）；非有限值视为「未知」，直接采信设置值。
 * @returns 1–6 的有效列数。
 */
export function resolveColumns(setting: unknown, width: number): ColumnChoice {
  const wanted = normalizeColumns(setting)
  if (!Number.isFinite(width) || width <= 0) return wanted
  if (width < NARROW_BREAKPOINT) return 1
  if (width < MEDIUM_BREAKPOINT) return Math.min(wanted, 2) as ColumnChoice
  return wanted
}
