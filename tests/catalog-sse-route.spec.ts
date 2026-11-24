/**
 * `session-catalog-stream` 路由的真 HTTP 端到端回归。
 *
 * 前面的单测只覆盖「编排」与「解析」，这里补上协议层：真的起一个 http server，
 * 真的把 zstd 帧写进临时 dshHome，真的用 `fetch` 读响应 —— 断言的是面板实际
 * 依赖的四件事：
 * 1. 响应头是 `text/event-stream` + `no-cache` + `x-accel-buffering: no`；
 * 2. 每条会话一个 `data:` 帧（命中带 title，无日志的落 `source:'none'`）；
 * 3. 末尾 `event: done` 的 `resolved + pending` 等于请求的 pending 数；
 * 4. 首屏（`session-catalog`）在**没有宿主三服务**时仍然返回列表而不是 500。
 */
import { type AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { handleMethod, serveCatalogStream, type StewardRuntime } from '../src/index.ts'
import { TitleMemo } from '../src/host/catalog/title-source.ts'

const HEADER = { type: 'session', version: 1, id: 'session-a', createdAt: 1, cwd: 'C:/tmp' }

function frame(rows: readonly unknown[]): Buffer {
  return zstdCompressSync(Buffer.from(`${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8'))
}

/** 造一个只有分帧日志、没有投影缓存/没有宿主服务的 dshHome。 */
function makeHome(): { home: string; ids: string[] } {
  const home = mkdtempSync(join(tmpdir(), 'steward-sse-'))
  const withTitle = join(home, 'sessions', 'ws-1', 'session-a')
  const withoutTitle = join(home, 'sessions', 'ws-1', 'session-b')
  mkdirSync(withTitle, { recursive: true })
  mkdirSync(withoutTitle, { recursive: true })
  writeFileSync(join(withTitle, 'session.v1.jsonl.zstd'), Buffer.concat([
    frame([HEADER]),
    frame([{ type: 'message/user', seq: 1, time: 1, data: { text: 'hi' } }]),
    frame([{ type: 'session/title', seq: 2, time: 2, data: { title: '流式标题' } }]),
  ]))
  writeFileSync(join(withoutTitle, 'session.v1.jsonl.zstd'), frame([HEADER]))
  return { home, ids: ['session-a', 'session-b', 'im:union:feishu:dm:no-file'] }
}

function runtimeFor(home: string, ids: readonly string[]): StewardRuntime {
  return {
    config: () => ({ enabled: true, historyFiles: true, healthCheck: true, directDelete: false }),
    dshHome: home,
    // 宿主三服务全缺席：标题只能靠分帧流（最坏场景）。
    ctx: { get: () => undefined },
    registry: () => undefined,
    projectionStateFor: () => undefined,
    attribute: () => undefined,
    log: () => {},
    titles: new TitleMemo(),
    sessionQuery: () => ({
      listSessions: async () => ids.map(id => ({ header: { id, version: 1, createdAt: 1 }, live: false, persisted: true })),
    }),
  }
}

/** 起一个只服务 `session-catalog-stream` 的真 HTTP 服务。 */
async function listen(runtime: StewardRuntime): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const payload = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      void serveCatalogStream(req, res, payload, runtime)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/manage-session/api/session-catalog-stream`,
    close: () => new Promise<void>(resolve => { server.close(() => { resolve() }) }),
  }
}

describe('session-catalog + session-catalog-stream（真 HTTP）', () => {
  it('首屏在没有宿主服务时仍返回列表（titleSource 全为 pending/none）', async () => {
    const { home, ids } = makeHome()
    const result = await handleMethod('session-catalog', {}, runtimeFor(home, ids)) as {
      ok: boolean
      items?: { sessionId: string; title: string; titleSource: string }[]
      pending?: number
      error?: string
    }
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(3)
    expect(result.items?.every(item => item.title === '' || item.titleSource !== undefined)).toBe(true)
    // 三条都会进 pending（a/b 需要分帧读，im:* 没有日志但由流一次判 none）。
    expect(result.pending).toBe(3)
  })

  it('SSE：逐条帧 + done 汇总 + 正确的响应头', async () => {
    const { home, ids } = makeHome()
    const runtime = runtimeFor(home, ids)
    const service = await listen(runtime)
    try {
      const res = await fetch(service.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('x-accel-buffering')).toBe('no')
      const text = await res.text()
      const frames = text.split('\n\n').filter(block => block.startsWith('data: '))
      const events = frames.map(block => JSON.parse(block.slice('data: '.length)) as {
        sessionId: string
        title?: string
        source: string
      })
      expect(events).toHaveLength(3)
      expect(new Set(events.map(event => event.sessionId))).toEqual(new Set(ids))
      const titled = events.find(event => event.sessionId === 'session-a')
      expect(titled?.title).toBe('流式标题')
      expect(titled?.source).toBe('prefix')
      expect(events.find(event => event.sessionId === 'im:union:feishu:dm:no-file')?.source).toBe('none')

      const doneBlock = text.split('\n\n').find(block => block.startsWith('event: done'))
      expect(doneBlock).toBeDefined()
      const summary = JSON.parse((doneBlock ?? '').split('\n').find(line => line.startsWith('data: '))?.slice('data: '.length) ?? '{}') as {
        resolved: number
        pending: number
      }
      expect(summary.resolved).toBe(1)
      expect(summary.pending).toBe(2)
      expect(summary.resolved + summary.pending).toBe(3)
    } finally {
      await service.close()
    }
  })

  it('显式 sessionIds 只读这些，且与缺省路径同一事件形状', async () => {
    const { home, ids } = makeHome()
    const service = await listen(runtimeFor(home, ids))
    try {
      const res = await fetch(service.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionIds: ['session-b'] }),
      })
      const text = await res.text()
      const events = text.split('\n\n')
        .filter(block => block.startsWith('data: '))
        .map(block => JSON.parse(block.slice('data: '.length)) as { sessionId: string; source: string })
      expect(events).toHaveLength(1)
      expect(events[0]?.sessionId).toBe('session-b')
      expect(events[0]?.source).toBe('none')
    } finally {
      await service.close()
    }
  })
})
