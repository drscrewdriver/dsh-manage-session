/**
 * 侧栏菜单删除臂断言（session-menu）：可见性纯叶（仅显式 true 放行——
 * undefined/false/字符串一律隐藏）与注册面常量（席位名/id 命名空间/order 末位）。
 * 组件渲染面依赖宿主席位 owner props，不在本套件覆盖（真机目视；
 * 面板行内删除的既有套件已盖同款 purge 调用链）。
 */
import { describe, expect, it } from 'vitest'
import {
  menuDeleteVisible, SESSION_MENU_DELETE_ID, SESSION_MENU_DELETE_ORDER, SESSION_MENU_SEAT,
} from '../src/client/session-menu.tsx'

describe('menuDeleteVisible', () => {
  it('仅显式 true 放行（未知/缺席/假值一律隐藏）', () => {
    expect(menuDeleteVisible(true)).toBe(true)
    expect(menuDeleteVisible(false)).toBe(false)
    expect(menuDeleteVisible(undefined)).toBe(false)
    expect(menuDeleteVisible('true')).toBe(false)
    expect(menuDeleteVisible(1)).toBe(false)
  })
})

describe('注册面常量', () => {
  it('席位名与宿主契约同串；id 带包名空间；order 落宿主行（450）之后', () => {
    expect(SESSION_MENU_SEAT).toBe('sidebar.workspaces.session.menu.item')
    expect(SESSION_MENU_DELETE_ID).toBe('dsh-manage-session.delete')
    expect(SESSION_MENU_DELETE_ORDER).toBeGreaterThan(450)
  })
})
