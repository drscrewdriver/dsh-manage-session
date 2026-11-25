/**
 * 官方 open-in-app 路由适配层（纯函数，无 React 依赖）。
 *
 * 路由来源：host/open-in-app/src/shared.ts
 * - GET  /open-in-app/apps   → { apps: string[] }
 * - POST /open-in-app/open   → { ok:true } | { code, message }
 *
 * 缺席/未授权：fetchOpenInApps 返回空集 → 分组头按钮不出现。
 * 只在 path 非空且绝对路径时发起 launch。
 */

/** 路由常量。 */
export const OPEN_IN_APP_APPS_ROUTE = 'open-in-app/apps'
export const OPEN_IN_APP_OPEN_ROUTE = 'open-in-app/open'

/** 资源管理器候选 id（优先级：Windows → macOS → Linux）。 */
const EXPLORER_APPS = ['explorer', 'finder', 'filemanager'] as const

/** Git 工具候选 id（gitbash 优先，退 GitHub Desktop/Fork/SourceTree 等）。 */
const GIT_APPS = ['gitbash', 'github', 'fork', 'sourcetree', 'gitkraken', 'smartgit', 'sublimemerge'] as const

// ── 纯函数：从 payload 选应用 ──────────────────────────────────────────────────

/**
 * 从 /apps payload 选资源管理器 app id。
 * payload 非数组或无可选项 → undefined。
 */
export function pickExplorerApp(payload: unknown): string | undefined {
  return pickFirstFromPayload(payload, EXPLORER_APPS)
}

/**
 * 从 /apps payload 选 Git 工具 app id（gitbash 优先）。
 */
export function pickGitApp(payload: unknown): string | undefined {
  return pickFirstFromPayload(payload, GIT_APPS)
}

function pickFirstFromPayload(payload: unknown, candidates: readonly string[]): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const apps = (payload as { apps?: unknown }).apps
  if (!Array.isArray(apps)) return undefined
  const set = new Set(apps.filter((x): x is string => typeof x === 'string'))
  for (const id of candidates) {
    if (set.has(id)) return id
  }
  return undefined
}

/**
 * 将 /open 路由失败映射为可读字符串。
 * 401 → 宿主未启用；其余取 payload.message。
 */
export function openInAppFailure(status: number, payload: unknown): string {
  if (status === 401) return "宿主未启用『在应用中打开』"
  if (payload !== null && typeof payload === 'object') {
    const msg = (payload as { message?: unknown }).message
    if (typeof msg === 'string' && msg !== '') return msg
    const code = (payload as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return `open-in-app 请求失败（HTTP ${status}）`
}

// ── 异步函数：fetch 路由 ─────────────────────────────────────────────────────

/**
 * 获取可用应用集合。401/404/网络错 → 空集。
 * @param fetchImpl - 可注入的 fetch 实现（测试用），缺省用全局 fetch。
 */
export async function fetchOpenInApps(
  fetchImpl?: typeof fetch,
): Promise<ReadonlySet<string>> {
  const doFetch = fetchImpl ?? globalThis.fetch
  try {
    const res = await doFetch(`/${OPEN_IN_APP_APPS_ROUTE}`, { method: 'GET' })
    if (!res.ok) return new Set()
    const payload: unknown = await res.json()
    if (payload === null || typeof payload !== 'object') return new Set()
    const apps = (payload as { apps?: unknown }).apps
    if (!Array.isArray(apps)) return new Set()
    return new Set(apps.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

/**
 * 用 app 打开 path。
 * 只在 path 非空且为绝对路径时发起；否则直接返回错误。
 * @param fetchImpl - 可注入 fetch（测试用）。
 */
export async function launchOpenInApp(
  app: string,
  path: string,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (app === '') return { ok: false, error: '未指定应用' }
  if (path === '' || !isAbsolutePath(path)) {
    return { ok: false, error: '路径为空或非绝对路径' }
  }
  const doFetch = fetchImpl ?? globalThis.fetch
  try {
    const res = await doFetch(`/${OPEN_IN_APP_OPEN_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app, path }),
    })
    let payload: unknown
    try { payload = await res.json() } catch { payload = undefined }
    if (res.ok) return { ok: true }
    return { ok: false, error: openInAppFailure(res.status, payload) }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

/** 简单绝对路径检测：Windows 盘符或 / 开头。 */
function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[/\\]/u.test(p) || p.startsWith('/')
}
