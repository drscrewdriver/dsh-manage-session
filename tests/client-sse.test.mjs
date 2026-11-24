#!/usr/bin/env node
/**
 * 客户端 SSE 解析与标题流的回归（node 侧，纯 JS + 假 fetch）。
 *
 * 为什么值得单独测
 * ----------------
 * 面板与宿主之间的这个协议是**手写**的（fenced 路由只收 POST，`EventSource`
 * 做不到 POST + body），最容易错在两处：
 * 1. 帧边界：`\n\n` 会被 TCP/HTTP 分块从中间切开，残块必须留到下一轮；
 * 2. 容错：心跳行（`: ping`）、多行 `data:`、坏 JSON 都不能把整条流打死 ——
 *    流挂了列表必须仍然可用。
 *
 * 用法：node --import tsx tests/client-sse.test.mjs
 */
import assert from 'node:assert/strict'
import { parseSseBlock, streamCatalogTitles } from '../src/client/host-api.ts'

/* ── 1. parseSseBlock：单帧解析 ───────────────────────────────── */

assert.deepEqual(parseSseBlock('data: {"a":1}'), { event: 'message', data: '{"a":1}' })
assert.deepEqual(parseSseBlock('event: done\ndata: {"resolved":2}'), { event: 'done', data: '{"resolved":2}' })
// 容忍 CRLF（某些中间层会改写换行）。
assert.deepEqual(parseSseBlock('event: done\r\ndata: [1]'), { event: 'done', data: '[1]' })
// 多行 data 按规范以 \n 连接。
assert.deepEqual(parseSseBlock('data: line1\ndata: line2'), { event: 'message', data: 'line1\nline2' })
// 冒号后无空格、以及字段名未知（如 id/retry）都要能吃下。
assert.deepEqual(parseSseBlock('data:tight'), { event: 'message', data: 'tight' })
assert.deepEqual(parseSseBlock('id: 7\ndata: x'), { event: 'message', data: 'x' })
// 心跳/注释帧与空行不产出消息。
assert.equal(parseSseBlock(': ping'), undefined)
assert.equal(parseSseBlock(''), undefined)
assert.equal(parseSseBlock('\n\n'), undefined)

/* ── 2. streamCatalogTitles：跨块拼接 + 心跳 + done + 容错 ──────── */

const realFetch = globalThis.fetch

/** 用固定分块序列假造一条 SSE 响应。 */
function mockStream(chunks, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder()
  globalThis.fetch = async () => ({
    ok,
    status,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  })
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

{
  const titles = []
  let done = null
  // 关键用例：一条完整帧被切成三段（含 `\n` 与第二个 `\n` 分属不同块）。
  mockStream([
    'data: {"sessionId":"s1","title":"半',
    '径","source":"prefix"}\n',
    '\ndata: {"sessionId":"s2","source":"none","bytesRead":0,"frames":0}\n\n',
    ': ping\n\n',
    'data: not-json\n\n',
    'event: done\n',
    'data: {"resolved":1,"pending":1}\n\n',
  ])
  streamCatalogTitles(['s1', 's2'], {
    onTitle: event => { titles.push(event) },
    onDone: summary => { done = summary },
  })
  await settle()
  assert.equal(titles.length, 2, '坏 JSON 帧必须被丢弃而不是计数')
  assert.equal(titles[0].sessionId, 's1')
  assert.equal(titles[0].title, '半径')
  assert.equal(titles[1].source, 'none')
  assert.deepEqual(done, { resolved: 1, pending: 1 })
  console.log('client-sse: 跨块拼接 / 心跳忽略 / 坏 JSON 容错 / done 汇总 ok')
}

{
  // HTTP 失败必须走 onError（不抛），列表据此把 pending 降为「无标题」。
  const errors = []
  mockStream([], { ok: false, status: 500 })
  streamCatalogTitles(['s1'], { onTitle: () => {}, onError: message => { errors.push(message) } })
  await settle()
  assert.deepEqual(errors, ['HTTP 500'])
  console.log('client-sse: HTTP 失败经 onError 汇报 ok')
}

{
  // abort 后不发任何事件：面板关闭 / 重取时宿主必须立刻停读。
  const encoder = new TextEncoder()
  let controllerRef = null
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controllerRef = controller
        controller.enqueue(encoder.encode('data: {"sessionId":"s1","title":"late"}\n\n'))
      },
    }),
  })
  const titles = []
  let errors = 0
  const handle = streamCatalogTitles(['s1'], {
    onTitle: event => { titles.push(event) },
    onError: () => { errors += 1 },
  })
  await settle()
  handle.abort()
  controllerRef?.error(new Error('aborted by client'))
  await settle()
  assert.equal(errors, 0, 'abort 是主动行为，不得报错')
  assert.equal(titles.length, 1, 'abort 之前已到达的帧照常交付')
  console.log('client-sse: abort 静默停止 ok')
}

globalThis.fetch = realFetch
console.log('client-sse: all ok')
