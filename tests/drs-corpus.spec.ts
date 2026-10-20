/**
 * T7.1 DRS 语料源断言:
 * - resolveDrsBaseUrl 解析序(显式 > trustedHosts > 默认口)与 scheme 补全;
 * - DrsCorpusSource 对 DRS 包络的分页/映射(version←artifact_mtime_ms、
 *   updatedAt←last_time_ms、on_surface→current/shadowed、kind→type)/
 *   错误传播/Host 头回显;
 * - SwitchWatermarkSync DRS 轮:docs 直插引擎、中文与工具调用参数可搜、
 *   归档旗标随 DRS 行、水位二轮零重读、版本推进重读、
 *   DRS 整轮失败回退原生 sessionQuery 链路。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { SwitchIndexEngine, SwitchWatermarkSync } from '../src/index.ts'
import { DrsCorpusSource, resolveDrsBaseUrl } from '../src/host/index/drs-source.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function makeEngine(): SwitchIndexEngine {
  return new SwitchIndexEngine({ path: join(mkdtempSync(join(tmpdir(), 'drs-corpus-')), 'index.sqlite') })
}

const SESSION_ROW_A = {
  session_id: 's-drs-a', artifact_mtime_ms: 1111, last_time_ms: 300,
  title: 'DRS 演示', cwd: '/d1', archived: 0,
}
const DOC_ROWS = [
  { seq: 1, kind: 'user/message', on_surface: 1, time: 100, search_text: '投影同步器中文内容' },
  { seq: 2, kind: 'tool/call', on_surface: 1, time: 200, search_text: '工具调用参数 {"path":"E:/demo/main.ts"} todo 写入内容' },
  { seq: 3, kind: 'tool/result', on_surface: 0, time: 300, search_text: '被压缩 shadowed 的工具输出原文' },
]

describe('resolveDrsBaseUrl', () => {
  it('解析序:显式 > 首个 trustedHosts > 默认口;scheme 补全', () => {
    assert.equal(resolveDrsBaseUrl(undefined, undefined), 'http://127.0.0.1:8080')
    assert.equal(resolveDrsBaseUrl('', []), 'http://127.0.0.1:8080')
    assert.equal(resolveDrsBaseUrl('', ['localhost:9000', '127.0.0.1:1']), 'http://localhost:9000')
    assert.equal(resolveDrsBaseUrl('http://explicit:1', ['localhost:9000']), 'http://explicit:1')
    assert.equal(resolveDrsBaseUrl('127.0.0.1:8080', undefined), 'http://127.0.0.1:8080')
  })
})

describe('DrsCorpusSource', () => {
  it('listSessions 分页拉满;readSession 字段对照(T7.0)映射', async () => {
    const seenHosts: (string | undefined)[] = []
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = String(url instanceof Request ? url.url : url)
      const headers = (init?.headers ?? {}) as Record<string, string>
      seenHosts.push(headers['host'])
      if (u.includes('op=sessions')) {
        const offset = Number(new URL(u).searchParams.get('offset') ?? '0')
        if (offset === 0) {
          return jsonResponse({ ok: true, total: 3, rows: [SESSION_ROW_A, { ...SESSION_ROW_A, session_id: 's-b', artifact_mtime_ms: 2222 }] })
        }
        assert.equal(offset, 2, '第二页 offset=累计行数(光标语义)')
        return jsonResponse({ ok: true, total: 3, rows: [{ ...SESSION_ROW_A, session_id: 's-c', archived: 1 }] })
      }
      if (u.includes('op=session')) {
        const id = new URL(u).searchParams.get('session')
        if (id === 's-drs-a') return jsonResponse({ ok: true, session: SESSION_ROW_A, rows: DOC_ROWS })
        return jsonResponse({ ok: true, session: null, rows: [] })
      }
      return new Response('nope', { status: 404 })
    }
    const source = new DrsCorpusSource({ baseUrl: 'http://127.0.0.1:8080', fetchImpl, hostHeader: 'localhost:8080' })
    const heads = await source.listSessions()
    assert.deepEqual(heads.map(head => head.sessionId), ['s-drs-a', 's-b', 's-c'])
    assert.equal(heads[0]?.version, 1111)
    assert.equal(heads[0]?.updatedAt, 300)
    assert.equal(heads[2]?.archived, true)
    assert.ok(seenHosts.every(host => host === 'localhost:8080'), 'Host 头逐请求回显')

    const session = await source.readSession('s-drs-a')
    assert.equal(session?.head.version, 1111)
    assert.deepEqual(session?.docs.map(doc => doc.surface), ['current', 'current', 'shadowed'])
    assert.equal(session?.docs[1]?.type, 'tool/call')
    assert.ok(session?.docs[1]?.text.includes('todo 写入内容'))
    assert.equal(await source.readSession('s-missing'), undefined)
  })

  it('错误传播:非 2xx 与 ok=false 一律抛(调用方回退 native)', async () => {
    const httpFail = new DrsCorpusSource({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl: async () => new Response('boom', { status: 500 }),
    })
    await assert.rejects(httpFail.listSessions(), /HTTP 500/)
    const envelopeFail = new DrsCorpusSource({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl: async () => jsonResponse({ ok: false, error: 'forbidden' }),
    })
    await assert.rejects(envelopeFail.readSession('s-x'), /ok=false/)
  })
})

describe('SwitchWatermarkSync DRS 轮', () => {
  it('会话头直写(T7.3 轮语义):水位/归档随 DRS 行、零 detail 读、docs 不入本地索引', async () => {
    const engine = makeEngine()
    await engine.open()
    let reads = 0
    const heads = [
      { sessionId: 's-drs-1', version: 111, title: 'DRS 演示', cwd: '/d1', updatedAt: 300, archived: false },
      { sessionId: 's-drs-2', version: 222, title: '空会话', cwd: '/d2', updatedAt: 5, archived: true },
    ]
    const drsSource = {
      listSessions: async () => heads,
      readSession: async (id: string) => {
        reads += 1
        if (id === 's-drs-1') {
          return {
            head: heads[0]!,
            docs: [
              { seq: 1, type: 'user/message', surface: 'current', time: 100, text: '投影同步器中文内容' },
              { seq: 2, type: 'tool/call', surface: 'current', time: 200, text: '工具调用参数 {"path":"E:/demo/main.ts"} todo 写入内容' },
              { seq: 3, type: 'tool/result', surface: 'shadowed', time: 300, text: '被压缩 shadowed 的工具输出原文' },
            ],
          }
        }
        return { head: heads[1]!, docs: [] }
      },
    }
    const sync = new SwitchWatermarkSync(engine, {
      listSessions: async () => { throw new Error('native corpus must not be read in DRS pass') },
      readSession: async () => { throw new Error('native readSession must not be called in DRS pass') },
    }, () => ({ archivedSessionIds: [] }), () => {}, undefined, undefined, drsSource)

    const pass1 = await sync.poll()
    assert.equal(pass1.updated, 2)
    assert.equal(pass1.indexed, 2)
    assert.equal(pass1.hollow, 2, 'header-only：全会话无 docs（合法 hollow）')
    assert.equal(engine.getSession('s-drs-1')?.version, 111)
    assert.equal(engine.getSession('s-drs-2')?.archived, true, '归档旗标随 DRS 行')
    assert.equal(engine.getSession('s-drs-1')?.updatedAt, 300, 'updated_at←last_time_ms(时间排序键)')

    // T7.3 直连：DRS 轮不写 docs/docs_fts，本地引擎检索面恒空——内容搜索
    // 走 DrsCorpusSource.searchGrouped（下方独立用例盖 wire 映射），头轮只管水位。
    assert.equal(engine.search({ query: '投影同步' }).length, 0)
    assert.equal(reads, 0, 'header 轮零 readSession')

    const readsBefore = reads
    const pass2 = await sync.poll()
    assert.equal(pass2.updated, 0, '水位对齐 → 跳过')
    assert.equal(reads, readsBefore, '二轮零 detail 重读')

    heads[0]!.version = 999
    const pass3 = await sync.poll()
    assert.equal(pass3.updated, 1, '版本推进 → 直写会话头')
    assert.equal(reads, 0, '版本推进也不 detail 读')
    engine.close()
  })

  it('DRS 整轮失败 → 回退原生 sessionQuery 链路(一轮永远有产出)', async () => {
    const engine = makeEngine()
    await engine.open()
    const logs: string[] = []
    const failingSource = {
      listSessions: async () => { throw new Error('DRS down') },
      readSession: async () => undefined,
    }
    const sync = new SwitchWatermarkSync(engine, {
      listSessions: async () => [{ header: { id: 's-native', version: 7, createdAt: 1, cwd: '/n' } }],
      readSession: async (id) => ({
        session: { id, version: 7, createdAt: 1, cwd: '/n' },
        events: [{ seq: 0, type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '原生语料回退内容' }] } }],
      }),
    }, () => ({ archivedSessionIds: [] }), (message) => { logs.push(message) }, undefined, undefined, failingSource)

    const state = await sync.poll()
    assert.equal(state.indexed, 1)
    assert.ok(logs.some(line => line.includes('falling back to native')), '回退有日志')
    assert.ok(engine.search({ query: '回退内容' }).length >= 1)
    engine.close()
  })
})

describe('DrsCorpusSource.searchGrouped(T7.3 直连臂)', () => {
  it('参数构造与 wire→引擎命中形状映射', async () => {
    let seenUrl = ''
    const source = new DrsCorpusSource({
      baseUrl: 'http://127.0.0.1:5990',
      fetchImpl: (async (input: unknown) => {
        seenUrl = String(input)
        return jsonResponse({ ok: true, query: 'x', hits: [
          { session_id: 's1', title: 'T', seq: 7, type: 'user/message', time: 100, updated_at: 200, snippet: '节选…' },
        ] })
      }) as unknown as typeof fetch,
    })
    const hits = await source.searchGrouped({
      query: 'x', kinds: ['user/message', 'tool/call'],
      archived: 'active', from: 1, to: 2, sortBy: 'time', limit: 5,
    })
    assert.ok(seenUrl.includes('op=search'), seenUrl)
    assert.ok(seenUrl.includes('group=session'))
    assert.ok(seenUrl.includes('kinds=user%2Fmessage%2Ctool%2Fcall'))
    assert.ok(seenUrl.includes('archived=active'))
    assert.ok(seenUrl.includes('sort=time'))
    // 缺省不展开：旧请求形状零变化（expand 参数缺席）
    assert.ok(!seenUrl.includes('expand='), seenUrl)
    assert.deepEqual(hits, [{ sessionId: 's1', title: 'T', seq: 7, type: 'user/message', time: 100, updatedAt: 200, snippet: '节选…' }])
  })
  it('expand=true 透传 wire（面板「分开显示」开关 → DRS expand=1 臂）', async () => {
    let seenUrl = ''
    const source = new DrsCorpusSource({
      baseUrl: 'http://127.0.0.1:5990',
      fetchImpl: (async (input: unknown) => {
        seenUrl = String(input)
        return jsonResponse({ ok: true, query: 'x', hits: [
          { session_id: 's1', title: 'T', seq: 7, type: 'user/message', time: 100, updated_at: 200, snippet: '甲…' },
          { session_id: 's1', title: 'T', seq: 9, type: 'assistant/message', time: 140, updated_at: 200, snippet: '乙…' },
        ] })
      }) as unknown as typeof fetch,
    })
    const hits = await source.searchGrouped({ query: 'x', expand: true })
    assert.ok(seenUrl.includes('expand=1'), seenUrl)
    // 同会话两行各自成命中（行键 (sessionId,seq) 唯一性由消费侧保证）
    assert.equal(hits.length, 2)
    assert.deepEqual(hits.map(h => h.seq), [7, 9])
  })
  it('probe:包络 ok=true 报真、网络失败报假且不抛', async () => {
    const up = new DrsCorpusSource({
      baseUrl: 'http://x',
      fetchImpl: (async () => jsonResponse({ ok: true, sessions: 3 })) as unknown as typeof fetch,
    })
    assert.equal(await up.probe(), true)
    const down = new DrsCorpusSource({
      baseUrl: 'http://x',
      fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch,
    })
    assert.equal(await down.probe(), false)
  })
})
