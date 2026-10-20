/**
 * 会话管家面板壳：一个侧边栏入口，两个页签（管理=主页面 / 体检=备用）。
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
import { HealthPanel } from './health-panel.tsx'
import { ManageConsole } from './search/manage.tsx'
import { translate, type LocaleKey } from './locales.ts'

/** 面板字典面。 */
export type PanelTranslate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** 页签 id（导出供测试断言）。 */
export const TAB_HEALTH = 'dss-tab-health'
export const TAB_MANAGE = 'dss-tab-manage'

/** 面板入参。 */
export interface StewardPanelProps {
  t?: PanelTranslate
  /** 健康检查子域是否可见。 */
  healthCheck: boolean
  /** 搜索子域是否启用（启用才有「管理」页签——它读统一索引语料）。 */
  searchEnabled?: boolean
  /** 打开会话（管理台行点击;apply 侧经 openSessionThrough 解析）。 */
  openSession?: (sessionId: string) => void
  onClose: () => void
}

/** 会话管家对话框。 */
export function StewardPanel({ t, healthCheck, searchEnabled = false, openSession, onClose }: StewardPanelProps): ReactElement {
  // 主页面=管理；管理关闭时退到体检兜底。
  const [tab, setTab] = useState<'health' | 'manage'>(searchEnabled ? 'manage' : 'health')

  // 开关变化后收敛到仍然可见的页签。
  useEffect(() => {
    if (tab === 'manage' && !searchEnabled && healthCheck) setTab('health')
    if (tab === 'health' && !healthCheck && searchEnabled) setTab('manage')
  }, [tab, healthCheck, searchEnabled])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const tabs: ReactElement[] = []
  if (searchEnabled) {
    tabs.push(createElement('button', {
      key: TAB_MANAGE,
      id: TAB_MANAGE,
      type: 'button',
      className: `dss_tab${tab === 'manage' ? ' dss_tabActive' : ''}`,
      'aria-selected': tab === 'manage',
      onClick: () => { setTab('manage') },
    }, translate(t, 'panel.tab.manage')))
  }
  if (healthCheck) {
    tabs.push(createElement('button', {
      key: TAB_HEALTH,
      id: TAB_HEALTH,
      type: 'button',
      className: `dss_tab${tab === 'health' ? ' dss_tabActive' : ''}`,
      'aria-selected': tab === 'health',
      onClick: () => { setTab('health') },
    }, translate(t, 'panel.tab.health')))
  }

  const body: ReactElement = tab === 'manage' && searchEnabled
    ? createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
        createElement(ManageConsole, { open: openSession ?? (() => {}) }))
    : tab === 'health' && healthCheck
      ? createElement(HealthPanel, { t, onClose })
      : createElement('div', { className: 'dss_empty' }, translate(t, 'card.enabled.desc'))

  return createPortal(createElement('div', { key: 'steward-root' }, [
    createElement('div', { key: 'backdrop', className: 'dss_backdrop', onClick: onClose }),
    createElement('div', {
      key: 'panel',
      className: 'dss_panel',
      role: 'dialog',
      'aria-label': translate(t, 'panel.title'),
      style: { display: 'flex', flexDirection: 'column' },
    }, [
      createElement('div', { key: 'head', className: 'dss_dialogHead' }, [
        createElement('span', { key: 'title', className: 'dss_dialogTitle' }, translate(t, 'panel.title')),
        createElement('span', { key: 'tabs', className: 'dss_tabRow' }, tabs),
        createElement('button', {
          key: 'close',
          type: 'button',
          className: 'dss_actBtn',
          onClick: onClose,
        }, translate(t, 'panel.close')),
      ]),
      body,
    ]),
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
    className: wide ? 'dss_footerEntry' : 'dss_footerEntry dss_footerEntryRail',
    title: props.title,
    'aria-label': props.title,
    onClick: props.onClick,
  }, [
    createElement('span', { key: 'icon', className: 'dss_footerIcon', 'aria-hidden': true }, '🧭'),
    // 收起轨道里 36px 装不下文案，标签与宽栏同条件出现，与搜索入口一致。
    wide && props.label !== undefined
      ? createElement('span', { key: 'label', className: 'dss_footerLabel' }, props.label)
      : null,
  ])
}
