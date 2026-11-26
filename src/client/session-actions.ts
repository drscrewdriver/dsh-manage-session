/**
 * 会话动作适配层（纯函数 + 注入 getter，无 React 依赖）。
 *
 * 读面：从官方客户端服务快照提取置顶/归档/live 集合；能力判定；置顶优先排序。
 * 写面：改名优先走 host durable 路由（`session-rename`），置顶与 fork 经官方服务。
 *
 * 约束：所有 get() 包 try/catch，异常转 {ok:false,error}，绝不抛到 React。
 * 零 value-import 官方包：只经注入的 getter 取结构化镜像（与硬约束一致）。
 */
import { callHostAny } from './host-api.ts'

/** 服务 getter 签名（由 apply 侧传入 `name => ctx.get(name)`）。 */
export type ServiceGetter = (name: string) => unknown

/** 动作结果。 */
export interface SessionActionResult {
  ok: boolean
  error?: string
  childId?: string
}

/** 行能力判定（归档/live 三态）。 */
export interface ActionCapabilities {
  pin: boolean
  rename: boolean
  fork: boolean
}

// ── 读面 ──────────────────────────────────────────────────────────────────────

/**
 * 从 workspaces.list() 快照读取置顶 session id 集合。
 * 服务缺席/异常 → 空集。
 */
export function readPinnedIds(get: ServiceGetter): ReadonlySet<string> {
  try {
    const svc = get('workspaces') as { list?(): { pinnedSessionIds?: string[] } } | undefined
    const snap = svc?.list?.()
    if (!snap || !Array.isArray(snap.pinnedSessionIds)) return new Set()
    return new Set(snap.pinnedSessionIds)
  } catch {
    return new Set()
  }
}

/**
 * 从 workspaces.list() 快照读取归档 session id 集合。
 * 服务缺席/异常 → 空集。
 */
export function readArchivedIds(get: ServiceGetter): ReadonlySet<string> {
  try {
    const svc = get('workspaces') as { list?(): { archivedSessionIds?: string[] } } | undefined
    const snap = svc?.list?.()
    if (!snap || !Array.isArray(snap.archivedSessionIds)) return new Set()
    return new Set(snap.archivedSessionIds)
  } catch {
    return new Set()
  }
}

/**
 * 从 sessions.list() 快照读取 live session id 集合。
 * 服务缺席/异常 → undefined（表示"未知"，由 capabilitiesOf 处理）。
 */
