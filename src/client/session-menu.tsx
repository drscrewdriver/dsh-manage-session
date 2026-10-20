/**
 * 侧栏会话「…」菜单删除臂（2026-10-20 用户定标，按左侧边栏实现换代识别）。
 *
 * 宿主换代事实（主仓 tag 谱系实证）：
 * - ≤0.1.5：ui-workspace 会话菜单**写死** rename/fork/archive，无席位无删除；
 * - ≥0.1.7：菜单行席位化 `sidebar.workspaces.session.menu.item`，宿主自带
 *   pin(100)/rename(200)/fork(300)/archive(400)/session-id(450)——插件行按
 *   order 落位，owner 只给行身份（sessionId + useMenuOpenState + t）。
 * 本臂 order=500（末位，破坏性动作不抢位）。老线（≤0.1.5）inject 静默等待
 * 无害；删除入口在老线仍由搜索面板行内按钮承担（同一 purge 链路）。
 *
 * 可见性：行挂载时探针 index-status.directDelete（管家开关，缺省关）——
 * 非 true（含探针失败/旧宿主半无字段）整行不渲染；两步确认与管理端/面板
 * 同款（第一击上弦变红「确认删除」，第二击执行；点其它处菜单收起即解弦）。
 */
import { createElement, useEffect, useState } from 'react'
import { callHostAny, callSteward, type HostIndexStatus } from './search/host-api.ts'

/** 宿主菜单席位名（0.1.7+ 存在）。 */
export const SESSION_MENU_SEAT = 'sidebar.workspaces.session.menu.item'
/** 本行注册 id（包名空间，避免遮蔽宿主行）。 */
export const SESSION_MENU_DELETE_ID = 'dsh-session-steward.delete'
/** 落位序：宿主末行 session-id(450) 之后。 */
export const SESSION_MENU_DELETE_ORDER = 500

/** 可见性判定（纯叶）：仅显式 true 放行——未知/缺席一律隐藏。 */
export function menuDeleteVisible(directDelete: unknown): boolean {
  return directDelete === true
}

/** owner props 最小面（宿主契约：行身份 + 菜单开合 hook + locale 译器）。 */
export interface StewardMenuDeleteProps {
  sessionId?: string
  useMenuOpenState?: () => [boolean, (open: boolean) => void]
  t?: ((key: string) => string) | undefined
}

/**
 * 菜单行组件：普通 `role="menuitem"` button（不 import ui-primitives——
 * 未声明 peer 在老线 ModuleLoader 下解析有风险，宿主键盘走查只依赖 DOM）。
 * @param props - owner 行身份与菜单开合面。
 * @returns 菜单行或 null（开关关/探针未就绪）。
 */
export function StewardDeleteMenuItem(props: StewardMenuDeleteProps) {
  const { sessionId, useMenuOpenState, t } = props
  const [visible, setVisible] = useState(false)
  const [armed, setArmed] = useState(false)
  // 菜单开合 hook 无条件调用（props 面每次挂载固定，不违反 hooks 规则）。
  const openState = typeof useMenuOpenState === 'function' ? useMenuOpenState() : undefined
  useEffect(() => {
    let disposed = false
    callHostAny<HostIndexStatus>('index-status', {})
      .then((res) => { if (!disposed) setVisible(menuDeleteVisible((res as HostIndexStatus).directDelete)) })
      .catch(() => { if (!disposed) setVisible(false) })
    return () => { disposed = true }
  }, [])
  if (sessionId === undefined || sessionId === '' || !visible) return null
  const fire = (): void => {
    openState?.[1](false)
    callSteward<{ purged?: number }>('session-history-purge', { sessionIds: [sessionId] })
      .then((res) => {
        if (res.ok !== true) console.warn('steward menu delete failed:', res.error ?? 'unknown')
      })
      .catch((err: unknown) => { console.warn('steward menu delete failed:', err) })
  }
  return createElement('button', {
    type: 'button',
    role: 'menuitem',
    // dedup 钩子：老线 DOM 注入臂据此判断菜单是否已有删除行（现代线席位行
    // 已渲染则跳过注入，避免两条删除）。
    'data-steward-menu-delete': '1',
    style: {
      display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
      boxSizing: 'border-box', padding: '6px 10px', margin: 0, border: 'none',
      background: armed ? 'rgba(255, 99, 99, 0.12)' : 'transparent',
      color: armed ? 'var(--dsw-alias-state-error-primary, #e5484d)' : 'inherit',
      font: 'inherit', fontSize: '13px', lineHeight: '18px', textAlign: 'start',
      cursor: 'pointer', borderRadius: '6px',
    },
    onClick: () => {
      if (armed) { fire(); return }
      setArmed(true)
    },
    // 指针移出菜单行区域即解弦（防误触残留态；菜单容器关闭由卸载兜底）。
    onMouseLeave: () => { setArmed(false) },
  }, armed ? (t?.('menu.deleteSession.confirm') ?? '确认删除') : (t?.('menu.deleteSession') ?? '删除会话'))
}
