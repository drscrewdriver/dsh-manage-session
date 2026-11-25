/**
 * 会话动作适配层（纯函数 + 注入 getter，无 React 依赖）。
 *
 * 读面：从官方客户端服务快照提取置顶/归档/live 集合；能力判定；置顶优先排序。
 * 写面：置顶、改名、fork 均经官方服务，不自己写会话文件。
 *
 * 约束：所有 get() 包 try/catch，异常转 {ok:false,error}，绝不抛到 React。
 * 零 value-import 官方包：只经注入的 getter 取结构化镜像（与硬约束一致）。
 */

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
 * 调用 sessions.using(id, {source:'workspaceOperation'}, r => r.binding.session.rename(title))。
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
