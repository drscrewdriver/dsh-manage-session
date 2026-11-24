/**
 * 分帧标题流的并发编排回归。
 *
 * 四条性质，每条都对应一个真实故障面：
 * 1. **并发 ≤ 4**（与宿主读并发同档）：再多就会和宿主的冷读抢磁盘；
 * 2. **每条会话恰好一个事件**：命中 / `none` / `timeout` 三选一，不重不漏
 *    （否则客户端会一直停在「正在读取标题…」）；
 * 3. **预算到点即批量回报 `timeout`**：不允许一个大会话把整条流拖住；
 * 4. **abort 后停止消费并留痕**（`aborted after N frames`）：面板关了宿主不得
 *    继续解压日志。
 */
import { describe, expect, it } from 'vitest'
import { streamCatalogTitles, type CatalogTitleEvent } from '../src/host/catalog/stream.ts'
import type { CatalogTitleRecord } from '../src/host/catalog/title-source.ts'
import type { FrameTitleHit, FrameTitleOptions } from '../src/host/catalog/frame-title.ts'

const records = (count: number): CatalogTitleRecord[] =>
  Array.from({ length: count }, (_, index) => ({ id: `session-${index}`, header: { id: `session-${index}` } }))

const hit = (title?: string, frames = 3): FrameTitleHit => ({
  ...(title === undefined ? {} : { title }),
  source: title === undefined ? 'none' : 'prefix',
  bytesRead: 262_144,
  frames,
  windows: [262_144],
})

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('streamCatalogTitles：并发 + 预算 + 中止', () => {
  it('并发不超过 4，且每条会话恰好一个事件', async () => {
    const events: CatalogTitleEvent[] = []
    let inFlight = 0
    let peak = 0
    await streamCatalogTitles(records(12), {
      dshHome: '/nonexistent',
      signal: new AbortController().signal,
      locate: () => '/fake/session.log',
      readTitle: async (_file: string, _options?: FrameTitleOptions) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await delay(5)
        inFlight -= 1
        return hit('t')
      },
      onTitle: event => { events.push(event) },
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(events).toHaveLength(12)
    expect(new Set(events.map(event => event.sessionId)).size).toBe(12)
    expect(events.every(event => event.source === 'prefix' && event.title === 't')).toBe(true)
  })

  it('超过预算的会话一次性回报 timeout（不重不漏）', async () => {
    const events: CatalogTitleEvent[] = []
    const logs: string[] = []
    await streamCatalogTitles(records(12), {
      dshHome: '/nonexistent',
      signal: new AbortController().signal,
      // 预算 10 ms、单条 25 ms：首轮 4 条读完时预算早已耗尽，剩下 8 条必为 timeout。
      budgetMs: 10,
      locate: () => '/fake/session.log',
      readTitle: async () => {
        await delay(25)
        return hit('slow')
      },
      onTitle: event => { events.push(event) },
      log: message => { logs.push(message) },
    })
    expect(events).toHaveLength(12)
    expect(new Set(events.map(event => event.sessionId)).size).toBe(12)
    expect(events.some(event => event.source === 'timeout')).toBe(true)
    // 命中过的会话仍是真实结论，未命中才是 timeout —— 两者互斥。
    for (const event of events) {
      if (event.source === 'timeout') expect(event.title).toBeUndefined()
      else expect(event.source).toBe('prefix')
    }
    expect(logs.some(message => message.includes('aborted'))).toBe(false)
  })

  it('abort 后停止消费，并留下 aborted after N frames', async () => {
    const controller = new AbortController()
    const events: CatalogTitleEvent[] = []
    const logs: string[] = []
    const pending = streamCatalogTitles(records(40), {
      dshHome: '/nonexistent',
      signal: controller.signal,
      locate: () => '/fake/session.log',
      readTitle: async (_file: string, options?: FrameTitleOptions) => {
        await delay(25)
        // 真实现（readTitleByFrames）在中止时会抛 AbortError；桩也照这个契约来。
        options?.signal?.throwIfAborted()
        return hit('t', 2)
      },
      onTitle: event => { events.push(event) },
      log: message => { logs.push(message) },
    })
    await delay(12)
    controller.abort()
    await pending
    // 中止发生在首轮读完成之前：一条结果都不会再交回，也不可能把 40 条读完。
    expect(events).toHaveLength(0)
    expect(logs.some(message => message.includes('aborted after'))).toBe(true)
  })

  it('磁盘上没有日志的会话直接 none（不重试、不抛错）', async () => {
    const events: CatalogTitleEvent[] = []
    await streamCatalogTitles(records(3), {
      dshHome: '/nonexistent',
      signal: new AbortController().signal,
      locate: () => undefined,
      readTitle: async () => { throw new Error('不该被调用') },
      onTitle: event => { events.push(event) },
    })
    expect(events).toHaveLength(3)
    expect(events.every(event => event.source === 'none' && event.frames === 0)).toBe(true)
  })

  it('单条读失败不影响其余会话', async () => {
    const events: CatalogTitleEvent[] = []
    const logs: string[] = []
    await streamCatalogTitles(records(4), {
      dshHome: '/nonexistent',
      signal: new AbortController().signal,
      locate: id => (id === 'session-1' ? undefined : '/fake/session.log'),
      readTitle: async (file: string) => {
        if (events.length === 0) throw new Error('首条炸了')
        await delay(1)
        return hit(file === '/fake/session.log' ? 'ok' : undefined)
      },
      onTitle: event => { events.push(event) },
      log: message => { logs.push(message) },
    })
    expect(events).toHaveLength(4)
    expect(events.filter(event => event.source === 'none').length).toBeGreaterThanOrEqual(2)
    expect(events.filter(event => event.title === 'ok').length).toBeGreaterThanOrEqual(1)
    expect(logs.some(message => message.includes('title frame read failed'))).toBe(true)
  })

  it('空输入不触发任何事件（也不抛错）', async () => {
    const events: CatalogTitleEvent[] = []
    await streamCatalogTitles([], {
      dshHome: '/nonexistent',
      signal: new AbortController().signal,
      onTitle: event => { events.push(event) },
    })
    expect(events).toHaveLength(0)
  })
})
