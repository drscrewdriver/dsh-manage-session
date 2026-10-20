/**
 * 老线（≤0.1.5）会话「…」菜单删除注入臂（2026-10-20 用户定标）。
 *
 * 为什么需要：≤0.1.5 宿主的 ui-workspace 会话菜单是 React **写死**的
 * `sessionMenuItems`（rename/fork/archive），portal 出 `div[role=menu]`，
 * **无插件席位**——席位臂（session-menu.tsx）在老线 inject 静默等待、永不落行。
 * purge 后端两格都通（file 兜底路），缺的只是菜单入口。本臂用 DOM 注入补上：
 * 监听 portal 菜单出现 → 从被点「…」锚点的行 React fiber 取 sessionId →
 * 追一行两步确认删除（与管理端/席位臂同款 purge 链路）。
 *
 * 现代线（0.1.7+）席位行已渲染并带 `data-steward-menu-delete` 标记，本臂据此
 * dedup 跳过；故两线共用一个注入器不会出两条删除。
 *
 * 纪律：全程 best-effort、任何异常吞掉绝不影响宿主；仅在 directDelete=true 时
 * 注入（缺省关，破坏性入口不默认铺开）。fiber 取 id 失败即放弃该行（不伪造）。
 */
import { callHostAny, callSteward, type HostIndexStatus } from './search/host-api.ts'
import { dictionaries, type LocaleKey } from './locales.ts'

/** dedup 标记（与 session-menu.tsx 席位行同串）。 */
export const STEWARD_MENU_DELETE_ATTR = 'data-steward-menu-delete'

/** 锚点点击 → 菜单出现的有效窗口（超时视为陈旧、不注入）。 */
const PENDING_TTL_MS = 1500

/** 删除行文案（从字典解析，缺省回退 zh）。 */
export interface DeleteLabels {
  delete: string
  confirm: string
}

/** 按语言前缀挑字典（`zh-CN`→`zh`；未知回退 zh；键缺失回退 zh 同键）。 */
export function resolveLabels(lang: string | undefined): DeleteLabels {
  const dicts = dictionaries as Record<string, Record<string, string>>
  const base = dicts['zh'] ?? {}
  const pick = (key: LocaleKey): string => {
    const norm = (lang ?? '').toLowerCase()
    const prefix = norm.split('-')[0] ?? ''
    const hit = dicts[prefix]?.[key] ?? dicts[norm]?.[key]
    return hit ?? base[key] ?? key
  }
  return { delete: pick('menu.deleteSession' as LocaleKey), confirm: pick('menu.deleteSession.confirm' as LocaleKey) }
}

/**
 * 从被点元素向上找 `[role=treeitem]` 会话行，再沿 React fiber `.return` 链
 * 找 `memoizedProps.node.id`（会话 id）。fiber 键前缀兼容 React 17/18/19
 * (`__reactFiber$`) 与 16 (`__reactInternalInstance$`)。找不到返回 undefined。
 * 接受任意带这些字段的对象以便单测（不强依赖真实 DOM 类型）。
 */
export function extractSessionIdFromFiber(startEl: unknown): string | undefined {
  let el = startEl as { closest?: (s: string) => unknown; parentElement?: unknown } | null | undefined
  // 先定位到会话行（treeitem）；不是行内元素直接放弃。
  let row: unknown = null
  if (el !== null && el !== undefined && typeof (el as { closest?: unknown }).closest === 'function') {
    row = (el as { closest: (s: string) => unknown }).closest('[role="treeitem"]')
  }
  if (row === null || row === undefined) return undefined
  const fiberKey = Object.keys(row).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  )
  if (fiberKey === undefined) return undefined
  let fiber = (row as Record<string, unknown>)[fiberKey] as
    | { memoizedProps?: unknown; return?: unknown } | undefined
  for (let i = 0; i < 40 && fiber !== undefined && fiber !== null; i++) {
    const props = fiber.memoizedProps as { node?: { id?: unknown }; row?: { id?: unknown } } | undefined
    const cand = props?.node?.id ?? props?.row?.id
    if (typeof cand === 'string' && cand !== '') return cand
    fiber = fiber.return as typeof fiber
  }
  return undefined
}

/** 该菜单容器是否已含删除行（席位行或本臂先前注入）。 */
export function hasStewardDelete(menuEl: { querySelector?: (s: string) => unknown } | null | undefined): boolean {
  if (menuEl === null || menuEl === undefined) return false
  return typeof menuEl.querySelector === 'function'
    && menuEl.querySelector(`[${STEWARD_MENU_DELETE_ATTR}]`) !== null
}

/** 注入器依赖（浏览器装配；单测只覆盖上面的纯叶）。 */
export interface LegacyMenuInjectDeps {
  doc: Document
  /** 删除执行（走 session-history-purge）；返回后调用方负责关菜单。 */
  purge: (sessionId: string) => Promise<void>
  /** directDelete 探针（含缓存策略由实现决定）。 */
  isEnabled: () => Promise<boolean>
  /** 当前语言（navigator.language）。 */
  lang: () => string | undefined
  log?: (msg: string) => void
}

