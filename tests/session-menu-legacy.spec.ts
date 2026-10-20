/**
 * 老线菜单注入臂纯叶断言：resolveLabels 语言前缀挑字典+回退、
 * extractSessionIdFromFiber 沿 fiber .return 取 node.id（含 treeitem 定位、
 * 键前缀兼容、找不到放弃）、hasStewardDelete dedup 判定。
 * DOM 装配（MutationObserver/点击）不在本套件（依赖真实浏览器渲染，真机验）。
 */
import { describe, expect, it } from 'vitest'
import {
  extractSessionIdFromFiber, hasStewardDelete, hideSidebarRowsFor, resolveLabels, STEWARD_MENU_DELETE_ATTR,
} from '../src/client/session-menu-legacy.ts'

/** 造一个带 fiber 键的 treeitem 行对象（closest 返回自身）；跨用例共享引用。 */
let fakeRowSelf: Record<string, unknown>

function fiberRow(leaf: unknown): Record<string, unknown> {
  fakeRowSelf = { __reactFiber$abc: leaf, closest: () => fakeRowSelf }
  return fakeRowSelf
}

describe('resolveLabels', () => {
  it('zh 缺省给出中文删除/确认文案', () => {
    const l = resolveLabels('zh-CN')
    expect(l.delete).toBe('删除会话')
    expect(l.confirm).toBe('确认删除')
  })
  it('en 前缀命中英文；未知语言回退 zh', () => {
    expect(resolveLabels('en-US').delete).toBe('Delete session')
    expect(resolveLabels('zz-ZZ').delete).toBe('删除会话')
    expect(resolveLabels(undefined).delete).toBe('删除会话')
  })
})

describe('extractSessionIdFromFiber', () => {
  it('沿 .return 链找到 memoizedProps.node.id', () => {
    const leaf = { memoizedProps: { className: 'x' }, return: { memoizedProps: { node: { id: 'session-abc' } }, return: null } }
    expect(extractSessionIdFromFiber(fiberRow(leaf))).toBe('session-abc')
  })
  it('row.id 形也认', () => {
    const leaf = { memoizedProps: { row: { id: 'session-xyz' } }, return: null }
    expect(extractSessionIdFromFiber(fiberRow(leaf))).toBe('session-xyz')
  })
  it('非 treeitem 行（closest 返回 null）→ undefined', () => {
    const el = { closest: () => null }
    expect(extractSessionIdFromFiber(el)).toBeUndefined()
  })
  it('无 fiber 键 → undefined（不抛）', () => {
    fakeRowSelf = { closest: () => fakeRowSelf }
    expect(extractSessionIdFromFiber(fakeRowSelf)).toBeUndefined()
  })
  it('链上无 id → undefined', () => {
    const leaf = { memoizedProps: { node: {} }, return: { memoizedProps: { other: 1 }, return: null } }
    expect(extractSessionIdFromFiber(fiberRow(leaf))).toBeUndefined()
  })
  it('React16 __reactInternalInstance$ 前缀也认', () => {
    const leaf = { memoizedProps: { node: { id: 'session-old' } }, return: null }
    fakeRowSelf = { __reactInternalInstance$zzz: leaf, closest: () => fakeRowSelf }
    expect(extractSessionIdFromFiber(fakeRowSelf)).toBe('session-old')
  })
})

describe('hasStewardDelete', () => {
  it('querySelector 命中标记 → true', () => {
    expect(hasStewardDelete({ querySelector: (s) => (s.includes(STEWARD_MENU_DELETE_ATTR) ? {} : null) })).toBe(true)
  })
  it('未命中 / null / 无 querySelector → false', () => {
    expect(hasStewardDelete({ querySelector: () => null })).toBe(false)
    expect(hasStewardDelete(null)).toBe(false)
    expect(hasStewardDelete({})).toBe(false)
  })
})

describe('hideSidebarRowsFor', () => {
  /** 造一个带 fiber node.id 的侧栏行（display 可写）。 */
  function rowWith(id: string | undefined): { style: { display: string }; __reactFiber$a: unknown; closest: () => unknown } {
    const leaf = { memoizedProps: id === undefined ? {} : { node: { id } }, return: null }
    const row: { style: { display: string }; [k: string]: unknown } = { style: { display: '' }, __reactFiber$a: leaf }
    row.closest = () => row
    return row as never
  }
  function fakeDoc(rows: ReturnType<typeof rowWith>[]): Document {
    return { querySelectorAll: () => rows } as unknown as Document
  }
  it('隐藏 id 匹配的行、返回条数；不匹配不动', () => {
    const a = rowWith('session-1')
    const b = rowWith('session-2')
    const n = hideSidebarRowsFor(fakeDoc([a, b]), 'session-1')
    expect(n).toBe(1)
    expect(a.style.display).toBe('none')
    expect(b.style.display).toBe('')
  })
  it('空 sessionId → 0 且不动任何行', () => {
    const a = rowWith('session-1')
    expect(hideSidebarRowsFor(fakeDoc([a]), '')).toBe(0)
    expect(a.style.display).toBe('')
  })
  it('多行同 id 全隐', () => {
    const a = rowWith('session-x')
    const b = rowWith('session-x')
    expect(hideSidebarRowsFor(fakeDoc([a, b]), 'session-x')).toBe(2)
  })
})
