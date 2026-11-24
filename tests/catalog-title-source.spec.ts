/**
 * 零 I/O 标题解析（Tier 0 / Tier 1）与进程内 memo 的回归。
 *
 * 钉住三件事：
 * 1. 优先级 live > cache > 缓存文件 > pending（与宿主侧栏 / `@` 补全同源）；
 * 2. 服务缺席或 `get()` 抛错时只降级该档，**不炸整表**（兼容区间内三服务全可选）；
 * 3. memo 只缓存已定论结论：`live` 永不入 memo，`none` 负结论要能被清理失效。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_TITLE_MEMO_TTL_MS,
  TitleMemo,
  resolveTitlesFromProjections,
  titleFromProjectionCacheFile,
  type CatalogCtxFace,
  type CatalogTitleRecord,
} from '../src/host/catalog/title-source.ts'

const record = (id: string): CatalogTitleRecord => ({ id, header: { id } })

/** 造一个只有指定服务的假上下文。 */
function fakeCtx(services: Record<string, unknown | (() => never)>): CatalogCtxFace {
  return {
    get: (name: string) => {
      const value = services[name]
      if (typeof value === 'function') return (value as () => never)()
      return value
    },
  }
}

describe('resolveTitlesFromProjections：三级优先级', () => {
  it('活跃会话取实时投影（live 压过 cache）', () => {
    const ctx = fakeCtx({
      sessions: { get: () => ({ id: 'session-a' }) },
      sessionProjections: { snapshot: () => ({ values: { title: 'live title' } }) },
      sessionProjectionCache: { cachedSnapshot: () => ({ values: { title: 'cached title' } }) },
    })
    const resolved = resolveTitlesFromProjections(ctx, [record('session-a')], tmpdir())
    expect(resolved.titles.get('session-a')).toEqual({ title: 'live title', source: 'live' })
    expect(resolved.pending).toHaveLength(0)
  })

  it('冷会话取 checkpoint 快照（零 I/O）', () => {
    const ctx = fakeCtx({
      sessions: { get: () => undefined },
      sessionProjections: { snapshot: () => ({ values: { title: 'should not be used' } }) },
      sessionProjectionCache: { cachedSnapshot: () => ({ values: { title: 'cached title' } }) },
    })
    const resolved = resolveTitlesFromProjections(ctx, [record('session-b')], tmpdir())
    expect(resolved.titles.get('session-b')).toEqual({ title: 'cached title', source: 'cache' })
  })

  it('三级都没命中 → pending（由分帧流补齐）', () => {
    const ctx = fakeCtx({
      sessions: { get: () => undefined },
      sessionProjectionCache: { cachedSnapshot: () => undefined },
    })
    const resolved = resolveTitlesFromProjections(ctx, [record('session-c')], tmpdir())
    expect(resolved.titles.size).toBe(0)
    expect(resolved.pending.map(item => item.id)).toEqual(['session-c'])
  })

  it('空标题（空串/空白）不算命中', () => {
    const ctx = fakeCtx({ sessionProjectionCache: { cachedSnapshot: () => ({ values: { title: '   ' } }) } })
    const resolved = resolveTitlesFromProjections(ctx, [record('session-d')], tmpdir())
    expect(resolved.titles.size).toBe(0)
    expect(resolved.pending).toHaveLength(1)
  })

  it('三个服务全缺席时全部落 pending，不抛错', () => {
    const resolved = resolveTitlesFromProjections(fakeCtx({}), [record('session-e'), record('im:union:feishu:dm:x')], tmpdir())
    expect(resolved.titles.size).toBe(0)
    expect(resolved.pending).toHaveLength(2)
  })

  it('服务 get()/snapshot() 抛错只降级该条，不影响其余', () => {
    const ctx = fakeCtx({
      sessions: () => { throw new Error('sessions 服务炸了') },
      sessionProjections: { snapshot: () => { throw new Error('snapshot 炸了') } },
      sessionProjectionCache: {
        cachedSnapshot: (header: unknown) => {
          const id = (header as { id: string }).id
          if (id === 'session-bad') throw new Error('这条缓存坏了')
          return { values: { title: `title of ${id}` } }
        },
      },
    })
    const resolved = resolveTitlesFromProjections(ctx, [record('session-bad'), record('session-ok')], tmpdir())
    expect(resolved.pending.map(item => item.id)).toEqual(['session-bad'])
    expect(resolved.titles.get('session-ok')).toEqual({ title: 'title of session-ok', source: 'cache' })
  })

  it('缓存服务缺席时回退读逐条缓存文件（两种文件名都试）', () => {
    const home = mkdtempSync(join(tmpdir(), 'steward-title-file-'))
    const dir = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(dir, { recursive: true })
    // catalog 的 id 带 session- 前缀，缓存文件名不带 —— 归一化后必须命中。
    writeFileSync(join(dir, 'abc123.json'), JSON.stringify({ record: { rows: { title: { val: 'file title' } } } }))
    const resolved = resolveTitlesFromProjections(fakeCtx({}), [record('session-abc123')], home)
    expect(resolved.titles.get('session-abc123')).toEqual({ title: 'file title', source: 'cache' })
    expect(titleFromProjectionCacheFile('session-abc123', home)).toBe('file title')
  })
})

describe('TitleMemo：只缓存已定论的结论', () => {
  it('live 不入 memo（活跃会话标题必须每次重取）', () => {
    const memo = new TitleMemo()
    memo.set('session-a', 'live title', 'live')
    expect(memo.get('session-a')).toBeUndefined()
    expect(memo.size).toBe(0)
  })

  it('cache / prefix / none 入 memo，且按 TTL 过期', () => {
    let clock = 1_000
    const memo = new TitleMemo(CATALOG_TITLE_MEMO_TTL_MS, () => clock)
    memo.set('session-a', 'cached', 'cache')
    memo.set('session-b', undefined, 'none')
    expect(memo.get('session-a')).toEqual({ title: 'cached', source: 'cache', expiresAt: 1_000 + CATALOG_TITLE_MEMO_TTL_MS })
    expect(memo.get('session-b')?.title).toBe('')
    clock += CATALOG_TITLE_MEMO_TTL_MS + 1
    expect(memo.get('session-a')).toBeUndefined()
    // 过期条目按需清理：session-a 刚被 get 探掉，session-b 尚未被探。
    expect(memo.size).toBe(1)
    expect(memo.get('session-b')).toBeUndefined()
    expect(memo.size).toBe(0)
  })

  it('invalidate / invalidateAll 立即生效', () => {
    const memo = new TitleMemo()
    memo.set('session-a', 'a', 'cache')
    memo.set('session-b', 'b', 'cache')
    memo.set('session-c', 'c', 'cache')
    memo.invalidate(['session-a'])
    expect(memo.get('session-a')).toBeUndefined()
    memo.invalidateAll()
    expect(memo.size).toBe(0)
  })
})
