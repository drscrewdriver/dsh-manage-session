import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleMethod, type StewardRuntime } from '../src/index.ts'
import {
  appendTombstoneRecords,
  latestTombstones,
  tombstonePathFor,
} from '../src/host/history/tombstones.ts'

/**
 * 删除链路契约：先归档 → detach 活会话 → 删盘 → **落盘墓碑（deleted / pending-cleanup）**
 * → catalog 过滤 + 冷复用探针。
 *
 * 三条防复发不变量：
 * 1. 删干净（`deleted`）→ 重启后仍然隐藏（不靠进程内 Set）；
 * 2. 没删干净（`pending-cleanup`）→ **绝不隐藏**，必须露出来待清理；
 * 3. 同 id 但 createdAt/cwd 不同 → 判为新会话，撤墓碑放行，并落盘。
 */

const cleanups: string[] = []
afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ms-archive-first-'))
  cleanups.push(home)
  return home
}

function baseRuntime(overrides: Partial<StewardRuntime>, home: string): StewardRuntime {
  return {
    config: () => ({ enabled: true, historyFiles: true, healthCheck: true, directDelete: false }),
    dshHome: home,
    projectionStateFor: () => undefined,
    attribute: () => undefined,
    log: () => {},
    tombstoneFile: tombstonePathFor(home),
    ...overrides,
    registry: overrides.registry!,
  }
}

function header(id: string, createdAt: number, cwd: string) {
  return { header: { id, version: 1, createdAt, cwd }, live: false, persisted: true }
}

function activeError(): Error {
  const error = new Error('session "a" is active')
  error.name = 'WorkspaceActiveSessionError'
  return error
}

describe('archive：活跃会话带 stopActivity 重试', () => {
  it('第一次被活跃拒绝 → 第二次带 stopActivity 成功，不再静默失败', async () => {
    const home = tempHome()
    const calls: { id: string; stopActivity: boolean | undefined }[] = []
    const runtime = baseRuntime({
      registry: () => ({
        archivedSessionIds: [],
        archiveSession: async (id: string, options?: { stopActivity?: boolean }) => {
          calls.push({ id, stopActivity: options?.stopActivity })
          if (options?.stopActivity !== true) throw activeError()
        },
      }),
    }, home)

    const res = await handleMethod('session-history-archive', { sessionIds: ['a'] }, runtime) as {
      ok: boolean
      requested?: number
      added?: number
      failures?: { sessionId: string; reason: string }[]
    }
    expect(res.ok).toBe(true)
    expect(res.requested).toBe(1)
    expect(res.added).toBe(1)
    expect(res.failures).toBeUndefined()
    expect(calls).toEqual([
      { id: 'a', stopActivity: undefined },
      { id: 'a', stopActivity: true },
    ])
  })

  it('非活跃错误不重试，如实进 failures', async () => {
    const home = tempHome()
    let calls = 0
    const runtime = baseRuntime({
      registry: () => ({
        archivedSessionIds: [],
        archiveSession: async () => {
          calls += 1
          const error = new Error('session unknown')
          error.name = 'WorkspaceUnknownSessionError'
          throw error
        },
      }),
    }, home)
    const res = await handleMethod('session-history-archive', { sessionIds: ['a'] }, runtime) as {
      ok: boolean
      failures?: { sessionId: string; reason: string }[]
    }
    expect(calls).toBe(1)
    expect(res.failures).toEqual([{ sessionId: 'a', reason: 'session unknown' }])
  })
})

