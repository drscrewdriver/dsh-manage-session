#!/usr/bin/env node
/**
 * 合并包 client bundle 的注册面，proven against the built client bundle.
 *
 * What it proves (and what it does NOT):
 * - `lib/client.js` materializes without any release-specific specifier，工厂 id
 *   为包名 `dsh-manage-session`（ModuleLoader 组合键 = 包名）。
 * - 恰好一枚 sidebar.footer.action 入口（会话管理，order 6，id = 包名）；一张 dsh-family.tab 设置卡；
 *   一张 key=包名的 plugins.bundle.config 复合卡；不占用 settings.* 席位
 *   （家族节兜底 host 走 2600ms 宽限期，本夹具无 entries 面必然落败——按设计）。
 * - 入口位次：宿主同时声明 `sidebar.panellist` + `main` 时改注册两行面板 + 两个主栏页
 *   （id/key = manage-session-search / manage-session，order 5/6），底栏入口不出现；
 *   只声明其一 → 回落底栏。
 * - scope 绑定：configForms 以 entry id `dsh-manage-session` 取句柄；缺失时
 *   回退 webServer 设置桥 scope（settings-describe/mutate，T20-b）——settingsScope
 *   bind 是数据死路（台账 A2），不再绑定任何命名空间。
 * - It does NOT render React, and it does NOT prove GUI behaviour.
 *
 * Usage: node tests/client-store.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(HERE, '..', 'lib', 'client.js')
const PLUGIN_ID = 'dsh-manage-session'
const STEWARD_ENTRY_ID = 'dsh-manage-session'
const STEWARD_NS = 'manage-session'
const SEARCH_NS = 'manage-session-search'

/** Module table the web shell seeds in both target releases (react family only here). */
const TABLE = {
  'react': {
    createElement: () => ({}), Fragment: {},
    useState: (v) => [v, () => {}], useEffect: () => {}, useMemo: (f) => f(),
    useRef: (v) => ({ current: v }), useSyncExternalStore: (sub, get) => get(),
  },
  'react-dom': { createPortal: () => ({}) },
}

/** Minimal DOM so the stylesheet effect can run headless. */
function documentStub() {
  const el = () => ({
    dataset: {}, style: {}, textContent: '', attributes: {},
    setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {},
    querySelectorAll: () => [], closest: () => null,
  })
  return {
    head: { appendChild: () => {} },
    documentElement: {},
    createElement: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
  }
}

/** Materialize the bundle and return its exports. */
function loadBundle() {
  const captured = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (reg) => captured.push(reg) } },
    document: documentStub(),
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: (fn) => fn(),
    setTimeout, clearTimeout, console,
    // legacy 设置桥在首次 subscribe 时发 describe：沙箱里给个固定失败响应，
    // 让桥停在 unavailable（不抛、不联网）。
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false }), text: async () => '' }),
  }
  sandbox.globalThis = sandbox
  runInNewContext(readFileSync(BUNDLE, 'utf8'), sandbox, { filename: 'lib/client.js' })
  assert.equal(captured.length, 1, 'bundle must register exactly one factory')
  const reg = captured[0]
  assert.equal(reg.id, PLUGIN_ID, `factory id "${reg.id}" !== "${PLUGIN_ID}"`)
  const seen = new Set()
  const exports = reg.factory((spec) => {
    seen.add(spec)
    assert.ok(spec in TABLE, `non-baseline require "${spec}"`)
    return TABLE[spec]
  })
  return { exports, seen }
}

/**
 * The settings seats each host LINE declares.
 *
 * ⚠️ **The seats are NOT mutually exclusive** — that assumption is exactly what
 * caused the card to render twice. Measured from host source: the 0.1.2 host
 * declares `settings.section` (ui-settings-general:650), `settings.plugins.tab`
 * (ui-settings-plugins:1781) and `settings.plugin.item` (same package :1793,
 * declared at runtime by its `configurable` contribution) **all at once**.
 *
 * So the 0.1.2 fixture models the real deployment; the 0.1.5 fixture models the
 * suspected rename (child seat gone, only the sibling tab left).
 */
const HOST_012_SEATS = [
  'sidebar.footer.action',
  'settings.section',
  'settings.plugins.tab',
  'settings.plugin.item',
  // 合并包新占的席位：家族 tab（thinking-levels 在场时由它声明）与
  // Plugins 页配置卡（0.1.7 宿主声明）。
  'dsh-family.tab',
  'plugins.bundle.config',
]

