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
import { createElement, useEffect, useMemo, useState, type ReactElement } from 'react'
import { callSteward, callStewardItems, type HostSessionItem } from './host-api.ts'
import { translate, type LocaleKey } from './manage-locales.ts'

/** 管理台字典面（search 子域命名空间的键集）。 */
export type ManageTranslate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** 样式（幂等注入;类名沿用 dmss_ 前缀,与搜索面板共享视觉语言）。 */
function injectManageStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector('style[data-plugin-css="dsh-manage-sessions/manage"]') !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-manage-sessions'
  tag.dataset.pluginCss = 'dsh-manage-sessions/manage'
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
.dmss_row{box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:0;height:auto;margin:0;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.05));color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:border-color .14s ease-out,background-color .14s ease-out}
.dmss_row:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dmss_rowTitle{display:flex;align-items:center;gap:6px;min-width:0;width:100%}
.dmss_titleText{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px;font-weight:500}
.dmss_tag{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dmss_meta{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dmss_check{flex:none;display:inline-flex;align-items:center}
.dmss_check input{width:13px;height:13px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.dmss_tagArch{flex:none;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-caption));font-size:10px;line-height:16px;border:1px solid currentColor;border-radius:999px;padding:0 6px;white-space:nowrap}
.dmss_batchBar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dmss_batchInfo{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
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
`
  document.head.appendChild(tag)
  return () => {
    if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
  }
}

/** 批量管理台主体（自持语料/勾选/批量状态）。 */
export function ManageConsole({ t, open }: { t?: ManageTranslate; open: (sessionId: string) => void }): ReactElement {
  const [sessions, setSessions] = useState<HostSessionItem[] | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [batch, setBatch] = useState<{ busy: boolean; message: string; ok: boolean }>({ busy: false, message: '', ok: true })
  const [confirmPurge, setConfirmPurge] = useState(false)
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

  // 语料：挂载取一次;批量成功后 setSessions(null) 重取（宿主半已联动索引）。
  useEffect(() => {
    if (sessions !== null) return
    let cancelled = false
    callStewardItems<HostSessionItem>('session-catalog', {}).then((res) => {
      if (cancelled) return
      if (res.ok) { setSessions(res.items); setSelected(new Set()); setConfirmPurge(false) }
      else setSessionsError(res.error ?? '读取会话列表失败')
    })
    return () => { cancelled = true }
  }, [sessions])

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
      .map(([cwd, items]) => ({ cwd, items }))
  }, [sessions, domain, favoritesOnly, favorites, workspaceFilter])

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

  /** 文本过滤:标题/cwd 子串,大小写折叠。 */
  const matchesText = (item: HostSessionItem): boolean => {
    const needle = textFilter.trim().toLowerCase()
    if (needle === '') return true
    return item.title.toLowerCase().includes(needle) || item.cwd.toLowerCase().includes(needle)
  }

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
    void callSteward<{ added?: number; removed?: number; purged?: number; requiresRestart?: boolean }>(method, { sessionIds: ids }).then((res) => {
      const base = !res.ok
        ? translate(t, 'manage.done.error', { error: res.error ?? '?' })
        : kind === 'archive'
          ? translate(t, 'manage.done.archive', { n: res.added ?? ids.length })
          : kind === 'unarchive'
            ? translate(t, 'manage.done.unarchive', { n: res.removed ?? ids.length })
            : translate(t, 'manage.done.purge', { n: res.purged ?? ids.length })
      // 及时性如实呈现:内存路径即时生效;文件降级路径才需要重启。
      const message = res.ok === true && res.requiresRestart === true
        ? `${base} ${translate(t, 'manage.done.restart')}`
        : base
      setBatch({ busy: false, message, ok: res.ok === true })
      if (res.ok) {
        setSelected(new Set())
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
    ]),
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
        ]),
        ...(collapsedGroups.has(group.cwd) ? [] : [createElement('div', {
          key: 'grid',
          className: 'dmss_grid',
        }, group.items.filter(item => matchesText(item)).map(item => createElement('div', {
          key: item.sessionId,
          role: 'button',
          tabIndex: 0,
          className: 'dmss_row',
          title: item.title || translate(t, 'panel.untitled'),
          onClick: () => { open(item.sessionId) },
          onKeyDown: (e: { key: string }) => { if (e.key === 'Enter' || e.key === ' ') open(item.sessionId) },
        }, [
          createElement('span', { key: 'line', className: 'dmss_rowTitle' }, [
            createElement('span', { key: 'check', className: 'dmss_check' },
              createElement('input', {
                type: 'checkbox',
                checked: selected.has(item.sessionId),
                onChange: () => { toggleOne(item.sessionId) },
                onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
              })),
            createElement('button', {
              key: 'star',
              type: 'button',
              className: 'dmss_check',
              title: translate(t, favorites.has(item.sessionId) ? 'star.on' : 'star.off'),
              style: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px', color: favorites.has(item.sessionId) ? 'var(--dsw-alias-state-warn-label, #d97706)' : 'var(--dsw-alias-label-caption)' },
              onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); toggleFavorite(item.sessionId) },
            }, favorites.has(item.sessionId) ? '★' : '☆'),
            createElement('span', { key: 'x', className: 'dmss_titleText' }, item.title || translate(t, 'panel.untitled')),
            item.archived === true && createElement('span', { key: 'arch', className: 'dmss_tagArch' }, translate(t, 'tag.archived')),
            createElement('span', { key: 'tag', className: 'dmss_tag' }, fmtTime(item.updatedAt)),
          ]),
          createElement('span', { key: 'meta', className: 'dmss_meta' }, item.cwd),
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