describe('purge：先归档 → detach → 删盘 → 墓碑落盘', () => {
  it('删干净：墓碑记 deleted 并落盘，「重启」（新 runtime 读盘）后仍然隐藏', async () => {
    const home = tempHome()
    const archived: string[] = []
    const detached: unknown[] = []
    const live = { id: 'a' }
    const records = [header('a', 10, 'X')]
    // 真实布局：workstore 文件优先于 registry 内存集合（删除后归档集合已空）。
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      global: { archivedSessionIds: [] },
      tables: { workspaces: {} },
    }, null, 2)}\n`)
    const build = (): StewardRuntime => baseRuntime({
      registry: () => ({
        archivedSessionIds: archived,
        archiveSession: async (id: string) => { archived.push(id) },
        deleteSession: async () => ({ ok: true }),
      }),
      ctx: {
        get: (name: string) => (name === 'sessions'
          ? {
            get: (id: string) => (id === 'a' ? live : undefined),
            flush: async () => {},
            liveEntryFor: () => 'entry-a',
            detachEntered: (entry: unknown) => { detached.push(entry) },
          }
          : undefined),
      },
      sessionQuery: () => ({ listSessions: async () => records }),
      titles: undefined,
      tombstones: latestTombstones(tombstonePathFor(home)),
    }, home)

    const runtime = build()
    const before = await handleMethod('session-catalog', {}, runtime) as { items: { sessionId: string }[] }
    expect(before.items.map(item => item.sessionId)).toEqual(['a'])

    const purged = await handleMethod('session-history-purge', { sessionIds: ['a'] }, runtime) as {
      ok: boolean
      purged?: number
      archivedFirst?: string[]
      detached?: string[]
      pendingCleanup?: string[]
    }
    expect(purged.ok).toBe(true)
    expect(purged.purged).toBe(1)
    expect(purged.archivedFirst).toEqual(['a'])
    expect(purged.detached).toEqual(['a'])
    expect(purged.pendingCleanup).toBeUndefined()
    expect(archived).toEqual(['a'])
    expect(detached).toEqual(['entry-a'])

    const tomb = latestTombstones(tombstonePathFor(home)).get('a')
    expect(tomb?.state).toBe('deleted')
    expect(tomb?.createdAt).toBe(10)
    expect(tomb?.cwd).toBe('X')

    // “重启”：进程内状态清空，只靠落盘墓碑数
    const restarted = build()
    const after = await handleMethod('session-catalog', {}, restarted) as { items: { sessionId: string }[] }
    expect(after.items).toEqual([])
  })

  it('没删干净：记 pending-cleanup，且这一行**不隐藏**（留在墓碑区待清理）', async () => {
    const home = tempHome()
    mkdirSync(join(home, 'sessions', '--w--', 'session-b'), { recursive: true })
    writeFileSync(join(home, 'sessions', '--w--', 'session-b', 'session.v4.jsonl.zstd'), 'x')
    mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'session-b.json'), '{}')

    const runtime = baseRuntime({
      // deleteSession 返回 ok 但实际什么都没删 → 后置校验判为“没删干净”。
      registry: () => ({
        archivedSessionIds: ['session-b'],
        archiveSession: async () => {},
        deleteSession: async () => ({ ok: true }),
      }),
      sessionQuery: () => ({ listSessions: async () => [header('session-b', 20, 'W')] }),
      titles: undefined,
      tombstones: latestTombstones(tombstonePathFor(home)),
    }, home)

    const purged = await handleMethod('session-history-purge', { sessionIds: ['session-b'] }, runtime) as {
      ok: boolean
      pendingCleanup?: string[]
    }
    expect(purged.ok).toBe(true)
    expect(purged.pendingCleanup).toEqual(['session-b'])

    const tomb = latestTombstones(tombstonePathFor(home)).get('session-b')
    expect(tomb?.state).toBe('pending-cleanup')
    expect(tomb?.reason).toContain('仍在')

    const catalog = await handleMethod('session-catalog', {}, runtime) as { items: { sessionId: string }[] }
    expect(catalog.items.map(item => item.sessionId)).toEqual(['session-b'])
  })
})

describe('冷复用探针', () => {
  it('同 id 但 createdAt/cwd 不同 → 判为新会话，撤墓碑（落盘）并放行', async () => {
    const home = tempHome()
    const file = tombstonePathFor(home)
    appendTombstoneRecords([{
      sessionId: 'c', retiredAt: new Date().toISOString(), source: 'test',
      state: 'deleted', createdAt: 1, cwd: 'A',
    }], { dir: home })

    const runtime = baseRuntime({
      registry: () => ({ archivedSessionIds: [] }),
      sessionQuery: () => ({ listSessions: async () => [header('c', 2, 'B')] }),
      titles: undefined,
      tombstones: latestTombstones(file),
    }, home)

    const catalog = await handleMethod('session-catalog', {}, runtime) as { items: { sessionId: string }[] }
    expect(catalog.items.map(item => item.sessionId)).toEqual(['c'])
    expect(latestTombstones(file).has('c')).toBe(false)
  })

  it('身份一致的历史墓碑（老格式无身份）仍然隐藏', async () => {
    const home = tempHome()
    const file = tombstonePathFor(home)
    appendTombstoneRecords([{ sessionId: 'd', retiredAt: new Date().toISOString(), source: 'test', state: 'deleted' }], { dir: home })
    const runtime = baseRuntime({
      registry: () => ({ archivedSessionIds: [] }),
      sessionQuery: () => ({ listSessions: async () => [header('d', 3, 'C')] }),
      titles: undefined,
      tombstones: latestTombstones(file),
    }, home)
    const catalog = await handleMethod('session-catalog', {}, runtime) as { items: { sessionId: string }[] }
    expect(catalog.items).toEqual([])
  })
})

describe('清理区 API（session-tombstones / session-tombstone-forget）', () => {
  it('只返回没删干净的；实体已无可 forget，实体仍在则拒绝', async () => {
    const home = tempHome()
    const file = tombstonePathFor(home)
    mkdirSync(join(home, 'sessions', '--w--', 'session-kept'), { recursive: true })
    writeFileSync(join(home, 'sessions', '--w--', 'session-kept', 'session.v4.jsonl.zstd'), 'x')
    appendTombstoneRecords([
      { sessionId: 'session-gone', retiredAt: new Date().toISOString(), source: 'test', state: 'deleted', createdAt: 1, cwd: 'X' },
      { sessionId: 'session-kept', retiredAt: new Date().toISOString(), source: 'test', state: 'pending-cleanup', reason: '目录仍在', createdAt: 2, cwd: 'X' },
    ], { dir: home })
    const runtime = baseRuntime({
      registry: () => ({ archivedSessionIds: [] }),
      sessionQuery: () => ({ listSessions: async () => [] }),
      titles: undefined,
      tombstones: latestTombstones(file),
    }, home)

    const listed = await handleMethod('session-tombstones', {}, runtime) as {
      pending: { sessionId: string; entityExists: boolean }[]
      total: number
    }
    expect(listed.pending.map(row => row.sessionId)).toEqual(['session-kept'])
    expect(listed.pending[0]?.entityExists).toBe(true)
    expect(listed.total).toBe(2)

    const refused = await handleMethod('session-tombstone-forget', { sessionIds: ['session-kept'] }, runtime) as {
      ok: boolean
      error?: string
    }
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('仍有磁盘实体')

    const done = await handleMethod('session-tombstone-forget', { sessionIds: ['session-gone'] }, runtime) as {
      ok: boolean
      forgotten?: number
    }
    expect(done).toEqual({ ok: true, forgotten: 1 })
    expect(latestTombstones(file).has('session-gone')).toBe(false)
  })
})