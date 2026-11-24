#!/usr/bin/env node
/**
 * The session-open dispatch has exactly one owner and one precedence.
 *
 * Why this test exists
 * --------------------
 * Host 0.1.7 dropped `open` from the client `sessions` contract ("navigation
 * belongs to view owners") and moved it to `uiWorkspace.openSession`. The
 * jump kept calling `sessions.open` behind a `typeof === 'function'` guard,
 * which turned the missing method into a silent no-op: on every 0.1.7/0.2.0
 * host, clicking a search hit closed the panel and nothing happened, with no
 * console signal. The React render path is not exercised by this suite (see
 * the note in `client-panel-key.test.mjs`), so the dispatch itself is a pure
 * function (`openSessionThrough`) and this suite pins its whole face.
 *
 * What it proves: `uiWorkspace.openSession` wins when offered; `sessions.open`
 * is the legacy fallback; neither (or method-less faces) → silent no-op.
 * What it does NOT prove: that the panel wires `open` to result clicks — that
 * stays a GUI check.
 *
 * Usage: node --import tsx tests/client-open-session.test.mjs
 */
import assert from 'node:assert/strict'
import { openSessionSafely, openSessionThrough } from '../src/client/host-api.ts'

// 0.1.7+ hosts: uiWorkspace wins, sessions is never touched.
{
  const calls = []
  openSessionThrough((name) => (name === 'uiWorkspace'
    ? { openSession: (id) => { calls.push(['uiWorkspace', id]) } }
    : { open: (id) => { calls.push(['sessions', id]) } }), 's1')
  assert.deepEqual(calls, [['uiWorkspace', 's1']])
}

// Pre-0.1.7 hosts: sessions.open is the legacy fallback.
{
  const calls = []
  openSessionThrough((name) => (name === 'sessions'
    ? { open: (id) => { calls.push(['sessions', id]) } }
    : undefined), 's2')
  assert.deepEqual(calls, [['sessions', 's2']])
}

// Neither face, or faces without the method: silent no-op, never a throw —
// the exact property that used to hide the breakage.
{
  openSessionThrough(() => undefined, 's3')
  openSessionThrough(() => ({}), 's4')
  // A method-less uiWorkspace must not stop the fallback chain: an unknown
  // future host shape still reaches sessions.open.
  const calls = []
  openSessionThrough((name) => (name === 'uiWorkspace'
    ? {}
    : { open: (id) => { calls.push(['sessions', id]) } }), 's5')
  assert.deepEqual(calls, [['sessions', 's5']])
}

console.log('client-open-session: dispatch precedence + silent-degradation ok')

/* ── openSessionSafely：一次点击即跳转 + 失败不爆炸 ───────────────── */

function services(order, { open } = {}) {
  return (name) => (name === 'uiWorkspace'
    ? { openSession: (id) => { order.push('open:' + id); open?.(id) } }
    : undefined)
}

{
  // 关键顺序：先撤面板页（selectPanel(null)），再让宿主切主栏。
  // 顺序反了就是「第一次点击只撤页、要再点一次」的双击症状。
  const order = []
  const outcome = openSessionSafely(services(order), 's1', { exitPanel: () => { order.push('exit') } })
  assert.equal(outcome.ok, true)
  assert.deepEqual(order, ['exit', 'open:s1'])
}

{
  // 空白 id：直接失败，且不去动面板页（避免「撤了页却跳不过去」）。
  const order = []
  const outcome = openSessionSafely(services(order), '   ', { exitPanel: () => { order.push('exit') } })
  assert.equal(outcome.ok, false)
  assert.deepEqual(order, [])
  assert.match(String(outcome.error), /id/)
}

{
  // 导航服务缺席：提前失败，面板保持原样。
  const outcome = openSessionSafely(() => undefined, 's1', { exitPanel: () => { throw new Error('不该被调用') } })
  assert.equal(outcome.ok, false)
  assert.match(String(outcome.error), /导航/)
}

{
  // 导航抛错：转成 error 返回（不抛），管理台据此就地提示而不白屏。
  const outcome = openSessionSafely(services([], { open: () => { throw new Error('会话已删除') } }), 'gone')
  assert.equal(outcome.ok, false)
  assert.match(String(outcome.error), /会话已删除/)
}

{
  // 退页自己抛错：不阻断导航，仍然算成功。
  const order = []
  const outcome = openSessionSafely(services(order), 's2', { exitPanel: () => { throw new Error('layout 炸了') } })
  assert.equal(outcome.ok, true)
  assert.deepEqual(order, ['open:s2'])
}

{
  // 退页失败但导航也失败：两条错误都不能逸出（只回导航错误）。
  const outcome = openSessionSafely(services([], { open: () => { throw new Error('nav down') } }), 's3', {
    exitPanel: () => { throw new Error('exit down') },
  })
  assert.equal(outcome.ok, false)
  assert.match(String(outcome.error), /nav down/)
}

{
  // defer（整页形态）：退页同步发生，导航延到下一帧——这才是一次点击就跳过去的关键。
  const order = []
  const errors = []
  const outcome = openSessionSafely(services(order), 's4', {
    defer: true,
    exitPanel: () => { order.push('exit') },
    onDeferredError: message => { errors.push(message) },
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.deferred, true)
  assert.deepEqual(order, ['exit'], '退页必须是同步的（点击帧内就关页）')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(order, ['exit', 'open:s4'], '导航必须在下一帧才执行')
  assert.deepEqual(errors, [])
}

{
  // defer + 导航抛错：restorePanel 把面板页拉回，错误交给 onDeferredError（不抛）。
  const order = []
  const errors = []
  openSessionSafely(services(order, { open: () => { throw new Error('延迟炸了') } }), 's5', {
    defer: true,
    restorePanel: () => { order.push('restore') },
    onDeferredError: message => { errors.push(message) },
  })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(order, ['open:s5', 'restore'])
  assert.match(String(errors[0]), /延迟炸了/)
}

console.log('client-open-session: openSessionSafely exit-first + no-throw ok')
