/**
 * `host/workspace/move.ts` 契约单测。
 *
 * 重点：`projectKey` 必须与宿主 `session-persistence-jsonl` 的编码逐字符一致
 * （目录名错一个字符，宿主就找不到日志）；改写只动首帧；失败必须回滚。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import {
  appendMoveLedger,
  locateSessionLog,
  moveLedgerPath,
  moveSessionLog,
  projectKey,
  readMoveLedger,
  readWorkspaceRows,
  rewriteHeaderCwd,
} from '../src/host/workspace/move.ts'

const SESSION = 'session-11112222-3333-4444-5555-666677778888'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ms-move-'))
})
afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* noop */ }
})

/** 造一份会话日志（zstd）并返回路径。 */
function seedSession(dshHome: string, cwd: string, files: { user?: string } = {}): string {
  const key = projectKey(cwd)
  const dir = join(dshHome, 'sessions', key, SESSION)
  mkdirSync(dir, { recursive: true })
  const header = {
    type: 'session', version: 4, id: SESSION, createdAt: 1, cwd,
    parentSession: null, isSeeded: false, origin: 'user', delegationDepth: 0,
  }
  const body = [
    JSON.stringify(header),
    JSON.stringify({ type: 'session/user', seq: 1, text: files.user ?? 'hello' }),
    '',
  ].join('\n')
  const file = join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, zstdCompressSync(Buffer.from(body, 'utf8')))
  return file
}

/** 读日志首帧。 */
function readHeader(file: string): { cwd?: string; id?: string; type?: string } {
  const text = zstdDecompressSync(readFileSync(file)).toString('utf8')
  return JSON.parse(text.split('\n')[0]!)
}

describe('projectKey（逐字符复刻宿主编码）', () => {
  it('Windows 路径：盘符与反斜杠折叠', () => {
    expect(projectKey('E:\\test\\rewrite-agently')).toBe('--E-test-rewrite-agently--')
  })

  it('正斜杠与冒号同样折叠，连续分隔符只出一个 -', () => {
    expect(projectKey('/home/u/proj')).toBe('--home-u-proj--')
    expect(projectKey('C:\\\\a\\\\b')).toBe('--C-a-b--')
  })

  it('非安全字符转 ~XXXX，且不丢原语义', () => {
    expect(projectKey('C:\\a b')).toBe('--C-a~0020b--')
    expect(projectKey('C:\\中文')).toBe('--C-~4E2D~6587--')
  })

  it('超长路径截断到 251，前导 - 被去掉', () => {
    const key = projectKey(`/${'a'.repeat(400)}`)
    expect(key.startsWith('--a')).toBe(true)
    expect(key.length).toBe(2 + 251 + 2)
  })
})

describe('rewriteHeaderCwd', () => {
  it('只改首帧 cwd，其余行与行数原样', () => {
    const text = [
      JSON.stringify({ type: 'session', version: 4, id: SESSION, cwd: 'E:\\old' }),
      JSON.stringify({ type: 'session/user', seq: 1, text: 'a' }),
      '',
    ].join('\n')
    const out = rewriteHeaderCwd(text, 'E:\\new')
    expect(out.fromCwd).toBe('E:\\old')
    expect(out.header.cwd).toBe('E:\\new')
    const before = text.split('\n')
    const after = out.text.split('\n')
    expect(after.length).toBe(before.length)
    expect(after.slice(1)).toEqual(before.slice(1))
  })

  it('首行不是 session header / 缺 id → 拒绝', () => {
    expect(() => rewriteHeaderCwd(JSON.stringify({ type: 'user' }), 'x')).toThrow(/不是 session header/)
    expect(() => rewriteHeaderCwd(JSON.stringify({ type: 'session' }), 'x')).toThrow(/缺少 id/)
    expect(() => rewriteHeaderCwd('not json', 'x')).toThrow(/不是合法 JSON/)
    expect(() => rewriteHeaderCwd('', 'x')).toThrow(/首行为空/)
  })

  it('CRLF 日志保持 CRLF', () => {
    const text = JSON.stringify({ type: 'session', version: 4, id: SESSION, cwd: 'A' }) + '\r\n\r\n'
    const out = rewriteHeaderCwd(text, 'B')
    expect(out.text.includes('\r\n')).toBe(true)
    expect(out.text.endsWith('\r\n\r\n')).toBe(true)
  })
})

