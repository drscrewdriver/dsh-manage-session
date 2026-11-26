/**
 * 批量管理台（workspace 视角）—— 管家面板「管理」页签的主体。
 *
 * beta.5 评审:管理是管家职能,不该出现在搜索面板的模式切换里;本组件从
 * search/panel.tsx 抽出,挂在 StewardPanel 第三页签。样式自带注入（幂等）,
 * 与搜索面板是否启用解耦。
 *
 * 数据面:list-sessions 读统一索引语料（活跃+归档,archived 随行）;
 * 动作面:session-history-archive / prune / purge（写官方存储文件,重启后
 * 侧栏完全生效——宿主半在成功路径上已同步联动索引）。
 */
import { createElement, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { callSteward, callStewardItems, streamCatalogTitles, type HostSessionItem, type OpenSessionOutcome } from './host-api.ts'
import { translate, type LocaleKey } from './manage-locales.ts'
import { matchesCatalogText } from './session-filter.ts'
import {
  readPinnedIds, readArchivedIds, readLiveIds,
  capabilitiesOf, sortPinnedFirst,
  togglePin, renameSession, forkSession,
  type ServiceGetter,
} from './session-actions.ts'
import {
  fetchOpenInApps, pickExplorerApp, pickGitApp, launchOpenInApp,
} from './open-in-app.ts'

/** 管理台字典面（search 子域命名空间的键集）。 */
export type ManageTranslate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** 剪贴板失败后的 textarea 内回退。 */
function fallbackCopy(text: string, onOk: () => void): void {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    onOk()
  } catch { /* 失败不抛 */ }
}

/** 行内动作小图标按钮通用渲染函数。 */
function iconBtn(
  key: string, label: string, svg: React.ReactNode, disabled: boolean, disabledTitle: string,
  onClick: (e: React.MouseEvent) => void,
): React.ReactElement {
  return createElement('button', {
    key,
    type: 'button',
    className: 'dmss_iconBtn',
    'aria-label': label,
    title: disabled ? disabledTitle : label,
    disabled,
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onClick(e) },
    onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation() },
  }, svg)
}