export function readLiveIds(get: ServiceGetter): ReadonlySet<string> | undefined {
  try {
    const svc = get('sessions') as { list?(): { byId?: unknown } } | undefined
    const snap = svc?.list?.()
    if (!snap) return undefined
    const raw = snap.byId
    if (raw instanceof Map) return new Set(raw.keys())
    if (raw !== null && typeof raw === 'object') return new Set(Object.keys(raw))
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 行能力判定。
 * @param archived  - 行是否处于归档状态
 * @param live      - live 集合（undefined = sessions 服务缺席）
 */
export function capabilitiesOf(
  input: { archived: boolean; live: boolean | undefined },
): ActionCapabilities {
  const { archived, live } = input
  return {
    pin: !archived,
    rename: !archived && live !== false,
    fork: !archived && live !== false,
  }
}

/**
 * 将置顶行提到列表前，保持组内相对顺序（稳定排序）。
 */
export function sortPinnedFirst<T extends { sessionId: string }>(
  items: readonly T[],
  pinned: ReadonlySet<string>,
): T[] {
  if (pinned.size === 0) return [...items]
  const pinnedItems: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (pinned.has(item.sessionId)) pinnedItems.push(item)
    else rest.push(item)
  }
  return [...pinnedItems, ...rest]
}

// ── 写面 ──────────────────────────────────────────────────────────────────────

/**
 * 置顶/取消置顶。归档会话直接返回错误。
 * 调用 uiWorkspace.pinSession / unpinSession。
 */
export async function togglePin(
  get: ServiceGetter,
  id: string,
  pinned: boolean,
): Promise<SessionActionResult> {
  // 归档检查
  const archivedIds = readArchivedIds(get)
  if (archivedIds.has(id)) {
    return { ok: false, error: '归档会话不支持置顶' }
  }
  try {
    const uiWorkspace = get('uiWorkspace') as {
      pinSession?: (id: string) => void | Promise<void>
      unpinSession?: (id: string) => void | Promise<void>
    } | undefined
    if (pinned) {
      if (typeof uiWorkspace?.pinSession !== 'function') {
        return { ok: false, error: '宿主未提供 pinSession 服务' }
      }
      await uiWorkspace.pinSession(id)
    } else {
      if (typeof uiWorkspace?.unpinSession !== 'function') {
        return { ok: false, error: '宿主未提供 unpinSession 服务' }
      }
      await uiWorkspace.unpinSession(id)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

/**
 * 重命名会话（trim 空名拒绝）。
 *
 * **优先走 host 半身的 `session-rename`**（`sessionController.session.rename`，
 * 不打开会话历史、成功后宿主侧标题 memo 会失效）。之所以不再默认走
 * `sessions.using(...).binding.session.rename()`：那条路要 retain 并打开会话历史，
 * 且改名后本插件 host 的标题 memo（5 min TTL）不知道要失效 —— 面板任何重取都会
 * 把标题覆盖回旧值，用户体感就是「改完又变回去」。
 *
 * 老宿主（无 `sessionController`）返回 `service-unavailable`，此时降级到旧路径，
 * 保证旧线仍能改名（代价是那个已知的 memo 时序问题）。
 */
export async function renameSession(
  get: ServiceGetter,
  id: string,
  title: string,
): Promise<SessionActionResult> {
  const trimmed = title.trim()
  if (trimmed === '') {
    return { ok: false, error: '名称不能为空' }
  }
  const viaHost = await renameViaHostRoute(id, trimmed)
  if (viaHost.ok) return viaHost
  if (viaHost.code !== 'service-unavailable' && viaHost.code !== 'route-unavailable') return viaHost
  return renameViaClientService(get, id, trimmed)
}

/**
 * 经本插件 host 路由改名。
 *
 * 可降级的两类失败（返回 `service-unavailable` / `route-unavailable`）：
 * - 宿主没有 `sessionController`（老宿主，host 方法自己回 `service-unavailable`）；
 * - 路由本身不可达（老版本 host 半身没这个方法 → HTTP 4xx；或 fetch 层异常）。
 * 其它失败（宿主明确拒绝，如标题非法）不降级 —— 降级只会把同一个错误再抛一次。
 * @param id - 会话 id。
 * @param title - 已 trim 的标题。
 * @returns 动作结果；`code` 供调用方判断能否降级。
 */
async function renameViaHostRoute(id: string, title: string): Promise<SessionActionResult & { code?: string }> {
  const res = await callHostAny<{ title?: string; seq?: number; code?: string }>('session-rename', { sessionId: id, title })
  if (res.ok === true) {
    return { ok: true, ...(typeof res.title === 'string' ? { title: res.title } : {}) } as SessionActionResult & { code?: string }
  }
  const code = typeof res.code === 'string' && res.code !== '' ? res.code : ''
  if (code !== '') return { ok: false, error: res.error ?? '重命名失败', code }
  const error = res.error ?? '重命名失败'
  // 无宿主错误码 = 根本没走到 host 方法体：HTTP 4xx/5xx、fetch 层异常，
  // 或相对 URL 无法解析（非浏览器宿主 / node 单测环境）。
  if (/^HTTP \d+$/i.test(error) || /fetch|network|parse URL|invalid URL/i.test(error)) {
    return { ok: false, error, code: 'route-unavailable' }
  }
  return { ok: false, error }
}

/**
 * 旧路径（老宿主降级）：`sessions.using(id, {source:'workspaceOperation'}, r => r.binding.session.rename(title))`。
 */
async function renameViaClientService(
  get: ServiceGetter,
  id: string,
  trimmed: string,
): Promise<SessionActionResult> {
  try {
    const sessions = get('sessions') as {
      using?: (
        id: string,
        opts: { source: string },
        fn: (r: { binding: { session: { rename: (t: string) => { ok?: boolean; error?: { message?: string } } } } }) => unknown,
      ) => { ok?: boolean; error?: { message?: string }; result?: unknown } | Promise<{ ok?: boolean; error?: { message?: string }; result?: unknown }>
    } | undefined
    if (typeof sessions?.using !== 'function') {
      return { ok: false, error: '宿主未提供 sessions.using 服务' }
    }
    const res = await sessions.using(id, { source: 'workspaceOperation' }, (r) => {
      return r.binding.session.rename(trimmed)
    })
    // using() 本身可能返回 {ok:false}
    if (res?.ok === false) {
      return { ok: false, error: res.error?.message ?? '重命名失败' }
    }
    // rename() 的返回值
    const renameResult = res as { ok?: boolean; error?: { message?: string } } | undefined
    if (renameResult?.ok === false) {
      return { ok: false, error: renameResult.error?.message ?? '重命名失败' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

/**
 * Fork 会话，返回子会话 id。
 * 调用 uiWorkspace.forkSession(id, cb)。
 */
export async function forkSession(
  get: ServiceGetter,
  id: string,
): Promise<SessionActionResult> {
  try {
    const uiWorkspace = get('uiWorkspace') as {
      forkSession?: (id: string, cb: (err: unknown, childId?: string) => void) => void
    } | undefined
    if (typeof uiWorkspace?.forkSession !== 'function') {
      return { ok: false, error: '宿主未提供 forkSession 服务' }
    }
    return new Promise<SessionActionResult>((resolve) => {
      uiWorkspace.forkSession!(id, (err, childId) => {
        if (err) {
          resolve({ ok: false, error: String(err instanceof Error ? err.message : err) })
        } else {
          resolve({ ok: true, childId })
        }
      })
    })
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}
