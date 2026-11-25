#!/usr/bin/env node
/**
 * client-session-actions: 读面 + 能力判定 + 排序 + 写面（pin/rename/fork）。
 *
 * 覆盖 spec R1-R3 R7：
 * - togglePin: pin/unpin 调用；归档 guard；缺服务/缺方法 → {ok:false}
 * - renameSession: trim 空拒绝；sessions.using 调用；ok:false 转 error.message
 * - forkSession: uiWorkspace.forkSession 回 childId；缺服务 → {ok:false}
 * - readPinnedIds / readArchivedIds / readLiveIds: 服务缺席 → 空集/undefined
 * - sortPinnedFirst: 置顶前置，相对顺序稳定
 * - capabilitiesOf: 三态（archived/live undefined/live false）
 *
 * Usage: node --import tsx tests/client-session-actions.test.mjs
 */
import assert from 'node:assert/strict'
import {
  readPinnedIds,
  readArchivedIds,
  readLiveIds,
  capabilitiesOf,
  sortPinnedFirst,
  togglePin,
  renameSession,
  forkSession,
} from '../src/client/session-actions.ts'

// ── readPinnedIds ─────────────────────────────────────────────────────────────

// 服务缺席 → 空集
{
  const empty = readPinnedIds(() => undefined)
  assert.equal(empty.size, 0, 'service missing → empty set')
}

// 服务存在但 list() 无 pinnedSessionIds → 空集
{
  const empty = readPinnedIds(() => ({ list: () => ({}) }))
  assert.equal(empty.size, 0, 'no pinnedSessionIds → empty set')
}

// 正常读取
{
  const ids = readPinnedIds(() => ({ list: () => ({ pinnedSessionIds: ['s1', 's2'] }) }))
  assert.ok(ids.has('s1'))
  assert.ok(ids.has('s2'))
  assert.equal(ids.size, 2)
}

// get() 抛异常 → 空集（不穿透）
{
  const ids = readPinnedIds(() => { throw new Error('boom') })
  assert.equal(ids.size, 0, 'get() throw → empty set, no crash')
}

// ── readArchivedIds ───────────────────────────────────────────────────────────

{
  const ids = readArchivedIds(() => ({ list: () => ({ archivedSessionIds: ['a1'] }) }))
  assert.ok(ids.has('a1'))
  assert.equal(ids.size, 1)
}

{
  const ids = readArchivedIds(() => undefined)
  assert.equal(ids.size, 0)
}

// ── readLiveIds ───────────────────────────────────────────────────────────────

// 服务缺席 → undefined
{
  const res = readLiveIds(() => undefined)
  assert.equal(res, undefined, 'sessions service missing → undefined')
}

// byId 为 Map
{
  const map = new Map([['s1', {}], ['s2', {}]])
  const ids = readLiveIds(() => ({ list: () => ({ byId: map }) }))
  assert.ok(ids?.has('s1'))
  assert.equal(ids?.size, 2)
}

// byId 为 plain object
{
  const ids = readLiveIds(() => ({ list: () => ({ byId: { s3: {}, s4: {} } }) }))
  assert.ok(ids?.has('s3'))
  assert.equal(ids?.size, 2)
}

// list() 无 byId → undefined
{
  const ids = readLiveIds(() => ({ list: () => ({}) }))
  assert.equal(ids, undefined, 'no byId → undefined')
}

// ── capabilitiesOf ────────────────────────────────────────────────────────────

// 活跃会话，live=true
{
  const caps = capabilitiesOf({ archived: false, live: true })
  assert.deepEqual(caps, { pin: true, rename: true, fork: true })
}

// 活跃会话，live=undefined（服务缺席）
{
  const caps = capabilitiesOf({ archived: false, live: undefined })
  assert.deepEqual(caps, { pin: true, rename: true, fork: true },
    'live unknown: rename/fork allowed (optimistic)')
}

// 活跃会话，live=false（明确非 live）
{
  const caps = capabilitiesOf({ archived: false, live: false })
  assert.deepEqual(caps, { pin: true, rename: false, fork: false },
    'non-live: pin ok, rename/fork disabled')
}

// 归档会话
{
  const caps = capabilitiesOf({ archived: true, live: true })
  assert.deepEqual(caps, { pin: false, rename: false, fork: false },
    'archived: all three disabled')
}

// ── sortPinnedFirst ───────────────────────────────────────────────────────────

// 无置顶：返回顺序不变
{
  const items = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }]
  const sorted = sortPinnedFirst(items, new Set())
  assert.deepEqual(sorted.map(x => x.sessionId), ['a', 'b', 'c'])
}