describe('moveSessionLog', () => {
  it('搬到目标工区目录：cwd 改写、旧目录进备份、新位置可解压', () => {
    const dshHome = join(root, 'dsh')
    const src = 'E:\\test\\old-proj'
    const dst = 'E:\\test\\new-proj'
    const file = seedSession(dshHome, src)
    const log = locateSessionLog(dshHome, SESSION)
    expect(log?.file).toBe(file)

    const out = moveSessionLog({
      log: log!, targetCwd: dst, dshHome, sessionId: SESSION,
      backupRoot: join(dshHome, 'storages', 'manage-session', 'move-backup'),
      stamp: 'T1',
    })
    // 新位置正确
    expect(out.toPath.includes(projectKey(dst))).toBe(true)
    expect(out.toProjectKey).toBe(projectKey(dst))
    expect(readHeader(join(out.toPath, 'session.v4.jsonl.zstd')).cwd).toBe(dst)
    // 旧位置已空
    expect(existsSync(log!.dir)).toBe(false)
    // 备份里有完整旧目录
    expect(existsSync(join(out.backupDir, SESSION, 'session.v4.jsonl.zstd'))).toBe(true)
    // 内容行数不变（header + user 事件共 2 行正文；末尾换行不算一行）
    const text = zstdDecompressSync(readFileSync(join(out.toPath, 'session.v4.jsonl.zstd'))).toString('utf8')
    expect(text.trimEnd().split('\n').length).toBe(2)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('目标位置已有同名日志 → 拒绝且不破坏任何一方', () => {
    const dshHome = join(root, 'dsh')
    const dst = 'E:\\test\\dup'
    seedSession(dshHome, 'E:\\test\\src')
    // 预先在目标位置放一份
    const dupDir = join(dshHome, 'sessions', projectKey(dst), SESSION)
    mkdirSync(dupDir, { recursive: true })
    writeFileSync(join(dupDir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from('{"type":"session","id":"x"}\n')))

    const log = locateSessionLog(dshHome, SESSION)!
    expect(() => moveSessionLog({
      log, targetCwd: dst, dshHome, sessionId: SESSION,
      backupRoot: join(dshHome, 'bk'), stamp: 'T2',
    })).toThrow(/已存在同名日志/)
    // 源仍在
    expect(existsSync(log.file)).toBe(true)
  })

  it('未压缩 jsonl 后端也能搬，且保持未压缩', () => {
    const dshHome = join(root, 'dsh')
    const src = 'E:\\a'
    const dir = join(dshHome, 'sessions', projectKey(src), SESSION)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl'), JSON.stringify({ type: 'session', version: 4, id: SESSION, cwd: src }) + '\n')
    const log = locateSessionLog(dshHome, SESSION)!
    const out = moveSessionLog({
      log, targetCwd: 'E:\\b', dshHome, sessionId: SESSION, backupRoot: join(dshHome, 'bk'), stamp: 'T3',
    })
    const moved = join(out.toPath, 'session.v4.jsonl')
    expect(existsSync(moved)).toBe(true)
    expect(JSON.parse(readFileSync(moved, 'utf8').split('\n')[0]!).cwd).toBe('E:\\b')
  })
})

describe('工区表与履历', () => {
  it('readWorkspaceRows 读 tables.workspaces，缺表抛错', () => {
    const dshHome = join(root, 'dsh')
    mkdirSync(join(dshHome, 'storages'), { recursive: true })
    writeFileSync(join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
      tables: { workspaces: { w1: { path: 'E:\\a', title: 'A 区' }, w2: { path: 'E:\\b' } } },
    }))
    const rows = readWorkspaceRows(dshHome)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'w1', path: 'E:\\a', title: 'A 区' })
    // title 缺省回退 path
    expect(rows[1]!.title).toBe('E:\\b')

    rmSync(join(dshHome, 'storages', 'workspace.json'))
    expect(() => readWorkspaceRows(dshHome)).toThrow(/找不到工区表/)
  })

  it('履历首次写入即建文件，读回按条数截断且坏行跳过', () => {
    const dshHome = join(root, 'dsh')
    expect(readMoveLedger(dshHome)).toEqual([])
    appendMoveLedger(dshHome, {
      ts: 1, sessionId: SESSION, fromPath: 'a', toPath: 'b',
      fromWorkspaceId: 'w1', toWorkspaceId: 'w2', fromProjectKey: '--a--', toProjectKey: '--b--', bytes: 10,
    })
    expect(existsSync(moveLedgerPath(dshHome))).toBe(true)
    appendMoveLedger(dshHome, {
      ts: 2, sessionId: 'session-x', fromPath: 'c', toPath: 'd',
      fromWorkspaceId: 'w2', toWorkspaceId: 'w3', fromProjectKey: '--c--', toProjectKey: '--d--', bytes: 20,
    })
    const all = readMoveLedger(dshHome)
    expect(all).toHaveLength(2)
    expect(all[1]!.ts).toBe(2)
    expect(readMoveLedger(dshHome, 1).map(e => e.ts)).toEqual([2])
    // 坏行不炸
    writeFileSync(moveLedgerPath(dshHome), 'garbage\n' + readFileSync(moveLedgerPath(dshHome), 'utf8'))
    expect(readMoveLedger(dshHome)).toHaveLength(2)
  })
})
