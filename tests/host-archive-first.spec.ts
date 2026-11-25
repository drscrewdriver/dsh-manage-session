import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handleMethod, type StewardRuntime } from '../src/index.ts'

/**
 * 「删除永远先归档 + 删盘前 detach 活会话 + 进程内墓碑」的契约测试。
 *
 * 背景：活跃会话（开着的 tab / 正在跑回合）会被宿主 `archiveSession` 拒绝；
 * 之前插件把失败吞进 `failures` 里返回 ok，用户看到的是「点了没反应」。
 * 更糟的是删除只动磁盘，宿主内存里的 live 会话仍被 `listSessions()` 列出来，
 * 于是面板留下一条未命名幽灵行，直到宿主重启。
 */

const cleanups: string[] = []
afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

function baseRuntime(overrides: Partial<StewardRuntime> & { registry: StewardRuntime['registry'] }): StewardRuntime {
  const home = mkdtempSync(join(tmpdir(), 'ms-archive-first-'))
  cleanups.push(home)
  return {
    config: () => ({ enabled: true, historyFiles: true, healthCheck: true, directDelete: false }),
    dshHome: home,
    projectionStateFor: () => undefined,
    attribute: () => undefined,
    log: () => {},
    ...overrides,
    registry: overrides.registry,
  }
}

function activeError(): Error {
  const error = new Error('session "a" is active')
  error.name = 'WorkspaceActiveSessionError'
  return error
}

describe('archive：活跃会话带 stopActivity 重试', () => {
  it('第一次被活跃拒绝 → 第二次带 stopActivity 成功，不再静默失败', async () => {
    const calls: { id: string; stopActivity: boolean | undefined }[] = []
    const runtime = baseRuntime({
      registry: () => ({
        archivedSessionIds: [],
        archiveSession: async (id: string, options?: { stopActivity?: boolean }) => {
          calls.push({ id, stopActivity: options?.stopActivity })
          if (options?.stopActivity !== true) throw activeError()
        },
      }),
    })

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
    })
    const res = await handleMethod('session-history-archive', { sessionIds: ['a'] }, runtime) as {
      ok: boolean
      failures?: { sessionId: string; reason: string }[]
    }
    expect(calls).toBe(1)
    expect(res.failures).toEqual([{ sessionId: 'a', reason: 'session unknown' }])
  })
})

describe('purge：先归档 → detach 活会话 → 墓碑过滤', () => {
  it('归档 + detach + 删盘，catalog 立刻不再列出已删会话', async () => {
    const archived: string[] = []
    const detached: unknown[] = []
    const deleted: string[] = []
    const live = { id: 'a' }
    const runtime = baseRuntime({
      registry: () => ({
        archivedSessionIds: archived,
        archiveSession: async (id: string) => { archived.push(id) },
        deleteSession: async (id: string) => { deleted.push(id); return { ok: true } },
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
      sessionQuery: () => ({
        listSessions: async () => [{ header: { id: 'a', version: 1, createdAt: 1 }, live: true, persisted: true }],
      }),
      titles: undefined,
      deletedSessions: new Set<string>(),
    })

    const before = await handleMethod('session-catalog', {}, runtime) as { ok: boolean; items: { sessionId: string }[] }
    expect(before.items.map(item => item.sessionId)).toEqual(['a'])

    const purged = await handleMethod('session-history-purge', { sessionIds: ['a'] }, runtime) as {
      ok: boolean
      purged?: number
      archivedFirst?: string[]
      detached?: string[]
      archiveFailures?: unknown
    }
    expect(purged.ok).toBe(true)
    expect(purged.purged).toBe(1)
    expect(purged.archivedFirst).toEqual(['a'])
    expect(purged.detached).toEqual(['a'])
    expect(purged.archiveFailures).toBeUndefined()
    expect(archived).toEqual(['a'])
    expect(detached).toEqual(['entry-a'])
    expect(deleted).toEqual(['a'])

    const after = await handleMethod('session-catalog', {}, runtime) as { ok: boolean; items: { sessionId: string }[] }
    expect(after.items).toEqual([])
  })
})