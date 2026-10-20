/**
 * 退场墓碑台账 × 离线清残脚本（2026-10-20 用户定标两功能）：
 * - tombstones：append/read 往返、畸形行跳过、坏目录静默；
 * - purge 接线：内存路径只对成功 id 落账、兜底路径同样落账（r6 同款假 runtime）；
 * - cleanup-retired.mjs：parseArgs / 越界闸 / workspace 摘除 / dry-run 与
 *   apply 端到端（临时家目录四残骸面全造齐）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendRetiredTombstones, readRetiredTombstones, tombstonePathFor,
} from '../src/host/history/tombstones.ts'
import { handleMethod, type StewardRuntime } from '../src/index.ts'
import {
  SESSION_ID_RE, isUnder, parseArgs, readLedger, runCleanup, stripIdFromWorkspace,
} from '../scripts/cleanup-retired.mjs'

const cleanups: string[] = []
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}
afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

const SID = 'session-0ddde9cc-170a-4155-b578-ad2bfe48e467'
const SID2 = 'session-11111111-2222-3333-4444-555555555555'

describe('墓碑台账（tombstones.ts）', () => {
  it('append → read 往返；空入参零写；重复 id 去重', () => {
    const dir = tmp('tomb-')
    expect(appendRetiredTombstones([], { dir, source: 'test' })).toBe(0)
    expect(appendRetiredTombstones([SID, SID2, SID], { dir, source: 'test' })).toBe(2)
    const rows = readRetiredTombstones(tombstonePathFor(dir))
    expect(rows.map(r => r.sessionId)).toEqual([SID, SID2])
    expect(rows[0]!.source).toBe('test')
    expect(rows[0]!.retiredAt).toMatch(/^\d{4}-/)
    // 二次追加不覆盖（append-only）
    expect(appendRetiredTombstones([SID], { dir, source: 'again' })).toBe(1)
    expect(readRetiredTombstones(tombstonePathFor(dir))).toHaveLength(3)
  })

  it('读侧畸形行/半行跳过；缺文件回空', () => {
    const dir = tmp('tomb-bad-')
    writeFileSync(tombstonePathFor(dir), `{"sessionId":"${SID}"}\n{not json\n{"noSessionId":1}\n\n`, 'utf8')
    expect(readRetiredTombstones(tombstonePathFor(dir)).map(r => r.sessionId)).toEqual([SID])
    expect(readRetiredTombstones(join(dir, 'nope.jsonl'))).toEqual([])
  })

  it('目录不可写（路径被文件占位）：吞错回 0，绝不抛', () => {
    const dir = tmp('tomb-ro-')
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'x', 'utf8') // mkdir 撞上同名文件 → ENOTDIR/EEXIST
    const logs: string[] = []
    expect(appendRetiredTombstones([SID], { dir: blocker, source: 't', log: m => logs.push(m) })).toBe(0)
    expect(logs).toHaveLength(1)
  })
})

describe('purge 接线（handleMethod session-history-purge）', () => {
  function fakeRuntime(dir: string, tombDir: string): StewardRuntime {
    return {
      config: () => ({ enabled: true, historyFiles: true, healthCheck: true, search: true, directDelete: false }),
      dshHome: dir,
      registry: () => ({
        archivedSessionIds: [],
        deleteSession: async (id: string) => (id === 'bad' ? { ok: false, error: '模拟失败' } : { ok: true }),
      }),
      projectionStateFor: () => undefined,
      attribute: () => undefined,
      log: () => {},
      tombstoneDir: () => tombDir,
    }
  }

  it('内存路径：成功 id 落账、失败 id 不落', async () => {
    const home = tmp('purge-home-')
    const tomb = tmp('purge-tomb-')
    const res = await handleMethod('session-history-purge', { sessionIds: [SID, 'bad', SID2] }, fakeRuntime(home, tomb)) as { ok: boolean; purged?: number }
    expect(res.ok).toBe(true)
    expect(res.purged).toBe(2)
    const rows = readRetiredTombstones(tombstonePathFor(tomb))
    expect(rows.map(r => r.sessionId).sort()).toEqual([SID, SID2].sort())
    expect(rows.every(r => r.source === 'steward-purge-memory')).toBe(true)
  })

  it('兜底路径（registry 无 deleteSession）：purgeHistory 成功项同样落账', async () => {
    const home = tmp('purge-fb-')
    const tomb = tmp('purge-fb-tomb-')
    // 造归档实体：sessions/--w--/<id>/ 与 workspace.json（archive 态）
    mkdirSync(join(home, 'sessions', '--w--', SID), { recursive: true })
    writeFileSync(join(home, 'sessions', '--w--', SID, 'session.jsonl.zstd'), 'x', 'utf8')
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
      global: { archivedSessionIds: [SID] },
      tables: { workspaces: { w: { sessionIds: [SID] } } },
    }), 'utf8')
    const runtime = fakeRuntime(home, tomb)
    runtime.registry = () => ({ archivedSessionIds: [SID] }) // 无 deleteSession → 走文件兜底
    const res = await handleMethod('session-history-purge', { sessionIds: [SID] }, runtime) as { ok: boolean; purged?: number }
    expect(res.ok).toBe(true)
    const rows = readRetiredTombstones(tombstonePathFor(tomb))
    expect(rows.map(r => r.sessionId)).toEqual([SID])
    expect(rows[0]!.source).toBe('steward-purge-fallback')
  })
})

describe('清理脚本纯函数', () => {
  it('parseArgs：缺省 dry-run；--apply/--force-live/路径覆盖', () => {
    expect(parseArgs([])).toMatchObject({ apply: false, forceLive: false, ledger: '' })
    const o = parseArgs(['--apply', '--force-live', '--ledger', 'x.jsonl', '--dsh-home', 'h', '--index-dir', 'i', '--collector-db', 'c.db'])
    expect(o).toEqual({ apply: true, forceLive: true, ledger: 'x.jsonl', dshHome: 'h', indexDir: 'i', collectorDb: 'c.db' })
    expect(() => parseArgs(['--nope'])).toThrow('未知参数')
  })

  it('SESSION_ID_RE 只放 session-uuid；isUnder 拦越界', () => {
    expect(SESSION_ID_RE.test(SID)).toBe(true)
    expect(SESSION_ID_RE.test('bad')).toBe(false)
    expect(SESSION_ID_RE.test('session-..\\..\\evil')).toBe(false)
    expect(isUnder('/a/b', '/a/b/c')).toBe(true)
    expect(isUnder('/a/b', '/a/other')).toBe(false)
  })

  it('stripIdFromWorkspace：两处清单摘除并报告 changed；无命中不改', () => {
    const doc = { global: { archivedSessionIds: [SID, 'keep'] }, tables: { workspaces: { w: { sessionIds: [SID] } } } }
    expect(stripIdFromWorkspace(doc, SID).changed).toBe(true)
    expect(doc.global.archivedSessionIds).toEqual(['keep'])
    expect(doc.tables.workspaces.w.sessionIds).toEqual([])
    expect(stripIdFromWorkspace(doc, SID).changed).toBe(false)
  })

  it('readLedger：JSONL 去重保最早；坏行跳过', () => {
    const dir = tmp('led-')
    const f = join(dir, 'l.jsonl')
    writeFileSync(f, `{"sessionId":"${SID}","retiredAt":"2026-01-01"}\n{bad\n{"sessionId":"${SID}","retiredAt":"2026-02-01"}\n`, 'utf8')
    expect(readLedger(f).map(r => r.retiredAt)).toEqual(['2026-01-01'])
  })
})

describe('runCleanup 端到端（临时家目录四残骸面）', () => {
  function buildFixture() {
    const home = tmp('cln-home-')
    const indexDir = tmp('cln-index-')
    const collectorHome = tmp('cln-col-')
    const collectorDb = join(collectorHome, 'projection.db')
    // ① 转录目录 + ② 投影缓存
    mkdirSync(join(home, 'sessions', '--w--', SID), { recursive: true })
    writeFileSync(join(home, 'sessions', '--w--', SID, 'session.jsonl'), 'x', 'utf8')
    mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', `${SID}.json`), '{}', 'utf8')
    // ③ workspace.json
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
      global: { archivedSessionIds: [SID, 'session-ffffffff-0000-0000-0000-000000000000'] },
      tables: { workspaces: { w: { sessionIds: [SID] } } },
    }, null, 2), 'utf8')
    // ④ 管家 index.sqlite（sessions/docs + 外部内容 fts）与 collector projection.db
    const idx = new DatabaseSync(join(indexDir, 'index.sqlite'))
    idx.exec(`CREATE TABLE sessions(session_id TEXT PRIMARY KEY, title TEXT);
      CREATE TABLE docs(rowid INTEGER PRIMARY KEY, session_id TEXT, text TEXT);
      CREATE VIRTUAL TABLE docs_fts USING fts5(text, content='docs', content_rowid='rowid')`)
    idx.prepare('INSERT INTO sessions VALUES(?,?)').run(SID, '残会话')
    idx.prepare('INSERT INTO docs(rowid, session_id, text) VALUES(1,?,?)').run(SID, 'residual-body')
    idx.close()
    const col = new DatabaseSync(collectorDb)
    col.exec(`CREATE TABLE sessions(session_id TEXT PRIMARY KEY);
      CREATE TABLE segments(session_id TEXT, seq INTEGER);
      CREATE VIRTUAL TABLE segments_fts USING fts5(index_text, session_id UNINDEXED, seq UNINDEXED);
      CREATE TABLE replaces(session_id TEXT, seq INTEGER)`)
    col.prepare('INSERT INTO sessions VALUES(?)').run(SID)
    col.prepare('INSERT INTO segments VALUES(?,1)').run(SID)
    col.prepare('INSERT INTO replaces VALUES(?,1)').run(SID)
    col.close()
    // 台账：SID 有残骸；SID2 无残骸；畸形 id
    const ledger = join(indexDir, 'retired-tombstones.jsonl')
    writeFileSync(ledger, [
      JSON.stringify({ sessionId: SID }),
      JSON.stringify({ sessionId: SID2 }),
      '{"sessionId":"not-a-session"}',
    ].join('\n'), 'utf8')
    return { home, indexDir, collectorDb, ledger }
  }

  it('dry-run：报残骸计数且零动盘', () => {
    const fx = buildFixture()
    const report = runCleanup({ apply: false, forceLive: true, ledger: fx.ledger, dshHome: fx.home, indexDir: fx.indexDir, collectorDb: fx.collectorDb })
    expect(report.entries).toBe(3)
    expect(report.invalid).toEqual(['not-a-session'])
    expect(report.withResidue).toBe(1)
    expect(report.clean.find(p => p.sessionId === SID)).toMatchObject({
      stewardRows: 1, collectorRows: 1,
    })
    expect(report.clean.find(p => p.sessionId === SID)!.workspaceHits.length).toBe(2)
    // 什么都没动
    expect(existsSync(join(fx.home, 'sessions', '--w--', SID))).toBe(true)
    expect(JSON.parse(readFileSync(join(fx.home, 'storages', 'workspace.json'), 'utf8')).global.archivedSessionIds).toContain(SID)
  })

  it('apply：目录/缓存移入归档区、workspace 摘净有备份、两库行清零、fts rebuild 不伤幸存行', () => {
    const fx = buildFixture()
    // 幸存会话（不在台账）：验证误删防御
    const idx = new DatabaseSync(join(fx.indexDir, 'index.sqlite'))
    idx.prepare('INSERT INTO sessions VALUES(?,?)').run('session-99999999-0000-0000-0000-000000000000', '幸存')
    idx.prepare('INSERT INTO docs(rowid, session_id, text) VALUES(2,?,?)').run('session-99999999-0000-0000-0000-000000000000', 'keepbody survivor')
    idx.close()
    const report = runCleanup({ apply: true, forceLive: true, ledger: fx.ledger, dshHome: fx.home, indexDir: fx.indexDir, collectorDb: fx.collectorDb })
    expect(report.mode).toBe('apply')
    expect(report.withResidue).toBe(1)
    // ①② 实体已离开原位、进了归档区
    expect(existsSync(join(fx.home, 'sessions', '--w--', SID))).toBe(false)
    expect(existsSync(join(fx.home, 'storages', 'session_projcache', 'sessions', `${SID}.json`))).toBe(false)
    expect(report.archiveRoot).not.toBe('')
    expect(existsSync(join(report.archiveRoot, 'sessions', SID))).toBe(true)
    // ③ workspace 两处摘净 + 备份在
    const ws = JSON.parse(readFileSync(join(fx.home, 'storages', 'workspace.json'), 'utf8'))
    expect(ws.global.archivedSessionIds).toEqual(['session-ffffffff-0000-0000-0000-000000000000'])
    expect(ws.tables.workspaces.w.sessionIds).toEqual([])
    expect(report.workspaceBackedUp).toBe(true)
    // ④ 两库清零、幸存行健在、fts 一致性（rebuild 后按内容表重导可查）
    const idx2 = new DatabaseSync(join(fx.indexDir, 'index.sqlite'))
    expect(Number(idx2.prepare('SELECT COUNT(*) n FROM sessions WHERE session_id=?').get(SID)!.n)).toBe(0)
    expect(Number(idx2.prepare("SELECT COUNT(*) n FROM sessions WHERE session_id='session-99999999-0000-0000-0000-000000000000'").get()!.n)).toBe(1)
    idx2.exec("INSERT INTO docs_fts(docs_fts) VALUES('integrity-check')")
    expect(idx2.prepare("SELECT rowid FROM docs_fts WHERE docs_fts MATCH 'survivor'").all()).toHaveLength(1)
    idx2.close()
    const col2 = new DatabaseSync(fx.collectorDb)
    for (const t of ['sessions', 'segments', 'replaces']) {
      expect(Number(col2.prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n), t).toBe(0)
    }
    col2.close()
    // report.json 落归档区
    expect(existsSync(join(report.archiveRoot, 'report.json'))).toBe(true)
  })

  it('apply 幂等：二跑零残骸（台账不动，盘上已无目标）', () => {
    const fx = buildFixture()
    const first = runCleanup({ apply: true, forceLive: true, ledger: fx.ledger, dshHome: fx.home, indexDir: fx.indexDir, collectorDb: fx.collectorDb })
    expect(first.withResidue).toBe(1)
    const second = runCleanup({ apply: true, forceLive: true, ledger: fx.ledger, dshHome: fx.home, indexDir: fx.indexDir, collectorDb: fx.collectorDb })
    expect(second.withResidue).toBe(0)
  })
})
