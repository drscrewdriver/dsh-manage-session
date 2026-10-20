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

/**
 * 删除图标（逐字内联宿主 ui-primitives IconTrashOutline16——工作区「删除」
 * 同款）：单 path + fill=currentColor，16×16，随行文字色变化（上弦变红
 * 时图标一起红）。插件不能 value-import 宿主图标包（老线 ModuleLoader
 * 解析不了、未声明 peer），故内联 SVG 串；席位臂与注入臂共用此常量。
 */
export const TRASH_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z" fill="currentColor"/></svg>'

/** 图标槽内联样式（对齐宿主 .itemIcon：16×16 inline-flex flex:none）。 */
export const ICON_SLOT_STYLE = 'display:inline-flex;flex:none;width:16px;height:16px;align-items:center'

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

/**
 * 隐藏侧栏中属于该 sessionId 的会话行（老线文件路 purge 后补位）。
 * 背景：≤0.1.5 无 registry.deleteSession，purgeHistory 只动磁盘（归档+删目录）
 * 与 steward 索引，不通知宿主内存 workspaceRegistry → 侧栏行滞留到重启。
 * 本函数扫 `[role=treeitem]` 行、用 fiber 取 node.id 匹配、置 display:none（不
 * removeChild，避开与 React 协调冲突；行无 style.display prop，重渲染不覆盖）。
 * 返回隐藏行数（现代线行已被 deleteSession 真删，此处通常 0，无害）。
 */
export function hideSidebarRowsFor(doc: Document, sessionId: string): number {
  if (sessionId === '') return 0
  let n = 0
  for (const row of Array.from(doc.querySelectorAll('[role="treeitem"]'))) {
    if (extractSessionIdFromFiber(row) === sessionId) {
      ;(row as HTMLElement).style.display = 'none'
      n += 1
    }
  }
  return n
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
    // 图标槽 + 文字槽（对齐宿主 rename/fork/archive 的 itemIcon+itemLabel 结构）。
    const icon = doc.createElement('span')
    icon.style.cssText = ICON_SLOT_STYLE
    icon.innerHTML = TRASH_ICON_SVG
    const label = doc.createElement('span')
    let armed = false
    const paint = (): void => {
      label.textContent = armed ? labels.confirm : labels.delete
      row.style.background = armed ? 'rgba(255,99,99,0.12)' : 'transparent'
      row.style.color = armed ? 'var(--dsw-alias-state-error-primary,#e5484d)' : 'inherit'
    }
    row.append(icon, label)
    paint()
    row.addEventListener('mouseenter', () => { row.style.background = armed ? 'rgba(255,99,99,0.12)' : 'var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.12))' })
    row.addEventListener('mouseleave', () => { armed = false; paint() })
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!armed) { armed = true; paint(); return }
      // 成功：先隐藏侧栏滞留行（老线文件路不通知宿主 registry），再关菜单。
      void deps.purge(sessionId).then(() => { hideSidebarRowsFor(doc, sessionId); closeMenu() }, () => { closeMenu() })
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