// 置顶 b 和 c：前置，相对顺序稳定
{
  const items = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }, { sessionId: 'd' }]
  const sorted = sortPinnedFirst(items, new Set(['b', 'c']))
  assert.deepEqual(sorted.map(x => x.sessionId), ['b', 'c', 'a', 'd'])
}

// 置顶全部：同序
{
  const items = [{ sessionId: 'x' }, { sessionId: 'y' }]
  const sorted = sortPinnedFirst(items, new Set(['x', 'y']))
  assert.deepEqual(sorted.map(x => x.sessionId), ['x', 'y'])
}

// ── togglePin ─────────────────────────────────────────────────────────────────

// 正常 pin
{
  const calls = []
  const get = (name) => {
    if (name === 'uiWorkspace') return {
      pinSession: (id) => { calls.push(['pin', id]) },
      unpinSession: (id) => { calls.push(['unpin', id]) },
    }
    return undefined
  }
  const res = await togglePin(get, 's1', true)
  assert.ok(res.ok)
  assert.deepEqual(calls, [['pin', 's1']])
}

// 正常 unpin
{
  const calls = []
  const get = (name) => {
    if (name === 'uiWorkspace') return {
      pinSession: (id) => { calls.push(['pin', id]) },
      unpinSession: (id) => { calls.push(['unpin', id]) },
    }
    return undefined
  }
  const res = await togglePin(get, 's2', false)
  assert.ok(res.ok)
  assert.deepEqual(calls, [['unpin', 's2']])
}

// 归档 guard：togglePin 内先读 readArchivedIds
{
  const get = (name) => {
    if (name === 'workspaces') return { list: () => ({ archivedSessionIds: ['g1'] }) }
    if (name === 'uiWorkspace') return { pinSession: () => {} }
    return undefined
  }
  const res = await togglePin(get, 'g1', true)
  assert.equal(res.ok, false, 'archived session pin → error')
  assert.ok(res.error?.includes('归档'))
}

// 缺 uiWorkspace → error
{
  const res = await togglePin(() => undefined, 's9', true)
  assert.equal(res.ok, false)
}

// uiWorkspace 存在但缺 pinSession 方法 → error
{
  const get = (name) => name === 'uiWorkspace' ? {} : undefined
  const res = await togglePin(get, 's8', true)
  assert.equal(res.ok, false)
}

// ── renameSession ─────────────────────────────────────────────────────────────

// trim 空名 → error
{
  const res = await renameSession(() => undefined, 's1', '   ')
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('空'))
}

// 缺 sessions.using → error
{
  const res = await renameSession(() => undefined, 's1', 'New Title')
  assert.equal(res.ok, false)
}

// 正常 rename
{
  const calls = []
  const get = (name) => {
    if (name === 'sessions') return {
      using: (id, opts, fn) => {
        calls.push([id, opts.source])
        const r = { binding: { session: { rename: (title) => { calls.push(['rename', title]); return { ok: true } } } } }
        return fn(r)
      },
    }
    return undefined
  }
  const res = await renameSession(get, 's5', '  My Session  ')
  assert.ok(res.ok)
  assert.deepEqual(calls, [['s5', 'workspaceOperation'], ['rename', 'My Session']])
}

// rename 返回 ok:false
{
  const get = (name) => {
    if (name === 'sessions') return {
      using: (id, opts, fn) => {
        const r = { binding: { session: { rename: () => ({ ok: false, error: { message: '权限不足' } }) } } }
        return fn(r)
      },
    }
    return undefined
  }
  const res = await renameSession(get, 's6', 'Title')
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('权限不足'))
}

// ── forkSession ───────────────────────────────────────────────────────────────

// 缺 uiWorkspace → error
{
  const res = await forkSession(() => undefined, 's1')
  assert.equal(res.ok, false)
}

// 正常 fork，返回 childId
{
  const calls = []
  const get = (name) => {
    if (name === 'uiWorkspace') return {
      forkSession: (id, cb) => {
        calls.push(id)
        cb(null, 'child-001')
      },
    }
    return undefined
  }
  const res = await forkSession(get, 's7')
  assert.ok(res.ok)
  assert.equal(res.childId, 'child-001')
  assert.deepEqual(calls, ['s7'])
}

// fork 回调返回 error
{
  const get = (name) => {
    if (name === 'uiWorkspace') return {
      forkSession: (id, cb) => { cb(new Error('fork failed')) },
    }
    return undefined
  }
  const res = await forkSession(get, 's8')
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('fork failed'))
}

console.log('client-session-actions: all ok')