/** Client context that records slot registrations and namespace bindings. */
function clientCtx(ledger, bindings, { withScope = true, withConfigForms = true, declaredSlots = HOST_012_SEATS } = {}) {
  const disposer = () => {}
  const declared = new Set(declaredSlots)
  let snapshot = {
    status: 'ready',
    value: { enabled: false, defaultMode: 'title' },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: false,
    mode: 'host',
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => disposer,
    set: async () => {},
    unset: async () => {},
  }
  const slots = {
    // Real semantics: the callback fires only once the named seat is DECLARED.
    // The bundle relies on this for its two-seat (0.1.2 / 0.1.5) registration.
    inject: (name, fn) => { if (declared.has(name)) fn(); return disposer },
    register: (options) => {
      ledger.push(options)
      // 忠实夹具：注销真的从账本里摘除（否则「先注册后撤换」会被误判为两份并存）。
      return () => { const i = ledger.indexOf(options); if (i >= 0) ledger.splice(i, 1) }
    },
    // 家族兜底 host 探测面：报告 dsh-family 节已在场，宽限期定时器到点后走
    // early-return，不在测试进程里制造迟到注册或未捕获异常。
    entries: (name) => (name === 'settings.section' ? [{ options: { id: 'dsh-family' } }] : []),
    getVersion: () => 0,
    subscribe: () => disposer,
    // 席位声明探测面（0.2.x ui-slots）：只在 fixture 声明了该席位时返回 spec。
    // 入口位次判定靠它：两席位齐备才走顶栏工具行，否则回落底栏。
    specDynamic: (name) => (declared.has(name) ? { kind: name === 'main' ? 'keyed' : 'list' } : undefined),
  }
  return {
    ctx: {
      effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : disposer },
      on: () => disposer,
      get: (name) => {
        if (name === 'configForms') {
          if (!withConfigForms) return undefined
          return { get: (entryId) => { bindings.push(entryId); return scope } }
        }
        if (name === 'settingsScope') {
          if (!withScope) return undefined
          return { bind: (spec) => { bindings.push(spec.namespace); return scope } }
        }
        if (name === 'slots') return slots
        return undefined
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      slots,
    },
    setSnapshot: (next) => { snapshot = next },
  }
}

let failures = 0
const line = (s) => process.stdout.write(`${s}\n`)
/**
 * Checks are COLLECTED and run (in order, awaited) at the end of the file.
 * They cannot run inline any more: one of them has to wait out the bundle's
 * seat-probe window, and an inline sync runner would print the summary before
 * that promise settled — i.e. it would report PASS before the check ran.
 */
const checks = []
const check = (name, fn) => {
  checks.push([name, fn])
}

line('=== dsh-manage-session merged client registrations ===')

const { exports, seen } = loadBundle()
check('bundle materializes with only baseline specifiers', () => {
  for (const spec of seen) assert.ok(!/dsh-client-(runtime|store|ui-settings-general)/.test(spec), `release-specific require "${spec}"`)
  assert.equal(typeof exports.apply, 'function', 'client half exports no apply()')
})

check('registers exactly ONE sidebar footer entry (the manager)', () => {
  const ledger = []
  const { ctx } = clientCtx(ledger, [])
  exports.apply(ctx)
  const footer = ledger.filter((o) => o.name === 'sidebar.footer.action')
  assert.equal(footer.length, 1, `expected one footer entry, got ${footer.length}: ${JSON.stringify(ledger.map((o) => o.name))}`)
  assert.deepEqual(footer.map((o) => o.id), [STEWARD_ENTRY_ID])
  assert.deepEqual(footer.map((o) => o.order), [6])
})

/** 0.2.x 宿主：顶栏工具行席位（面板行 + 主栏整页）齐备。 */
const HOST_TOP_TOOL_SEATS = [...HOST_012_SEATS, 'sidebar.panellist', 'main']
/** 面板行 id / 主栏页 key（与底栏入口 id 分属两套命名空间）。 */
const TOP_MANAGER_ID = 'manage-session'

