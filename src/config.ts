/**
 * dsh-manage-sessions 的共享配置面（会话管理器：归档 + 体检）。
 *
 * 与 host 半身（schemastery schema 在 src/index.ts）以及浏览器半身共用同一形状，
 * 使一处 admitted 的值在另一处也 admitted。
 *
 * 设置命名空间只有一个：`manage-sessions`（enabled/historyFiles/healthCheck/directDelete）。
 * 搜索/索引子域已拆回 dsh-search-index，本包不再持有 `search` 开关、索引目录、
 * 语料源（DRS）等字段——DRS 依赖也随搜索一起迁回那边。
 */

/** 会话管理运行时配置（设置命名空间 + 组合入口）。 */
export interface StewardConfig {
  /** 插件总开关（关闭后不注册任何子域路由）。 */
  enabled: boolean
  /** 会话历史文件（归档浏览与清理）。关闭后不注册 history 路由。 */
  historyFiles?: boolean
  /** 会话健康检查（体检 → 处方 → 出院）。关闭后不注册 health 路由、不渲染「体检」页签。 */
  healthCheck?: boolean
  /**
   * 直接删除入口（2026-10-20 用户定标）：开启后侧栏会话菜单出现「删除」行
   * （两步确认，走管理端同款 session-history-purge 链路）。
   * **缺省关**——破坏性入口不默认铺开；管理端批量删除不受本开关限制。
   */
  directDelete?: boolean
}

/** 缺省值。 */
export const DEFAULT_CONFIG: Required<StewardConfig> = {
  enabled: true,
  historyFiles: true,
  healthCheck: true,
  directDelete: false,
}

/** host 半身注册的设置命名空间（与 src/index.ts 保持一致）。 */
export const STEWARD_SETTINGS_NAMESPACE = 'manage-sessions'

/** 侧边栏入口 id（客户端注册 id）。 */
export const STEWARD_ENTRY_ID = 'dsh-manage-sessions'

/** host 路由前缀（管理 + 体检，方法名一律 `session-*`）。 */
export const STEWARD_API_PREFIX = '/manage-sessions/api'