/** 单色 SVG 动作图标容器（stroke:currentColor，随主题）。 */
function svgIcon(children: React.ReactNode, filled = false): ReactElement {
  return createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 16 16',
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }, children)
}
function iconPin(filled: boolean): ReactElement {
  return svgIcon(createElement('path', { d: 'M8 2.5l3.5 3.5-2 1 1 4.5L8 9.7l-2.5 2.3 1-4.5-2-1z' }), filled)
}
function iconRename(): ReactElement {
  return svgIcon(createElement('path', { d: 'M11 2.5l2.5 2.5L6 12.5 3 13.5l1-3z' }))
}
function iconClone(): ReactElement {
  return svgIcon([
    createElement('circle', { cx: 4.5, cy: 4, r: 1.6, key: 'a' }),
    createElement('circle', { cx: 4.5, cy: 12, r: 1.6, key: 'b' }),
    createElement('circle', { cx: 11.5, cy: 8, r: 1.6, key: 'c' }),
    createElement('path', { d: 'M4.5 5.6v4.8M6.1 4h2.4a1.5 1.5 0 011.5 1.5v.9', key: 'd' }),
  ])
}
function iconCopy(): ReactElement {
  return svgIcon([
    createElement('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, key: 'a' }),
    createElement('path', { d: 'M10.5 3.5h-8v8', key: 'b' }),
  ])
}
function iconFolder(): ReactElement {
  return svgIcon(createElement('path', { d: 'M2 4.5h4l1.2 1.4H14V12H2z' }))
}
function iconGit(): ReactElement {
  return svgIcon([
    createElement('circle', { cx: 5, cy: 4, r: 1.5, key: 'a' }),
    createElement('circle', { cx: 5, cy: 12, r: 1.5, key: 'b' }),
    createElement('circle', { cx: 11, cy: 8, r: 1.5, key: 'c' }),
    createElement('path', { d: 'M5 5.5v5M6.5 4H9a1.5 1.5 0 011.5 1.5v1', key: 'd' }),
  ])
}

/** 样式（幂等注入;类名沿用 dmss_ 前缀,与搜索面板共享视觉语言）。 */
function injectManageStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector('style[data-plugin-css="dsh-manage-session/manage"]') !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-manage-session'
  tag.dataset.pluginCss = 'dsh-manage-session/manage'
  tag.textContent = `
.dmss_manageRoot{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;padding:0}
.dmss_manageList{flex:1 1 auto;min-height:0;overflow-y:auto;margin:8px 0 0;padding:0 6px 10px}
.dmss_group{margin-bottom:10px}
.dmss_groupHead{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--dsw-specific-tip);border-bottom:1px solid var(--dsw-alias-border-l2);cursor:pointer;user-select:none}
.dmss_groupTitle{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dmss_groupCount{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
/* 会话卡片网格：一行三张（1/3 宽），窄屏降两列 / 单列。 */
.dmss_grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:8px}
@media (max-width:1180px){.dmss_grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:760px){.dmss_grid{grid-template-columns:minmax(0,1fr)}}
/* 卡片本体：标题行 + 工作区元信息两行，整块可点（打开会话）。 */
.dmss_row{box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:0;height:auto;margin:0;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.05));color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;user-select:none;transition:border-color .14s ease-out,background-color .14s ease-out}
.dmss_row:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* 单击选中态：告诉用户「点到了但没跳转」，双击才会打开会话。 */
.dmss_rowActive{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dmss_rowTitle{display:flex;align-items:center;gap:6px;min-width:0;width:100%}
.dmss_titleText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px;font-weight:500}
.dmss_tag{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dmss_meta{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dmss_check{flex:none;display:inline-flex;align-items:center}
.dmss_check input{width:13px;height:13px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.dmss_tagArch{flex:none;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-caption));font-size:10px;line-height:16px;border:1px solid currentColor;border-radius:999px;padding:0 6px;white-space:nowrap}
.dmss_batchBar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 8px 10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.06));box-shadow:0 6px 16px rgba(0,0,0,.10);position:relative;z-index:3}
.dmss_batchInfo{flex:0 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}
.dmss_openError{display:flex;align-items:center;gap:8px;margin:6px 8px 0;padding:7px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dmss_openErrorText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmss_openErrorClose{flex:none;border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
.dmss_actBtn{height:26px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:0 10px;font-size:12px;line-height:24px;white-space:nowrap}
.dmss_actBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmss_actBtn:disabled{cursor:not-allowed;opacity:.5}
.dmss_btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dmss_btnDangerSolid{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#fff;font-weight:600}
.dmss_btnDangerSolid:hover{background:var(--dsw-alias-state-error-primary);filter:brightness(1.08);color:#fff}
.dmss_manageHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:8px 10px 0}
.dmss_chips{display:flex;align-items:center;gap:6px;padding:8px 10px 0;flex:none;flex-wrap:wrap}
.dmss_chip{height:24px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:999px;padding:0 10px;font-size:12px;font-weight:500;line-height:22px;white-space:nowrap}
.dmss_chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmss_chipActive{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.dmss_search{height:24px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:12px;line-height:22px}
.dmss_search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dmss_status{color:var(--dsw-alias-label-tertiary);padding:10px 8px 8px;font-size:12px;line-height:18px}
.dmss_empty{color:var(--dsw-alias-label-tertiary);padding:10px 8px 8px;font-size:12px;line-height:18px}
.dmss_error{color:var(--dsw-alias-state-error-primary);padding:8px;font-size:12px;line-height:18px}
/* 行内动作区：hover/focus-within 显示；触屏常显。 */
.dmss_rowActions{display:flex;align-items:center;gap:3px;opacity:0;transition:opacity .12s;margin-top:2px}
.dmss_row:hover .dmss_rowActions,.dmss_row:focus-within .dmss_rowActions{opacity:1}
@media (hover:none){.dmss_rowActions{opacity:1}}
.dmss_iconBtn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:5px;background:transparent;cursor:pointer;padding:0;color:var(--dsw-alias-label-tertiary);flex:none}
.dmss_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmss_iconBtn:disabled{cursor:not-allowed;opacity:.4}
.dmss_uuid{font-size:10px;color:var(--dsw-alias-label-caption);cursor:default;user-select:all}
/* 分组头右侧按钮 */
.dmss_groupActions{display:flex;align-items:center;gap:4px;flex:none}
/* 置顶图钉 */
.dmss_pinnedIcon{flex:none;color:var(--dsw-alias-state-warn-label,#d97706);font-size:11px;line-height:1}
/* 就地成功/失败提示 */
.dmss_toast{display:flex;align-items:center;gap:6px;margin:4px 8px 0;padding:6px 10px;border-radius:8px;font-size:12px;line-height:18px}
.dmss_toastOk{background:rgba(22,163,74,.10);color:#15803d;border:1px solid rgba(22,163,74,.28)}
.dmss_toastErr{background:rgba(220,38,38,.10);color:#b91c1c;border:1px solid rgba(220,38,38,.28)}
`
  document.head.appendChild(tag)
  return () => {
    if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
  }
}

/** 最近一次跳转失败的原因（跨重挂保留：退页失败后恢复面板页时还能看到）。 */
let lastOpenError: string | null = null

