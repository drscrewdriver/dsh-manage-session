/**
 * `resolveColumns` 契约：6 档设置 × 3 个宽度断点 = 18 组合全覆盖。
 */
import { describe, expect, it } from 'vitest'
import {
  COLUMN_CHOICES,
  DEFAULT_COLUMNS,
  MEDIUM_BREAKPOINT,
  NARROW_BREAKPOINT,
  normalizeColumns,
  resolveColumns,
} from '../src/client/columns.ts'

describe('normalizeColumns', () => {
  it('1-6 原样通过', () => {
    for (const n of COLUMN_CHOICES) expect(normalizeColumns(n)).toBe(n)
  })

  it('非法值收敛到缺省 3', () => {
    for (const bad of [0, 7, -1, 3.4, Number.NaN, 'x', null, undefined, {}, []]) {
      expect(normalizeColumns(bad)).toBe(DEFAULT_COLUMNS)
    }
    // 字符串数字可接受（设置文件可能存成字符串）
    expect(normalizeColumns('5')).toBe(5)
    // 小数四舍五入后合法则采用
    expect(normalizeColumns(2.4)).toBe(2)
  })
})

describe('resolveColumns：6 档 × 3 断点', () => {
  const wideWidths = [MEDIUM_BREAKPOINT, MEDIUM_BREAKPOINT + 400]
  const mediumWidths = [NARROW_BREAKPOINT, MEDIUM_BREAKPOINT - 1]
  const narrowWidths = [320, NARROW_BREAKPOINT - 1]

  it('宽屏（>=1180）：设置值原样生效', () => {
    for (const setting of COLUMN_CHOICES) {
      for (const width of wideWidths) {
        expect(resolveColumns(setting, width)).toBe(setting)
      }
    }
  })

  it('中屏（760..1179）：最多 2 列', () => {
    for (const setting of COLUMN_CHOICES) {
      for (const width of mediumWidths) {
        expect(resolveColumns(setting, width)).toBe(Math.min(setting, 2))
      }
    }
  })

  it('窄屏（<760）：强制 1 列，设置值不生效', () => {
    for (const setting of COLUMN_CHOICES) {
      for (const width of narrowWidths) {
        expect(resolveColumns(setting, width)).toBe(1)
      }
    }
  })

  it('宽度未知（非有限数 / 0）时采信设置值', () => {
    for (const setting of COLUMN_CHOICES) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -100]) {
        expect(resolveColumns(setting, bad)).toBe(setting)
      }
    }
  })

  it('设置值非法时按缺省 3 叠加断点裁决', () => {
    expect(resolveColumns(99, 2000)).toBe(DEFAULT_COLUMNS)
    expect(resolveColumns(99, 900)).toBe(2)
    expect(resolveColumns(99, 500)).toBe(1)
  })
})
