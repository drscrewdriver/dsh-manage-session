/**
 * 会话管理面板壳：一个侧边栏入口，两个页签（管理=主页面 / 体检=备用）。
 *
 * 2026-10-20 页面调整（用户定标）：「养老院」页签取消——管理台已覆盖其全部
 * 动作面（archive/unarchive/purge + 归档域筛选），独立页签属重复入口；
 * 历史文件组件（history-panel.tsx）随摘除，宿主侧 history 路由与配置字段
 * （historyFiles）保留不动，字典键留用以备回迁。
 *
 * 页签可见性由开关决定：`search=false` 时「管理」消失（退到体检），
 * `healthCheck=false` 时「体检」消失；两者都关时进入面板直接显示空壳提示
 * （客户端也会隐藏入口）。
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { CleanupPanel } from './cleanup-panel.tsx'
import { HealthPanel } from './health-panel.tsx'
import { ManageConsole } from './manage.tsx'
import { translate, type LocaleKey } from './locales.ts'
import type { OpenSessionOutcome } from './host-api.ts'
import type { ServiceGetter } from './session-actions.ts'

/** 面板字典面。 */
export type PanelTranslate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** 页签 id（导出供测试断言）。 */
export const TAB_HEALTH = 'dms-tab-health'
export const TAB_MANAGE = 'dms-tab-manage'
export const TAB_CLEANUP = 'dms-tab-cleanup'

/** 面板入参。 */
export interface StewardPanelProps {
  t?: PanelTranslate
  /** 健康检查子域是否可见（关掉只剩管理页签）。 */
  healthCheck: boolean
  /** 历史/删除子域是否可见（关掉隐藏「清理」页签）。 */
  historyFiles?: boolean
  /**
   * 打开会话（管理台行点击;apply 侧经 `openSessionSafely` 解析：
   * 先退面板页、下一帧再导航，失败不抛错）。
   */
  openSession?: (sessionId: string, options?: { defer?: boolean; onError?: (message: string) => void }) => OpenSessionOutcome
  onClose: () => void
  /**
   * 壳形态：`dialog`（缺省）= 背景遮罩上的浮动对话框（底栏入口用）；
   * `page` = 填满主栏的整页（顶栏工具行入口用，无遮罩 / 无圆角阴影）。
   */
  variant?: 'dialog' | 'page'
  /** 官方服务 getter（动作层用），缺省 = undefined 降级（按钮不渲染）。 */
  services?: ServiceGetter
}

/** 会话管理对话框 / 整页。 */
export function StewardPanel({ t, healthCheck, historyFiles = true, openSession, onClose, variant = 'dialog', services }: StewardPanelProps): ReactElement {
  // 主页面=管理（会话管理台）；体检与清理是后台页签（用户定标：清理放体检旁）。
  const [tab, setTab] = useState<'health' | 'manage' | 'cleanup'>('manage')

  // 开关变化后收敛到仍然可见的页签（体检关掉→回管理；删除子域关掉→清理也不可进）。
  useEffect(() => {
    if (tab === 'health' && !healthCheck) setTab('manage')
    if (tab === 'cleanup' && !historyFiles) setTab('manage')
  }, [tab, healthCheck, historyFiles])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const tabs: ReactElement[] = []
  tabs.push(createElement('button', {
    key: TAB_MANAGE,
    id: TAB_MANAGE,
    type: 'button',
    className: `dms_tab${tab === 'manage' ? ' dms_tabActive' : ''}`,
    'aria-selected': tab === 'manage',
    onClick: () => { setTab('manage') },
  }, translate(t, 'panel.tab.manage')))
  if (healthCheck) {
    tabs.push(createElement('button', {
      key: TAB_HEALTH,
      id: TAB_HEALTH,
      type: 'button',
      className: `dms_tab${tab === 'health' ? ' dms_tabActive' : ''}`,
      'aria-selected': tab === 'health',
      onClick: () => { setTab('health') },
    }, translate(t, 'panel.tab.health')))
  }
  if (historyFiles) {
    tabs.push(createElement('button', {
      key: TAB_CLEANUP,
      id: TAB_CLEANUP,
      type: 'button',
      className: `dms_tab${tab === 'cleanup' ? ' dms_tabActive' : ''}`,
      'aria-selected': tab === 'cleanup',
      onClick: () => { setTab('cleanup') },
    }, translate(t, 'panel.tab.cleanup')))
  }

  const body: ReactElement = tab === 'manage'
    ? createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
        createElement(ManageConsole, {
          open: openSession ?? (() => ({ ok: false, error: '' })),
          // 整页形态必须退页后再延一帧导航，否则第一次点击只能把页面关掉。
          deferOpen: variant === 'page',
          services,
        }))
    : tab === 'health'
      ? createElement(HealthPanel, { t, onClose })
      : createElement(CleanupPanel, {})

  const panelEl = createElement('div', {
    key: 'panel',
    className: variant === 'page' ? 'dms_panel dms_panelPage' : 'dms_panel',
    role: variant === 'page' ? 'region' : 'dialog',
    'aria-label': translate(t, 'panel.title'),
    style: { display: 'flex', flexDirection: 'column' },
  }, [
    createElement('div', { key: 'head', className: 'dms_dialogHead' }, [
      createElement('span', { key: 'title', className: 'dms_dialogTitle' }, translate(t, 'panel.title')),
      createElement('span', { key: 'tabs', className: 'dms_tabRow' }, tabs),
      createElement('button', {
        key: 'close',
        type: 'button',
        className: 'dms_actBtn',
        onClick: onClose,
      }, translate(t, 'panel.close')),
    ]),
    body,
  ])

  // 整页形态直接占用主栏（宿主已给页容器，不再叠遮罩 / 传送门）。
  if (variant === 'page') return panelEl
  return createPortal(createElement('div', { key: 'steward-root' }, [
    createElement('div', { key: 'backdrop', className: 'dms_backdrop', onClick: onClose }),
    panelEl,
  ]), document.body)
}

/** 侧边栏脚部入口：宽栏带文案成行控件，收起轨道退化为 36x36 图标钮。 */
export function StewardFooter(props: {
  onClick?: () => void
  title?: string
  label?: string
  wide?: boolean
}): ReactElement {
  const wide = props.wide === true
  return createElement('button', {
    type: 'button',
    className: wide ? 'dms_footerEntry' : 'dms_footerEntry dms_footerEntryRail',
    title: props.title,
    'aria-label': props.title,
    onClick: props.onClick,
  }, [
    createElement('span', { key: 'icon', className: 'dms_footerIcon', 'aria-hidden': true }, '🧭'),
    // 收起轨道里 36px 装不下文案，标签与宽栏同条件出现，与搜索入口一致。
    wide && props.label !== undefined
      ? createElement('span', { key: 'label', className: 'dms_footerLabel' }, props.label)
      : null,
  ])
}