/**
 * 装配老线菜单注入器。返回 dispose（摘除监听）。任何内部异常都被吞——
 * 本臂是增强，绝不允许拖垮宿主侧栏。DOM 构造器（MutationObserver/MouseEvent/
 * KeyboardEvent/Element）走全局（DOM lib 顶层声明；Window 类型不暴露它们）。
 */
export function installLegacySessionMenuDelete(deps: LegacyMenuInjectDeps): () => void {
  const { doc } = deps
  let pending: { sessionId: string; at: number } | undefined
  const anchored = new WeakSet<Element>()

  const onRowAnchorClick = (ev: Event): void => {
    try {
      const target = ev.target
      if (!(target instanceof Element)) return
      const btn = target.closest('button')
      if (btn === null) return
      // 仅行内「…」锚点（在 treeitem 行里）；行内其它按钮点击不会开菜单，
      // 即便误取到 sessionId 也只是无菜单出现、pending 自然过期。
      const sid = extractSessionIdFromFiber(btn)
      if (sid !== undefined) pending = { sessionId: sid, at: Date.now() }
    } catch (err) { deps.log?.(`anchor click extract failed: ${String(err)}`) }
  }

  const closeMenu = (): void => {
    try {
      // 宿主菜单 onClose 走 outside pointerdown / Escape；用一次 body pointerdown 兜底关。
      doc.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } catch { /* 关不掉不致命 */ }
  }

  const injectInto = (menuEl: Element, sessionId: string): void => {
    if (anchored.has(menuEl) || hasStewardDelete(menuEl)) return
    const labels = resolveLabels(deps.lang())
    const row = doc.createElement('div')
    row.setAttribute('role', 'menuitem')
    row.setAttribute(STEWARD_MENU_DELETE_ATTR, '1')
    row.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 10px;margin:0;color:inherit;font:inherit;font-size:13px;line-height:18px;text-align:start;cursor:pointer;border-radius:6px'
    let armed = false
    const paint = (): void => {
      row.textContent = armed ? labels.confirm : labels.delete
      row.style.background = armed ? 'rgba(255,99,99,0.12)' : 'transparent'
      row.style.color = armed ? 'var(--dsw-alias-state-error-primary,#e5484d)' : 'inherit'
    }
    paint()
    row.addEventListener('mouseenter', () => { row.style.background = armed ? 'rgba(255,99,99,0.12)' : 'var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.12))' })
    row.addEventListener('mouseleave', () => { armed = false; paint() })
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!armed) { armed = true; paint(); return }
      void deps.purge(sessionId).then(closeMenu, () => { closeMenu() })
    })
    menuEl.appendChild(row)
    anchored.add(menuEl)
  }

  const tryInject = (): void => {
    try {
      if (pending === undefined || Date.now() - pending.at > PENDING_TTL_MS) return
      const sid = pending.sessionId
      const menus = Array.from(doc.querySelectorAll('[role="menu"]'))
      for (const menu of menus) {
        if (menu.querySelector('[role="menuitem"]') === null) continue // 空/非会话菜单
        void deps.isEnabled().then((on) => {
          if (!on) return
          if (!menu.isConnected) return
          injectInto(menu, sid)
        }, () => {})
      }
      pending = undefined
    } catch (err) { deps.log?.(`menu inject failed: ${String(err)}`) }
  }

  let observer: MutationObserver | undefined
  const start = (): void => {
    if (typeof MutationObserver !== 'function') return
    const obs = new MutationObserver(() => { tryInject() })
    obs.observe(doc.body, { childList: true, subtree: true })
    observer = obs
  }

  try {
    doc.addEventListener('click', onRowAnchorClick, true)
    if (doc.body !== null && doc.body !== undefined) start()
    else doc.addEventListener('DOMContentLoaded', start, { once: true })
  } catch (err) { deps.log?.(`legacy menu arm init failed: ${String(err)}`) }

  return () => {
    try {
      doc.removeEventListener('click', onRowAnchorClick, true)
      observer?.disconnect()
    } catch { /* dispose 尽力 */ }
  }
}

/** directDelete 探针（缓存 30s）——注入器与外部共用一份。 */
export function makeDirectDeleteProbe(): () => Promise<boolean> {
  let cached = false
  let at = 0
  return async (): Promise<boolean> => {
    if (Date.now() - at < 30_000) return cached
    at = Date.now()
    try {
      const res = await callHostAny<HostIndexStatus>('index-status', {})
      cached = (res as Partial<HostIndexStatus>).directDelete === true
    } catch {
      cached = false
    }
    return cached
  }
}

/** 默认删除执行：走 session-history-purge（与管理端/席位臂同链路）。 */
export async function purgeSessionById(sessionId: string): Promise<void> {
  const res = await callSteward<{ purged?: number }>('session-history-purge', { sessionIds: [sessionId] })
  if (res.ok !== true) throw new Error(res.error ?? 'purge failed')
}