/** 批量管理台主体（自持语料/勾选/批量状态）。 */
export function ManageConsole({ t, open, deferOpen = false, services }: {
  t?: ManageTranslate
  /** 打开会话：返回结果（失败由本组件就地提示，绝不抛错/白屏）。 */
  open: (sessionId: string, options?: { defer?: boolean; onError?: (message: string) => void }) => OpenSessionOutcome
  /** 整页形态：先退页、下一帧再导航（否则第一次点击只关页）。 */
  deferOpen?: boolean
  /** 官方服务 getter（缺省 = () => undefined，动作按钮不渲染）。 */
  services?: ServiceGetter
}): ReactElement {
  const [sessions, setSessions] = useState<HostSessionItem[] | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  // 跳转失败的就地提示（会话已删/宿主导航服务缺席/服务抛错）——面板保持不变，不异常跳出。
  // 模块级余留：整页形态下“退页 + 恢复页”会重挂本组件，局部 state 会丢，失败原因靠它带回来。
  const [openError, setOpenError] = useState<string | null>(lastOpenError)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [batch, setBatch] = useState<{ busy: boolean; message: string; ok: boolean }>({ busy: false, message: '', ok: true })
  const [confirmPurge, setConfirmPurge] = useState(false)
  // 单击只选中（高亮），**不跳转**：避免误点一下就被抛出管理台。
  const [activeId, setActiveId] = useState<string | null>(null)
  // 检索域过滤（全部/活跃/归档）——与搜索面板同一组 chip 语义。
  const [domain, setDomain] = useState<'all' | 'active' | 'archived'>('all')
  // 收藏（R6）:host 侧 JSON 域,挂载取一次,星标切换就地更新。
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set())
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  // workspace 定位（Quest 板布局）:'' = 全部;选中的组单独显示。文本框过滤标题/路径。
  const [workspaceFilter, setWorkspaceFilter] = useState('')
  const [textFilter, setTextFilter] = useState('')
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)
  // 分组收拢:勾选的组键(cwd);定位 chip 选中时该组自动展开。
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())

  // ── 订阅官方服务的置顶/归档/live 集合 ────────────────────────────────────
  // 用 useState+useEffect，不用 useSyncExternalStore：readXxx 每次返回新 Set，
  // 作 getSnapshot 会触发 React「快照引用不稳定 → 无限重渲染」崩溃（白屏）。
  // 改由订阅回调仅在服务变化时 setState；缺席即空集/undefined，绝不抛错。
  const get = services ?? (() => undefined)
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => readPinnedIds(get))
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() => readArchivedIds(get))
  const [liveIds, setLiveIds] = useState<ReadonlySet<string> | undefined>(() => readLiveIds(get))
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      if (!alive) return
      setPinnedIds(readPinnedIds(get))
      setArchivedIds(readArchivedIds(get))
      setLiveIds(readLiveIds(get))
    }
    refresh() // 补一次：服务可能晚于本组件挂载就绪
    let offWs: (() => void) | undefined
    let offSess: (() => void) | undefined
    try {
      const ws = get('workspaces') as { subscribe?: (l: () => void) => () => void } | undefined
      offWs = ws?.subscribe?.(refresh)
    } catch { /* 服务缺席 */ }
    try {
      const sess = get('sessions') as { subscribe?: (l: () => void) => () => void } | undefined
      offSess = sess?.subscribe?.(refresh)
    } catch { /* 服务缺席 */ }
    return () => { alive = false; try { offWs?.() } catch { /* */ } try { offSess?.() } catch { /* */ } }
  }, [])

  // ── open-in-app 可用应用集合（挂载取一次） ──────────────────────────────
  const [openApps, setOpenApps] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    void fetchOpenInApps().then((apps) => { if (!cancelled) setOpenApps(apps) })
    return () => { cancelled = true }
  }, [])
  const explorerApp = pickExplorerApp({ apps: [...openApps] })
  const gitApp = pickGitApp({ apps: [...openApps] })

  // ── 行内改名状态 ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)

  // ── 就地提示（成功/失败 3s 自动消失） ────────────────────────────────────
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, ok: boolean): void => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    setToast({ text, ok })
    toastTimer.current = setTimeout(() => { setToast(null); toastTimer.current = null }, 3000)
  }
  useEffect(() => () => { if (toastTimer.current !== null) clearTimeout(toastTimer.current) }, [])

  // 收藏集合:挂载取一次。
  useEffect(() => {
    let cancelled = false
    void callSteward<{ favorites?: string[] }>('session-history-favorites-list', {}).then((res) => {
      if (cancelled || !res.ok || !Array.isArray(res.favorites)) return
      setFavorites(new Set(res.favorites))
    })
    return () => { cancelled = true }
  }, [])

  /** 星标切换:写 host 收藏域,就地更新本地集合。 */
  const toggleFavorite = (sessionId: string): void => {
    const next = !favorites.has(sessionId)
    setFavorites(prev => {
      const copy = new Set(prev)
      if (next) copy.add(sessionId)
      else copy.delete(sessionId)
      return copy
    })
    void callSteward('session-history-favorite-set', { sessionId, favorite: next })
  }

  // 标题分帧流句柄：重取/卸载时必须 abort（否则宿主会接着把日志读完）。
  const titleStream = useRef<{ abort: () => void } | null>(null)

  // 语料：挂载取一次;批量成功后 setSessions(null) 重取（宿主半已联动索引）。
  // 首屏只拿得到零 I/O 的标题（live/checkpoint）；剩下的 `pending` 行由
  // session-catalog-stream 逐条补齐，就地替换该行标题（不整表重渲染）。
  useEffect(() => {
    if (sessions !== null) return
    let cancelled = false
    callStewardItems<HostSessionItem>('session-catalog', {}).then((res) => {
      if (cancelled) return
      if (res.ok) {
        setSessions(res.items); setSelected(new Set()); setConfirmPurge(false)
        const pending = res.items
          .filter(item => item.titleSource === 'pending')
          .map(item => item.sessionId)
        titleStream.current?.abort()
        titleStream.current = null
        if (pending.length === 0) return
        titleStream.current = streamCatalogTitles(pending, {
          onTitle: (event) => {
            setSessions(prev => prev === null ? prev : prev.map(row => (row.sessionId === event.sessionId
              ? {
                  ...row,
                  ...(typeof event.title === 'string' && event.title !== '' ? { title: event.title } : {}),
                  titleSource: (event.source === 'prefix'
                    ? 'cache'
                    : event.source === 'none' ? 'none' : row.titleSource) as HostSessionItem['titleSource'],
                }
              : row)))
          },
          onError: () => {
            // 流失败（网络断/宿主不支持）：列表保持可用，待定行降为「无标题」，
            // 不得保持 pending 状态——否则每次重渲染都会再起一条流。
            setSessions(prev => prev === null ? prev : prev.map(row => (row.titleSource === 'pending'
              ? { ...row, titleSource: 'none' }
              : row)))
          },
        })
      } else setSessionsError(res.error ?? '读取会话列表失败')
    })
    return () => {
      // 只丢弃本次取数的结果；**不 abort 流**——`sessions` 每次就地替换都会重跑
      // 本 effect，在这里 abort 等于「收到第一条标题就掐断整条流」。流的生命周期
      // 归 unmount（见下方空依赖 effect）与显式重取（runBatch）管。
      cancelled = true
    }
  }, [sessions])

  // 卸载即停读：面板关闭 / 页面跳转后宿主不得继续解压日志。
  useEffect(() => () => {
    titleStream.current?.abort()
    titleStream.current = null
  }, [])

  // workspace（cwd）分组,未分组排最后;域过滤（archived 缺省按活跃对待,兼容旧宿主半）。
  const manageGroups = useMemo<{ cwd: string; items: HostSessionItem[] }[]>(() => {
    if (sessions === null) return []
    const byCwd = new Map<string, HostSessionItem[]>()
    for (const item of sessions) {
      if (domain === 'active' && item.archived === true) continue
      if (domain === 'archived' && item.archived !== true) continue
      if (favoritesOnly && !favorites.has(item.sessionId)) continue
      if (workspaceFilter !== '' && item.cwd !== workspaceFilter) continue
      const list = byCwd.get(item.cwd)
      if (list === undefined) byCwd.set(item.cwd, [item])
      else list.push(item)
    }
    return [...byCwd.entries()]
      .sort((a, b) => (a[0] === '' ? 1 : 0) - (b[0] === '' ? 1 : 0) || a[0].localeCompare(b[0]))
      .map(([cwd, items]) => ({ cwd, items: sortPinnedFirst(items, pinnedIds) }))
  }, [sessions, domain, favoritesOnly, favorites, workspaceFilter, pinnedIds])

  /** workspace chip 数据:全部/各 workspace 计数,按计数降序,未分组最后。 */
  const workspaceChips = useMemo<{ cwd: string; label: string; count: number }[]>(() => {
    if (sessions === null) return []
    const counts = new Map<string, number>()
    for (const item of sessions) {
      if (domain === 'active' && item.archived === true) continue
      if (domain === 'archived' && item.archived !== true) continue
      if (favoritesOnly && !favorites.has(item.sessionId)) continue
      counts.set(item.cwd, (counts.get(item.cwd) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => (a[0] === '' ? 1 : 0) - (b[0] === '' ? 1 : 0) || (b[1] - a[1]))
      .map(([cwd, count]) => ({
        cwd,
        count,
        label: cwd === '' ? translate(t, 'manage.group.nocwd') : (cwd.split(/[\/]/).pop() ?? cwd),
      }))
  }, [sessions, domain, favoritesOnly, favorites, t])

  /** chip 折叠:默认最多 8 个,超出折叠进「还有 N 个」。 */
  const visibleChips = useMemo(() => {
    if (showAllWorkspaces) return { chips: workspaceChips, hidden: 0 }
    return { chips: workspaceChips.slice(0, 8), hidden: Math.max(0, workspaceChips.length - 8) }
  }, [workspaceChips, showAllWorkspaces])

  /** 文本过滤：支持 `工作区:` / `workspace:` 前缀（只比 cwd）；其余按标题/cwd 子串。 */
  const matchesText = (item: HostSessionItem): boolean => matchesCatalogText(item, textFilter)

  const toggleCollapsed = (key: string): void => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const setAllCollapsed = (collapsed: boolean): void => {
    setCollapsedGroups(collapsed ? new Set(manageGroups.map(group => group.cwd)) : new Set())
  }

  // 定位 chip 选中某 workspace 时自动展开该组。
  useEffect(() => {
    if (workspaceFilter === '') return
    setCollapsedGroups(prev => {
      if (!prev.has(workspaceFilter)) return prev
      const next = new Set(prev)
      next.delete(workspaceFilter)
      return next
    })
  }, [workspaceFilter])

  /** 行标题：`pending` 先占位（会被流覆盖），`none` 就是真的无标题。 */
  const rowTitle = (item: HostSessionItem): string => {
    if (item.title !== '') return item.title
    if (item.titleSource === 'pending') return translate(t, 'manage.title.pending')
    return translate(t, 'panel.untitled')
  }

  /** 批量动作;删除两步确认。 */
  const runBatch = (kind: 'archive' | 'unarchive' | 'purge'): void => {
    const ids = [...selected]
    if (ids.length === 0 || batch.busy) return
    if (kind === 'purge' && !confirmPurge) { setConfirmPurge(true); return }
    setConfirmPurge(false)
    setBatch({ busy: true, message: '', ok: true })
    const method = kind === 'archive'
      ? 'session-history-archive'
      : kind === 'unarchive' ? 'session-history-prune' : 'session-history-purge'
    void callSteward<{
      added?: number
      removed?: number
      purged?: number
      requested?: number
      requiresRestart?: boolean
      failures?: { sessionId: string; reason: string }[]
      archiveFailures?: { sessionId: string; reason: string }[]
      pendingCleanup?: string[]
    }>(method, { sessionIds: ids }).then((res) => {
      const failures = [...(res.failures ?? []), ...(res.archiveFailures ?? [])]
      const pending = res.pendingCleanup ?? []
      const base = !res.ok
        ? translate(t, 'manage.done.error', { error: res.error ?? '?' })
        : kind === 'archive'
          ? translate(t, 'manage.done.archive', { n: res.added ?? ids.length })
          : kind === 'unarchive'
            ? translate(t, 'manage.done.unarchive', { n: res.removed ?? ids.length })
            : translate(t, 'manage.done.purge', { n: res.purged ?? ids.length })
      // 逐条失败必须可见：只报成功数会让「活跃会话被拒」看起来像没反应；
      // 没删干净的单独提示（那些行留在墓碑区，脚本 tombstones 可清理/重试）。
      const withFailures = res.ok === true && (failures.length > 0 || pending.length > 0)
        ? `${base}`
          + `${failures.length > 0 ? translate(t, 'manage.done.failed', { n: failures.length, reason: failures[0]?.reason ?? '?' }) : ''}`
          + `${pending.length > 0 ? translate(t, 'manage.done.pending', { n: pending.length }) : ''}`
        : base
      // 及时性如实呈现:内存路径即时生效;文件降级路径才需要重启。
      const message = res.ok === true && res.requiresRestart === true
        ? `${withFailures} ${translate(t, 'manage.done.restart')}`
        : withFailures
      setBatch({ busy: false, message, ok: res.ok === true })
      if (res.ok) {
        setSelected(new Set())
        // 重取前先掐旧流：旧列表即将作废，继续读只是白耗磁盘。
        titleStream.current?.abort()
        titleStream.current = null
        setSessions(null)
      }
    })
  }

  const toggleOne = (sessionId: string): void => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  /**
   * 打开会话的唯一入口（双击 / 键盘 Enter）。
   *
   * 单击**不**调这里：用户定标「双击才允许跳转」，单击只做选中——
   * 鼠标滑一下就把人抛出管理台正是上一轮的痛点。
   */
  const navigate = (item: HostSessionItem): void => {
    const label = item.title !== '' ? item.title : item.sessionId
    const fail = (reason: string): void => {
      const text = reason === ''
        ? translate(t, 'manage.open.failed', { id: label })
        : `${translate(t, 'manage.open.failed', { id: label })}：${reason}`
      lastOpenError = text
      setOpenError(text)
    }
    try {
      const outcome = open(item.sessionId, {
        defer: deferOpen,
        onError: reason => { fail(reason) },
      })
      if (outcome.ok === true) {
        lastOpenError = null
        setOpenError(null)
        return
      }
      fail(outcome.error ?? '')
    } catch (err) {
      fail(String(err instanceof Error ? err.message : err))
    }
  }

  const toggleGroup = (items: readonly HostSessionItem[]): void => {
    setSelected(prev => {
      const next = new Set(prev)
      const allIn = items.every(item => next.has(item.sessionId))
      for (const item of items) {
        if (allIn) next.delete(item.sessionId)
        else next.add(item.sessionId)
      }
      return next
    })
  }

  // ── 行内动作处理 ─────────────────────────────────────────────────────────

  const handlePin = (item: HostSessionItem): void => {
    const isPinned = pinnedIds.has(item.sessionId)
    void togglePin(get, item.sessionId, !isPinned).then((res) => {
      if (res.ok) showToast(translate(t, isPinned ? 'row.unpin' : 'row.pin'), true)
      else showToast(res.error ?? translate(t, 'row.pinFailed'), false)
    })
  }

  const handleRename = (item: HostSessionItem, draft: string): void => {
    void renameSession(get, item.sessionId, draft).then((res) => {
      if (res.ok) {
        setEditing(null)
        // 不再只做乐观更新：宿主侧 memo 已在 host 半身失效，重取才是唯一可信来源。
        // （旧实现直接改本地数组，任何一次重取都会把旧标题带回来 —— 那就是「改名存不住」。）
        setSessions(null)
        showToast(translate(t, 'row.rename'), true)
      } else {
        showToast(res.error ?? translate(t, 'row.renameFailed'), false)
      }
    })
  }

  const handleFork = (item: HostSessionItem): void => {
    void forkSession(get, item.sessionId).then((res) => {
      if (res.ok) {
        titleStream.current?.abort()
        titleStream.current = null
        setSessions(null) // 重取列表
        showToast(translate(t, 'row.clone', { id: res.childId ?? '' }), true)
      } else {
        showToast(res.error ?? translate(t, 'row.cloneFailed'), false)
      }
    })
  }

  const handleCopyUUID = (sessionId: string): void => {
    const doCopy = (): void => {
      showToast(translate(t, 'row.idCopied'), true)
    }
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      navigator.clipboard.writeText(sessionId).then(doCopy).catch(() => {
        fallbackCopy(sessionId, doCopy)
      })
    } else {
      fallbackCopy(sessionId, doCopy)
    }
  }

  const handleOpenInApp = (app: string | undefined, cwd: string): void => {
    if (!app) return
    void launchOpenInApp(app, cwd).then((res) => {
      if (!res.ok) showToast(res.error ?? translate(t, 'row.openFailed'), false)
    })
  }

  useEffect(() => { injectManageStyles() }, [])

  if (sessionsError !== null) {
    return createElement('div', { className: 'dmss_error' }, sessionsError)
  }
  if (sessions === null) {
    return createElement('div', { className: 'dmss_status' }, translate(t, 'panel.loadingSessions'))
  }
  if (sessions !== null && manageGroups.length === 0 && (workspaceFilter !== '' || textFilter.trim() !== '' || domain !== 'all' || favoritesOnly)) {
    return createElement('div', { className: 'dmss_empty' }, translate(t, 'panel.noMatch'))
  }
  if (manageGroups.length === 0) {
    return createElement('div', { className: 'dmss_empty' }, translate(t, 'panel.noSessions'))
  }

  const children: ReactElement[] = [
    createElement('input', {
      key: 'search',
      className: 'dmss_search',
      style: { margin: '8px 10px 0', flex: 'none' },
      type: 'text',
      placeholder: translate(t, 'manage.search'),
      value: textFilter,
      onChange: (e: { target: { value: string } }) => { setTextFilter(e.target.value) },
    }),
    createElement('div', { key: 'wsChips', className: 'dmss_chips', role: 'group', 'aria-label': translate(t, 'workspace.label') }, [
      createElement('span', { key: 'label', style: { flex: 'none', fontSize: '12px', color: 'var(--dsw-alias-label-caption)' } }, translate(t, 'workspace.label')),
      createElement('button', {
        key: 'all',
        type: 'button',
        className: `dmss_chip${workspaceFilter === '' ? ' dmss_chipActive' : ''}`,
        'aria-pressed': workspaceFilter === '',
        onClick: () => { setWorkspaceFilter('') },
      }, `${translate(t, 'domain.all')} (${sessions?.length ?? 0})`),
      ...visibleChips.chips.map(chip => createElement('button', {
        key: chip.cwd === '' ? '(nocwd)' : chip.cwd,
        type: 'button',
        className: `dmss_chip${workspaceFilter === chip.cwd ? ' dmss_chipActive' : ''}`,
        'aria-pressed': workspaceFilter === chip.cwd,
        onClick: () => { setWorkspaceFilter(current => (current === chip.cwd ? '' : chip.cwd)) },
      }, `${chip.label} (${chip.count})`)),
      visibleChips.hidden > 0 && createElement('button', {
        key: 'more', type: 'button', className: 'dmss_chip',
        onClick: () => { setShowAllWorkspaces(true) },
      }, translate(t, 'workspace.more', { n: visibleChips.hidden })),
      showAllWorkspaces && workspaceChips.length > 8 && createElement('button', {
        key: 'less', type: 'button', className: 'dmss_chip',
        onClick: () => { setShowAllWorkspaces(false) },
      }, translate(t, 'workspace.less')),
      createElement('span', { key: 'gap', style: { flex: 1 } }),
      manageGroups.length > 1 && createElement('button', {
        key: 'collapseAll', type: 'button', className: 'dmss_chip',
        onClick: () => { setAllCollapsed(true) },
      }, translate(t, 'group.collapseAll')),
      manageGroups.length > 1 && createElement('button', {
        key: 'expandAll', type: 'button', className: 'dmss_chip',
        onClick: () => { setAllCollapsed(false) },
      }, translate(t, 'group.expandAll')),
    ]),
    createElement('div', { key: 'chips', className: 'dmss_chips', role: 'group', 'aria-label': translate(t, 'domain.all') }, [
      ...(['all', 'active', 'archived'] as const).map(id => createElement('button', {
        key: id,
        type: 'button',
        className: `dmss_chip${domain === id ? ' dmss_chipActive' : ''}`,
        'aria-pressed': domain === id,
        onClick: () => { setDomain(id) },
      }, translate(t, `domain.${id}` as LocaleKey))),
      createElement('button', {
        key: 'favorites',
        type: 'button',
        className: `dmss_chip${favoritesOnly ? ' dmss_chipActive' : ''}`,
        'aria-pressed': favoritesOnly,
        onClick: () => { setFavoritesOnly(v => !v) },
      }, `★ ${translate(t, 'filter.favorites')}`),
    ]),
    createElement('div', { key: 'hint', className: 'dmss_manageHint' }, [
      translate(t, 'manage.hint'),
      createElement('span', { key: 'sep', style: { display: 'block', marginTop: '2px' } }, translate(t, 'manage.restartHint')),
      createElement('span', { key: 'openHint', style: { display: 'block', marginTop: '2px' } }, translate(t, 'manage.hint.open')),
    ]),
    // 跳转失败的容错带：面板与勾选/滚动位置全部保留，只多这一行提示。
    ...(openError === null ? [] : [createElement('div', { key: 'openError', className: 'dmss_openError', role: 'alert' }, [
      createElement('span', { key: 'text', className: 'dmss_openErrorText', title: openError }, openError),
      createElement('button', {
        key: 'close',
        type: 'button',
        className: 'dmss_openErrorClose',
        title: translate(t, 'manage.open.dismiss'),
        onClick: () => { lastOpenError = null; setOpenError(null) },
      }, '×'),
    ])]),
    // 就地成功/失败提示（3s 自动消失）
    ...(toast === null ? [] : [createElement('div', {
      key: 'toast',
      className: `dmss_toast${toast.ok ? ' dmss_toastOk' : ' dmss_toastErr'}`,
      role: 'status',
    }, toast.text)]),
    createElement('div', { key: 'groups', className: 'dmss_manageList' },
      ...manageGroups.map(group => createElement('div', { key: group.cwd === '' ? '(nocwd)' : group.cwd, className: 'dmss_group' }, [
        createElement('div', {
          key: 'head',
          className: 'dmss_groupHead',
          title: translate(t, 'group.collapse'),
          onClick: () => { toggleCollapsed(group.cwd) },
        }, [
          createElement('span', { key: 'chev', style: { flex: 'none', fontSize: '10px', color: 'var(--dsw-alias-label-caption)', transition: 'transform .15s', transform: collapsedGroups.has(group.cwd) ? 'rotate(0deg)' : 'rotate(90deg)' } }, '▶'),
          createElement('span', { key: 'check', className: 'dmss_check' },
            createElement('input', {
              type: 'checkbox',
              checked: group.items.length > 0 && group.items.every(item => selected.has(item.sessionId)),
              onChange: () => { toggleGroup(group.items) },
              onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
              title: translate(t, 'manage.selectGroup'),
            })),
          createElement('span', { key: 'title', className: 'dmss_groupTitle' }, group.cwd === '' ? translate(t, 'manage.group.nocwd') : group.cwd),
          createElement('span', { key: 'count', className: 'dmss_groupCount' }, `${group.items.filter(item => matchesText(item)).length}/${group.items.length}`),
          // explorer / git 按钮：只在 cwd 非空且 app 可用时渲染
          (group.cwd !== '' && (explorerApp !== undefined || gitApp !== undefined))
            ? createElement('div', { key: 'groupActs', className: 'dmss_groupActions' }, [
                explorerApp !== undefined
                  ? iconBtn('explorer', translate(t, 'row.explorer'),
                      iconFolder(),
                      false, '',
                      () => { handleOpenInApp(explorerApp, group.cwd) })
                  : null,
                gitApp !== undefined
                  ? iconBtn('git', translate(t, 'row.git'),
                      iconGit(),
                      false, '',
                      () => { handleOpenInApp(gitApp, group.cwd) })
                  : null,
              ])
            : null,
        ]),
        ...(collapsedGroups.has(group.cwd) ? [] : [createElement('div', {
          key: 'grid',
          className: 'dmss_grid',
        }, group.items.filter(item => matchesText(item)).map(item => createElement('div', {
          key: item.sessionId,
          role: 'button',
          tabIndex: 0,
          className: `dmss_row${activeId === item.sessionId ? ' dmss_rowActive' : ''}`,
          title: translate(t, 'manage.row.openHint', { title: rowTitle(item) }),
          // 单击：只选中高亮（不跳转）——双击才打开，避免误触被抛出管理台。
          onClick: () => { setActiveId(item.sessionId) },
          onDoubleClick: () => { navigate(item) },
          // 键盘是明确意图：Enter / 空格 直接打开。
          onKeyDown: (e: { key: string }) => { if (e.key === 'Enter' || e.key === ' ') navigate(item) },
        }, [
          createElement('span', { key: 'line', className: 'dmss_rowTitle' }, [
            pinnedIds.has(item.sessionId)
              ? createElement('span', { key: 'pin', className: 'dmss_pinnedIcon', 'aria-hidden': true, title: translate(t, 'row.pin') }, iconPin(true))
              : null,
            createElement('span', { key: 'check', className: 'dmss_check' },
              createElement('input', {
                type: 'checkbox',
                checked: selected.has(item.sessionId),
                onChange: () => { toggleOne(item.sessionId) },
                onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
                // 双击星标/勾选框不得连带打开会话（dblclick 会绕过 click 的 stopPropagation）。
                onDoubleClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
              })),
            createElement('button', {
              key: 'star',
              type: 'button',
              className: 'dmss_check',
              title: translate(t, favorites.has(item.sessionId) ? 'star.on' : 'star.off'),
              style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px', color: favorites.has(item.sessionId) ? 'var(--dsw-alias-state-warn-label, #d97706)' : 'var(--dsw-alias-label-caption)' },
              onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); toggleFavorite(item.sessionId) },
              onDoubleClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
            }, favorites.has(item.sessionId) ? '★' : '☆'),
            // 改名模式：如果当前行在编辑中则显示输入框
            editing?.id === item.sessionId
              ? createElement('input', {
                  key: 'edit',
                  autoFocus: true,
                  className: 'dmss_search',
                  style: { flex: '1 1 auto', minWidth: 0, height: '20px', fontSize: '12px' },
                  value: editing.draft,
                  onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
                  onDoubleClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
                  onChange: (e: { target: { value: string } }) => { setEditing(prev => prev === null ? prev : { ...prev, draft: e.target.value }) },
                  onKeyDown: (e: { key: string; stopPropagation: () => void }) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') { void handleRename(item, editing.draft) }
                    else if (e.key === 'Escape') { setEditing(null) }
                  },
                })
              : createElement('span', { key: 'x', className: 'dmss_titleText' }, rowTitle(item)),
            item.archived === true && createElement('span', { key: 'arch', className: 'dmss_tagArch' }, translate(t, 'tag.archived')),
            createElement('span', { key: 'tag', className: 'dmss_tag' }, fmtTime(item.updatedAt)),
          ]),
          // 元信息行：短 id + 悬浮全 id + 复制按钮
          createElement('span', { key: 'meta', className: 'dmss_meta' }, [
            createElement('span', { key: 'uuid', className: 'dmss_uuid', title: item.sessionId }, item.sessionId.slice(0, 13)),
            iconBtn('copyId', translate(t, 'row.copyId'),
              iconCopy(),
              false, '',
              () => { handleCopyUUID(item.sessionId) }),
          ]),
          // 行内动作区（hover/focus 显示）
          createElement('div', { key: 'acts', className: 'dmss_rowActions', onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() }, onDoubleClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() } }, [
            iconBtn('pinBtn', translate(t, pinnedIds.has(item.sessionId) ? 'row.unpinAction' : 'row.pinAction'),
              iconPin(pinnedIds.has(item.sessionId)),
              !capabilitiesOf({ archived: item.archived === true || archivedIds.has(item.sessionId), live: liveIds === undefined ? undefined : liveIds.has(item.sessionId) }).pin,
              translate(t, 'row.archivedHint'),
              () => { handlePin(item) }),
            iconBtn('renameBtn', translate(t, 'row.renameAction'),
              iconRename(),
              !capabilitiesOf({ archived: item.archived === true || archivedIds.has(item.sessionId), live: liveIds === undefined ? undefined : liveIds.has(item.sessionId) }).rename,
              translate(t, 'row.archivedHint'),
              () => { setEditing({ id: item.sessionId, draft: item.title }) }),
            iconBtn('cloneBtn', translate(t, 'row.cloneAction'),
              iconClone(),
              !capabilitiesOf({ archived: item.archived === true || archivedIds.has(item.sessionId), live: liveIds === undefined ? undefined : liveIds.has(item.sessionId) }).fork,
              translate(t, 'row.archivedHint'),
              () => { handleFork(item) }),
          ]),
        ])))]),
      ])),
    ),
  ]

  if (selected.size > 0) {
    children.push(createElement('div', { key: 'batch', className: 'dmss_batchBar' }, [
      createElement('span', { key: 'info', className: 'dmss_batchInfo' }, batch.message !== ''
        ? batch.message
        : translate(t, 'manage.selected', { n: selected.size })),
      createElement('button', {
        key: 'archive', type: 'button', className: 'dmss_actBtn', disabled: batch.busy,
        onClick: () => { runBatch('archive') },
      }, translate(t, 'manage.batch.archive')),
      createElement('button', {
        key: 'unarchive', type: 'button', className: 'dmss_actBtn', disabled: batch.busy,
        onClick: () => { runBatch('unarchive') },
      }, translate(t, 'manage.batch.unarchive')),
      createElement('button', {
        key: 'purge', type: 'button',
        // 两步确认的第二步：红底白字实心（对齐宿主原生危险按钮，用户定标
        // 2026-10-20）——白字不赌主题令牌（tip 色在亮色主题下对比度不足）。
        className: `dmss_actBtn${confirmPurge ? ' dmss_btnDangerSolid' : ' dmss_btnDanger'}`, disabled: batch.busy,
        onClick: () => { runBatch('purge') },
      }, confirmPurge ? translate(t, 'manage.batch.confirm') : translate(t, 'manage.batch.delete')),
      batch.busy && createElement('span', { key: 'busy', className: 'dmss_batchInfo' }, translate(t, 'manage.batch.working')),
    ]))
  }

  return createElement('div', { className: 'dmss_manageRoot', style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } }, children)
}

/** Format an epoch-ms timestamp: today → HH:mm, else YYYY-MM-DD HH:mm. */
function fmtTime(ms: number): string {
  if (!ms || typeof ms !== 'number') return ''
  try {
    const d = new Date(ms)
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate()
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (sameDay) return time
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
  } catch {
    return ''
  }
}
