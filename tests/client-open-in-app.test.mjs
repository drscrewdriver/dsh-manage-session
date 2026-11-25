#!/usr/bin/env node
/**
 * client-open-in-app: 路由常量、应用选择优先级、错误映射、fetch 注入。
 *
 * 覆盖 spec R5-R6 R7：
 * - pickExplorerApp: explorer/finder/filemanager 优先级
 * - pickGitApp: gitbash 优先，退 GitHub Desktop
 * - payload 非数组/无 apps 字段 → undefined
 * - openInAppFailure: 401 提示；其他取 message/code
 * - fetchOpenInApps: 200 有集；401/404 → 空集；fetch 抛异常 → 空集
 * - launchOpenInApp: 绝对路径成功；空/相对路径拒绝；200/401/404
 *
 * Usage: node --import tsx tests/client-open-in-app.test.mjs
 */
import assert from 'node:assert/strict'
import {
  pickExplorerApp,
  pickGitApp,
  openInAppFailure,
  fetchOpenInApps,
  launchOpenInApp,
  OPEN_IN_APP_APPS_ROUTE,
  OPEN_IN_APP_OPEN_ROUTE,
} from '../src/client/open-in-app.ts'

// ── 路由常量 ──────────────────────────────────────────────────────────────────

assert.equal(OPEN_IN_APP_APPS_ROUTE, 'open-in-app/apps')
assert.equal(OPEN_IN_APP_OPEN_ROUTE, 'open-in-app/open')

// ── pickExplorerApp ───────────────────────────────────────────────────────────

// Windows: explorer
{
  assert.equal(pickExplorerApp({ apps: ['explorer', 'gitbash'] }), 'explorer')
}

// macOS: finder（explorer 不在列表）
{
  assert.equal(pickExplorerApp({ apps: ['finder', 'sourcetree'] }), 'finder')
}

// Linux: filemanager
{
  assert.equal(pickExplorerApp({ apps: ['filemanager'] }), 'filemanager')
}

// explorer 优先级高于 finder（同时存在）
{
  assert.equal(pickExplorerApp({ apps: ['finder', 'explorer'] }), 'explorer')
}

// 无 explorer 类 → undefined
{
  assert.equal(pickExplorerApp({ apps: ['gitbash'] }), undefined)
}

// payload 为 null / 非对象 / apps 非数组
{
  assert.equal(pickExplorerApp(null), undefined)
  assert.equal(pickExplorerApp({}), undefined)
  assert.equal(pickExplorerApp({ apps: 'not-array' }), undefined)
}

// ── pickGitApp ────────────────────────────────────────────────────────────────

// gitbash 优先
{
  assert.equal(pickGitApp({ apps: ['github', 'gitbash'] }), 'gitbash')
}

// 无 gitbash → github
{
  assert.equal(pickGitApp({ apps: ['fork', 'github'] }), 'github')
}

// 只有 sourcetree
{
  assert.equal(pickGitApp({ apps: ['sourcetree'] }), 'sourcetree')
}

// 无 git 工具 → undefined
{
  assert.equal(pickGitApp({ apps: ['explorer'] }), undefined)
}

// ── openInAppFailure ──────────────────────────────────────────────────────────

// 401
{
  const msg = openInAppFailure(401, {})
  assert.ok(msg.includes('宿主未启用'), '401 → 宿主未启用提示')
}

// 有 message
{
  const msg = openInAppFailure(400, { message: '路径不存在' })
  assert.equal(msg, '路径不存在')
}

// 有 code 无 message
{
  const msg = openInAppFailure(404, { code: 'path-not-found' })
  assert.equal(msg, 'path-not-found')
}

// 无 payload → HTTP 文本
{
  const msg = openInAppFailure(500, null)
  assert.ok(msg.includes('HTTP 500'))
}

// ── fetchOpenInApps ───────────────────────────────────────────────────────────

// 200 → 有集
{
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ apps: ['explorer', 'gitbash'] }),
  })
  const apps = await fetchOpenInApps(fakeFetch)
  assert.ok(apps.has('explorer'))
  assert.ok(apps.has('gitbash'))
}

// 401 → 空集
{
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({}) })
  const apps = await fetchOpenInApps(fakeFetch)
  assert.equal(apps.size, 0)
}

// 404 → 空集
{
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
  const apps = await fetchOpenInApps(fakeFetch)
  assert.equal(apps.size, 0)
}

// fetch 抛异常 → 空集（不穿透）
{
  const fakeFetch = async () => { throw new Error('network down') }
  const apps = await fetchOpenInApps(fakeFetch)
  assert.equal(apps.size, 0)
}

// ── launchOpenInApp ───────────────────────────────────────────────────────────

// 空路径拒绝
{
  const res = await launchOpenInApp('explorer', '')
  assert.equal(res.ok, false)
}

// 相对路径拒绝
{
  const res = await launchOpenInApp('explorer', 'relative/path')
  assert.equal(res.ok, false)
}

// 空 app 拒绝
{
  const res = await launchOpenInApp('', '/some/path')
  assert.equal(res.ok, false)
}

// 200 成功
{
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  const res = await launchOpenInApp('explorer', 'C:\\projects', fakeFetch)
  assert.ok(res.ok)
}

// 401
{
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({}) })
  const res = await launchOpenInApp('gitbash', '/home/user', fakeFetch)
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('宿主未启用'))
}

// 400 + message
{
  const fakeFetch = async () => ({
    ok: false, status: 400,
    json: async () => ({ message: 'app 不可用' }),
  })
  const res = await launchOpenInApp('gitbash', 'C:\\nope', fakeFetch)
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('app 不可用'))
}

// fetch 网络异常 → {ok:false}（不抛）
{
  const fakeFetch = async () => { throw new Error('ECONNREFUSED') }
  const res = await launchOpenInApp('explorer', '/tmp', fakeFetch)
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('ECONNREFUSED'))
}

console.log('client-open-in-app: all ok')
