/**
 * `session-move-workspace` 路由层契约：拒绝条件、成功路径、履历落盘。
 *
 * 用真实临时 dshHome（真 zstd 日志 + 真 workspace.json），不 mock 磁盘 ——
 * 移动是写宿主私有存储的动作，桩化到那个程度就测不出真问题了。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { handleMethod, methodEnabled, ROW_ACTION_METHODS, type StewardRuntime } from '../src/index.ts'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { TitleMemo } from '../src/host/catalog/title-source.ts'
import { moveLedgerPath, projectKey } from '../src/host/workspace/move.ts'

const SESSION = 'session-99998888-7777-6666-5555-444433332222'
const SRC = 'E:\\test\\ws-src'
const DST = 'E:\\test\\ws-dst'

let root = ''
let dshHome = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ms-route-'))
  dshHome = join(root, 'dsh')
  // 工区表：两个工区（含一个指向不存在目录的坏目标）
  mkdirSync(join(dshHome, 'storages'), { recursive: true })
  mkdirSync(SRC, { recursive: true })
  mkdirSync(DST, { recursive: true })
  writeFileSync(join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
    tables: {
      workspaces: {
        'w-src': { path: SRC, title: '源工区' },
        'w-dst': { path: DST, title: '目标工区' },
        'w-gone': { path: join(root, 'nope'), title: '已删目录' },
      },
    },
  }))
  // 会话日志
  const dir = join(dshHome, 'sessions', projectKey(SRC), SESSION)
  mkdirSync(dir, { recursive: true })
  const body = [
    JSON.stringify({ type: 'session', version: 4, id: SESSION, createdAt: 1, cwd: SRC }),
    JSON.stringify({ type: 'session/user', seq: 1, text: 'hi' }),
    '',
  ].join('\n')
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(body, 'utf8')))
})

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* noop */ }
  try { rmSync(SRC, { recursive: true, force: true }) } catch { /* noop */ }
  try { rmSync(DST, { recursive: true, force: true }) } catch { /* noop */ }
})

/** 造运行时。 */
function runtime(input: { live?: string[]; archived?: string[] } = {}): StewardRuntime {
  return {
    config: () => DEFAULT_CONFIG,
    dshHome,
    ctx: {
      get(name: string) {
        if (name === 'sessions') {
          const byId: Record<string, unknown> = {}
          for (const id of input.live ?? []) byId[id] = {}
          return { list: () => ({ byId }) }
        }
        if (name === 'sessionController') return undefined
        return undefined
      },
    },
    registry: () => ({ archivedSessionIds: input.archived ?? [] }),
    projectionStateFor: () => undefined,
    attribute: () => undefined,
    log: () => {},
    titles: new TitleMemo(),
  }
}

describe('session-workspaces-list', () => {
  it('在册且返回 id/title/path', async () => {
    expect(ROW_ACTION_METHODS).toContain('session-workspaces-list')
    expect(methodEnabled('session-workspaces-list', { ...DEFAULT_CONFIG, historyFiles: false })).toBe(true)
    const res = (await handleMethod('session-workspaces-list', {}, runtime())) as {
      ok: boolean; items: { id: string; title: string; path: string }[]
    }
    expect(res.ok).toBe(true)
    expect(res.items).toHaveLength(3)
    expect(res.items.find(i => i.id === 'w-dst')).toMatchObject({ title: '目标工区', path: DST })
  })
})