check('top tool seat present: one panel row (order 6) + one main page, NO footer entry', () => {
  const ledger = []
  const { ctx, setSnapshot } = clientCtx(ledger, [], { declaredSlots: HOST_TOP_TOOL_SEATS })
  setSnapshot({ status: 'ready', value: { enabled: true, healthCheck: true }, revision: 1, writable: true })
  exports.apply(ctx)
  const rows = ledger.filter((o) => o.name === 'sidebar.panellist')
  assert.equal(rows.length, 1, `expected one panel row, got ${rows.length}: ${JSON.stringify(ledger.map((o) => o.name))}`)
  assert.deepEqual(rows.map((o) => o.id), [TOP_MANAGER_ID])
  assert.deepEqual(rows.map((o) => o.order), [6], 'row must sit between the Plugins row (0) and the More launcher')
  const pages = ledger.filter((o) => o.name === 'main')
  assert.equal(pages.length, 1, `expected one main page, got ${pages.length}`)
  assert.deepEqual(pages.map((o) => o.key), [TOP_MANAGER_ID], 'page key must equal the panel row id')
  assert.equal(ledger.filter((o) => o.name === 'sidebar.footer.action').length, 0, 'footer entry must yield to the top tool row')
})

check('only one of the two seats declared: falls back to the footer entry', () => {
  const ledger = []
  const { ctx } = clientCtx(ledger, [], { declaredSlots: [...HOST_012_SEATS, 'sidebar.panellist'] })
  exports.apply(ctx)
  assert.equal(ledger.filter((o) => o.name === 'sidebar.panellist').length, 0, 'a half-declared seat must not be used')
  assert.equal(ledger.filter((o) => o.name === 'sidebar.footer.action').length, 1, 'footer fallback must stay')
})

check('registers ONE family tab card and ONE plugins-page card', () => {
  const ledger = []
  const { ctx } = clientCtx(ledger, [])
  exports.apply(ctx)
  const family = ledger.filter((o) => o.name === 'dsh-family.tab')
  assert.equal(family.length, 1, `expected one family tab card, got ${family.length}`)
  assert.deepEqual(family.map((o) => o.id), [STEWARD_ENTRY_ID])
  const plugins = ledger.filter((o) => o.name === 'plugins.bundle.config')
  assert.equal(plugins.length, 1, 'the plugins page card must be registered once')
  assert.equal(plugins[0].key, STEWARD_ENTRY_ID, 'plugins.bundle.config key must equal the package name')
})

check('occupies NO settings.* seat in the sync window', () => {
  const ledger = []
  const { ctx } = clientCtx(ledger, [], { declaredSlots: HOST_012_SEATS })
  exports.apply(ctx)
  assert.deepEqual(
    ledger.filter((o) => String(o.name).startsWith('settings.')).map((o) => o.name),
    [],
    'settings.* 席位只允许家族兜底 host 在宽限期后接管（夹具无 entries 面，必然落败）',
  )
  assert.ok(!ledger.map((o) => o.name).includes('settings.plugins.tab'))
  assert.ok(!ledger.map((o) => o.name).includes('settings.section'))
})

check('scope prefers configForms (entry id); legacy fallback = webServer settings bridge (no settingsScope bind)', () => {
  const formsLedger = []
  const formsBindings = []
  const { ctx } = clientCtx(formsLedger, formsBindings)
  exports.apply(ctx)
  assert.deepEqual(
    [...new Set(formsBindings)],
    [PLUGIN_ID],
    'configForms must be keyed by the profile entry id',
  )
  const legacyLedger = []
  const legacyBindings = []
  const { ctx: legacyCtx } = clientCtx(legacyLedger, legacyBindings, { withConfigForms: false, withScope: true })
  exports.apply(legacyCtx)
  assert.deepEqual(
    [...new Set(legacyBindings)],
    [],
    'settingsScope.bind 是数据死路（A2），legacy 回退不再绑定任何命名空间',
  )
  // 桥 scope 存在性：没有 configForms 时 apply 不得抛（桥 scope 在卡片工厂闭包里），
  // 且家族双卡与页脚双入口照常注册。
  const family = legacyLedger.filter((o) => o.name === 'dsh-family.tab')
  assert.equal(family.length, 1, 'legacy fallback must still register the family tab card')
  const footer = legacyLedger.filter((o) => o.name === 'sidebar.footer.action')
  assert.equal(footer.length, 1, 'legacy fallback must still register the footer entry')
})

// ── The seat-probe warn check retired with the seat itself (0.1.7) ────────────

for (const [name, fn] of checks) {
  try {
    await fn()
    line(`  PASS  ${name}`)
  } catch (err) {
    failures++
    line(`  FAIL  ${name} — ${err?.message ?? err}`)
  }
}

line(`\n${failures === 0 ? 'TEST PASS' : `TEST FAIL (${failures})`}`)
process.exitCode = failures === 0 ? 0 : 1