describe('session-move-workspace 拒绝条件', () => {
  const reject = async (input: Parameters<typeof runtime>[0], body: unknown) => {
    const res = (await handleMethod('session-move-workspace', body, runtime(input))) as {
      ok: boolean; code?: string; error?: string
    }
    expect(res.ok).toBe(false)
    return res
  }

  it('缺参 / 目标工区不存在 / 目标目录不存在', async () => {
    expect((await reject({}, { sessionId: SESSION })).error).toContain('targetWorkspaceId')
    expect((await reject({}, { targetWorkspaceId: 'w-dst' })).error).toContain('sessionId')
    expect((await reject({}, { sessionId: SESSION, targetWorkspaceId: 'nope' })).error).toContain('目标工区不存在')
    expect((await reject({}, { sessionId: SESSION, targetWorkspaceId: 'w-gone' })).error).toContain('目录不存在')
  })

  it('live 会话拒绝且不改盘', async () => {
    const res = await reject({ live: [SESSION] }, { sessionId: SESSION, targetWorkspaceId: 'w-dst' })
    expect(res.code).toBe('session-live')
    expect(existsSync(join(dshHome, 'sessions', projectKey(SRC), SESSION))).toBe(true)
    expect(existsSync(join(dshHome, 'sessions', projectKey(DST), SESSION))).toBe(false)
  })

  it('归档会话拒绝', async () => {
    const res = await reject({ archived: [SESSION] }, { sessionId: SESSION, targetWorkspaceId: 'w-dst' })
    expect(res.code).toBe('session-archived')
  })

  it('找不到日志 → log-not-found', async () => {
    rmSync(join(dshHome, 'sessions'), { recursive: true, force: true })
    const res = await reject({}, { sessionId: SESSION, targetWorkspaceId: 'w-dst' })
    expect(res.code).toBe('log-not-found')
  })
})

describe('session-move-workspace 成功路径', () => {
  it('改 cwd + 搬目录 + 落履历 + 旧目录进备份', async () => {
    const res = (await handleMethod('session-move-workspace', {
      sessionId: SESSION, targetWorkspaceId: 'w-dst',
    }, runtime())) as {
      ok: boolean; to?: { workspaceId: string; path: string }; ledgerPath?: string; backupDir?: string; bytes?: number
    }
    expect(res.ok).toBe(true)
    expect(res.to).toMatchObject({ workspaceId: 'w-dst', path: DST })

    // 新位置日志 cwd 已改
    const newDir = join(dshHome, 'sessions', projectKey(DST), SESSION)
    const header = JSON.parse(
      zstdDecompressSync(readFileSync(join(newDir, 'session.v4.jsonl.zstd'))).toString('utf8').split('\n')[0]!,
    ) as { cwd: string; id: string }
    expect(header.cwd).toBe(DST)
    expect(header.id).toBe(SESSION)

    // 旧位置已清空
    expect(existsSync(join(dshHome, 'sessions', projectKey(SRC), SESSION))).toBe(false)

    // 履历文件已建且有记录
    expect(res.ledgerPath).toBe(moveLedgerPath(dshHome))
    const lines = readFileSync(moveLedgerPath(dshHome), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(entry).toMatchObject({
      sessionId: SESSION,
      fromWorkspaceId: 'w-src',
      toWorkspaceId: 'w-dst',
      fromProjectKey: projectKey(SRC),
      toProjectKey: projectKey(DST),
    })
    expect(typeof entry.bytes).toBe('number')

    // 备份目录里有旧日志
    expect(existsSync(join(res.backupDir!, SESSION, 'session.v4.jsonl.zstd'))).toBe(true)

    // 履历可经路由读回
    const ledger = (await handleMethod('session-move-ledger-list', {}, runtime())) as {
      ok: boolean; items: { sessionId: string }[]
    }
    expect(ledger.ok).toBe(true)
    expect(ledger.items[0]!.sessionId).toBe(SESSION)
  })

  it('移回原工区是第二次移动，履历累计两条', async () => {
    const rt = runtime()
    await handleMethod('session-move-workspace', { sessionId: SESSION, targetWorkspaceId: 'w-dst' }, rt)
    const back = (await handleMethod('session-move-workspace', { sessionId: SESSION, targetWorkspaceId: 'w-src' }, rt)) as {
      ok: boolean
    }
    expect(back.ok).toBe(true)
    const lines = readFileSync(moveLedgerPath(dshHome), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    // 第三次读面板时标题 memo 已失效（host 侧 invalidate 被调用）
    expect(rt.titles?.get(SESSION)).toBeUndefined()
  })
})
