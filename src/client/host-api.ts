/**
 * 客户端 host 调用助手：一切经 fenced `/manage-session/api/<method>` 路由，
 * 不 value-import 任何官方包（与 dsh-session-search-toggle 的 host-api.ts 同范式，
 * 仅把路由前缀换成会话管理自己的）。
 */

/** 单次 host 调用超时（导入类大响应可单独放宽）。 */
const FETCH_TIMEOUT = 20_000

/** POST 一个 JSON body 到会话管理的 fenced API（items 形状）。 */
export function callHost<T>(method: string, body: unknown): Promise<{ ok: boolean; items: T[]; error?: string }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
  const timer = controller !== undefined && typeof setTimeout === 'function'
    ? setTimeout(() => { controller.abort() }, FETCH_TIMEOUT)
    : undefined
  return fetch(`/manage-session/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller?.signal,
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: unknown) => {
      const record = data as { ok?: boolean; items?: T[]; error?: string }
      if (record && record.ok === true && Array.isArray(record.items)) {
        return { ok: true, items: record.items }
      }
      return { ok: false, items: [], error: record?.error ?? '请求失败' }
    })
    .catch((err: unknown) => ({
      ok: false,
      items: [],
      error: err instanceof DOMException && err.name === 'AbortError' ? '请求超时' : String(err instanceof Error ? err.message : err),
    }))
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
}

/** POST 一个 JSON body，返回整条记录。 */
export function callHostAny<T>(
  method: string,
  body: unknown,
  timeout = FETCH_TIMEOUT,
): Promise<Partial<T> & { ok: boolean; error?: string }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
  const timer = typeof setTimeout === 'function'
    ? setTimeout(() => { controller?.abort() }, timeout)
    : undefined
  return fetch(`/manage-session/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller?.signal,
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch((err: unknown) => ({
      ok: false,
      error: err instanceof DOMException && err.name === 'AbortError' ? '请求超时' : String(err instanceof Error ? err.message : err),
    }))
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
}

/** 一条历史文件行（与 host 侧 StewardHistoryRow 对齐）。 */
export interface HistoryRow {
  sessionId: string
  title: string
  cwd: string
  updatedAt: number
  /** 转录目录占用字节数（0 = 未知或磁盘上无实体）。 */
  bytes: number
  /** 投影缓存占用字节数。 */
  cacheBytes: number
  /** 署名转换备份占用字节数（`bytes` 的子集，单列防误读）。 */
  backupBytes: number
}

/** 历史文件列表响应。 */
export interface HistoryListResponse {
  ok: boolean
  items?: HistoryRow[]
  source?: 'registry' | 'storage-file' | 'none'
  degraded?: string
  /** 已从存储文件移除、但宿主内存里仍生效的 id 数。 */
  pendingRestart?: number
  error?: string
}

/** 归档文件清理（真删除）响应。 */
export interface HistoryPurgeResponse {
  ok: boolean
  purged?: number
  freedBytes?: number
  /** 一并删除的署名转换备份个数。 */
  backupsRemoved?: number
  failures?: { sessionId: string; reason: string }[]
  requiresRestart?: boolean
  error?: string
}

/** 一个 gate 的结果（与 host 侧 GateResult 对齐）。 */
export interface HealthGate {
  id: 'generation' | 'log-integrity' | 'projection-cache' | 'lossless-json' | 'cold-read' | 'source-kind'
  level: 'ok' | 'warn' | 'fail' | 'skipped'
  evidence: string
  attribution?: { projection?: string; package?: string; field?: string }
  detail?: Record<string, unknown>
}

/** 单会话体检报告。 */
export interface HealthReport {
  sessionId: string
  /** 总判：聚合时 `skipped` 不抬升（见 host 侧 buildSessionReport）。 */
  level: 'ok' | 'warn' | 'fail'
  /**
   * 处置优先级（见 host 侧 generation.ts）：`high` = 当前代是从迁移暂存（TMP）发布出来的。
   * 与 `level` 正交：优先级答「先看谁」，档位答「要不要处置」。
   */
  priority?: 'high' | 'normal'
  gates: HealthGate[]
  generatedAt: number
}

/** 体检扫描响应。 */
export interface HealthScanResponse {
  ok: boolean
  /** 本次响应是否来自缓存（`resume: true` 时的命中标记）。 */
  cached?: boolean
  /** 本批已访问的会话数（分批扫描的进度步长）。 */
  scanned?: number
  /** 语料总数（进度分母）；缓存命中时为**缓存生成时**的语料总数。 */
  total?: number
  /** 本批起点（原样回显）。 */
  offset?: number
  findings?: HealthReport[]
  /** 缓存的生成时刻（epoch ms）；仅缓存命中时给出。 */
  generatedAt?: number
  /** 当前语料总数；与 `total` 不一致即「语料已变化」。 */
  currentTotal?: number
  error?: string
}

/** 单会话体检响应。 */
export interface HealthSessionResponse {
  ok: boolean
  report?: HealthReport
  prescriptions?: string[]
  error?: string
}

/** 处置结果的定性分类（与 host 侧 RepairVerdict 对齐）。 */
export type RepairVerdict =
  | 'nothing-to-do'
  | 'repaired'
  | 'repaired-with-residual'
  | 'not-applicable'
  | 'failed'

/** 出院（可逆处置）响应。 */
export interface HealthRepairResponse {
  ok: boolean
  changed?: boolean
  before?: HealthReport
  after?: HealthReport
  repair?: { ok: boolean; from?: string; to?: string; error?: string; requiresRestart?: boolean }
  /** 处置结果的定性分类：区分「生效」「生效但有无关残留」「无可处置项」「失败」。 */
  verdict?: RepairVerdict
  /** 人读说明：为什么处置后仍然异常（或已恢复）。 */
  explanation?: string
  /** 处置后仍未解决的门。 */
  residual?: { id: HealthGate['id']; level: HealthGate['level'] }[]
  prescriptions?: string[]
  error?: string
}

/** 署名转换（session-health-source-migrate）响应。 */
export interface SourceMigrateResponse {
  ok: boolean
  outcome?: { ok: boolean; path: string; backup?: string; changedRows?: number; byPlugin?: Record<string, number>; error?: string }
  /** 转换后的最新体检报告（无论成败都给出，便于面板对照）。 */
  after?: HealthReport
  error?: string
}

/**
 * 兼容别名：合并包时代的 `callSteward` 与 `callHostAny` 同实现（同一 fenced
 * 路由、同一返回形状），保留调用面不迁移。
 */
export const callSteward = callHostAny

/** POST 到 items 形状的 fenced 方法（管理台语料 session-catalog 用）。 */
export async function callStewardItems<T>(method: string, body: unknown): Promise<{ ok: boolean; items: T[]; error?: string }> {
  const res = await callHostAny<{ items?: T[] }>(method, body)
  if (res.ok === true && Array.isArray(res.items)) return { ok: true, items: res.items }
  return { ok: false, items: [], error: res.error ?? '请求失败' }
}

/** 一条已切好的 SSE 帧（心跳/注释帧不产出）。 */
export interface SseMessage {
  /** 事件名；无 `event:` 字段时为 `message`。 */
  event: string
  /** 多行 `data:` 以 `\n` 连接后的原始载荷。 */
  data: string
}

/**
 * 解析**一个** SSE 帧（不含结尾空行分隔）。
 *
 * 容错约定：容忍 `\r\n`；`:` 开头是注释（心跳 `: ping`）；空行忽略；多行 `data:`
 * 按规范用 `\n` 拼接；没有 `data:` 字段（如纯心跳）返回 undefined。
 * **不 JSON.parse、不抛**：解析与业务解码分开，才好在 node 里单测。
 */
export function parseSseBlock(raw: string): SseMessage | undefined {
  let event = ''
  const data: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return undefined
  return { event: event === '' ? 'message' : event, data: data.join('\n') }
}

/** 一条标题流事件（与 host 侧 CatalogTitleEvent 对齐）。 */
export interface CatalogTitleStreamEvent {
  sessionId: string
  title?: string
  source: string
  bytesRead?: number
  frames?: number
}

/** 流结束汇总（`event: done`）。 */
export interface CatalogTitleStreamSummary {
  resolved: number
  pending: number
}

/**
 * 标题分帧流（`session-catalog-stream`，POST + text/event-stream）。
 *
 * 不用 `EventSource`：fenced 路由只收 POST，`EventSource` 只能 GET 且带不了 body。
 * 因此自己读 `ReadableStream`，自己按 `\n\n` 切块。
 * 失败一律经 `onError` 汇报（不抛）：列表在流失败时必须保持可用。
 * @param sessionIds - 待补标题的会话（首屏里的 `titleSource: 'pending'`）。
 * @param handlers - 逐条标题 / 结束 / 错误回调。
 * @returns `{ abort }`：组件卸载或重取时必须调用，宿主会立刻停读。
 */
export function streamCatalogTitles(
  sessionIds: readonly string[],
  handlers: {
    onTitle: (event: CatalogTitleStreamEvent) => void
    onDone?: (summary: CatalogTitleStreamSummary) => void
    onError?: (message: string) => void
  },
): { abort: () => void } {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
  let cancelled = false

  const dispatch = (block: string): void => {
    const message = parseSseBlock(block)
    if (message === undefined) return
    if (message.event === 'done') {
      try {
        handlers.onDone?.(JSON.parse(message.data) as CatalogTitleStreamSummary)
      } catch {
        handlers.onDone?.({ resolved: 0, pending: 0 })
      }
      return
    }
    if (message.event !== 'message' && message.event !== 'title') return
    try {
      const parsed = JSON.parse(message.data) as CatalogTitleStreamEvent
      if (typeof parsed.sessionId === 'string') handlers.onTitle(parsed)
    } catch {
      // 非法 JSON 不抛：流式通道的容错面（一条坏帧不能打死整条流）。
    }
  }

  const run = async (): Promise<void> => {
    try {
      const res = await fetch('/manage-session/api/session-catalog-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ sessionIds: [...sessionIds] }),
        signal: controller?.signal,
      })
      if (!res.ok || res.body === null) {
        handlers.onError?.(`HTTP ${res.status}`)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // 凑齐一个完整帧（`\n\n` / `\r\n\r\n`）才分发；残块留到下一轮。
          for (;;) {
            const match = /\r?\n\r?\n/.exec(buffer)
            if (match === null) break
            const block = buffer.slice(0, match.index)
            buffer = buffer.slice(match.index + match[0].length)
            dispatch(block)
          }
        }
        buffer += decoder.decode()
        if (buffer.trim() !== '') dispatch(buffer)
      } finally {
        try {
          await reader.cancel()
        } catch { /* 已关闭 */ }
      }
    } catch (err) {
      if (cancelled) return
      handlers.onError?.(String(err instanceof Error ? err.message : err))
    }
  }

  void run()
  return {
    abort: () => {
      cancelled = true
      controller?.abort()
    },
  }
}

/** 状态响应。 */
export interface HealthStatusResponse {
  ok: boolean
  switches?: { enabled: boolean; historyFiles: boolean; healthCheck: boolean; directDelete?: boolean }
  historyMethods?: string[]
  healthMethods?: string[]
  home?: string
  error?: string
}

/** One session listed by `session-catalog` (active + archived in one table). */
export interface HostSessionItem {
  sessionId: string
  title: string
  cwd: string
  updatedAt: number
  /** 归档标记（合表语义）：缺省字段按「活跃」对待。 */
  archived?: boolean
  /**
   * 标题来源（2.0.13 新增，可选）：`live` 实时投影 / `cache` checkpoint 快照 /
   * `pending` 待分帧流补齐 / `none` 已定论无标题。旧宿主半无此字段。
   */
  titleSource?: 'live' | 'cache' | 'pending' | 'none'
}

/**
 * 直接删除入口开关（`manage-session.directDelete`，缺省关）。
 * 由 `session-health-status` 的 switches 面读取；旧宿主半无该字段 → false
 * （破坏性入口不出现是安全方向）。
 */
export async function probeDirectDelete(): Promise<boolean> {
  const res = await callHostAny<HealthStatusResponse>('session-health-status', {})
  return res.ok === true && res.switches?.directDelete === true
}

/**
 * The client sessions service face. Host lines before 0.1.7 exposed session
 * navigation here as `open`; the 0.1.7 contract dropped it ("navigation
 * belongs to view owners") — kept only as the legacy fallback of
 * `openSessionThrough`.
 */
export interface SwitchSessionsService {
  open(id: string): void
}

/**
 * The client ui-workspace face: session navigation has been owned by this
 * service since host 0.1.7 (`openSession`; a bare session id is accepted).
 */
export interface SwitchUiWorkspaceService {
  openSession(target: string): void
}

/**
 * Open a session through whichever face the running host offers:
 * `uiWorkspace.openSession` first (0.1.7+), the pre-0.1.7 `sessions.open` as
 * fallback. Neither present → silent no-op.
 */
export function openSessionThrough(get: (name: string) => unknown, sessionId: string): void {
  const uiWorkspace = get('uiWorkspace') as SwitchUiWorkspaceService | undefined
  if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
    uiWorkspace.openSession(sessionId)
    return
  }
  const sessions = get('sessions') as SwitchSessionsService | undefined
  if (sessions !== undefined && typeof sessions.open === 'function') sessions.open(sessionId)
}

/** 一次「从管理台跳到会话」的结果（失败以 `error` 回报，不抛）。 */
export interface OpenSessionOutcome {
  ok: boolean
  error?: string
  /** `true` = 已退页，导航排到下一帧执行（结果通过 `onDeferredError` 回报）。 */
  deferred?: boolean
}

/** `openSessionSafely` 选项。 */
export interface OpenSessionOptions {
  /** 退出面板页（`layout.selectPanel(null)`），在导航前执行。 */
  exitPanel?: () => void
  /** 导航失败时把面板页重新选中（免得「跳不过去还把面板也关了」）。 */
  restorePanel?: () => void
  /**
   * 把真正的导航排到下一帧（**整页形态必须**）。
   *
   * 宿主 `openSession` 内部最后才 `selectPanel(null)`；我们主动退页与宿主切主栏在同一帧
   * 会互相覆盖，表现为「第一次点击只关页、要再点一次才跳」（实测双击症状）。退页后让
   * 渲染先收敛一帧再导航，一次点击就等价于旧行为里的第二次点击。
   */
  defer?: boolean
  /** 延迟导航抛错时的回调（同步阶段已确认能力可用，这里只可能是宿主自己炸）。 */
  onDeferredError?: (message: string) => void
}

/** 下一帧（无 rAF 环境回退 setTimeout 0）。 */
function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { run() })
  else setTimeout(run, 0)
}

/**
 * 从管理台打开会话（面板页 / 对话框共用）。
 *
 * 三件事让它只需**一次点击**，且不会把面板“坑”掉：
 *
 * 1. **先退面板页再导航**（可选再延到下一帧，见 `defer`）：避免“第一次点击只关页”；
 * 2. **先判能力再动手**：导航服务缺席时提前失败，不会出现“面板已关、会话没打开”；
 * 3. **全程 try/catch**：失败回一条错误（或触发 `restorePanel` + `onDeferredError`），
 *    绝不把整个管理台报错白屏或异常弹出去。
 * @param get - 宿主服务取值器（`ctx.get`）。
 * @param sessionId - 目标会话 id。
 * @param options - 退页/恢复/延迟选项。
 * @returns `ok`、失败原因与是否已延迟。
 */
export function openSessionSafely(
  get: (name: string) => unknown,
  sessionId: string,
  options: OpenSessionOptions = {},
): OpenSessionOutcome {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (id === '') return { ok: false, error: '缺少合法的会话 id' }
  // 先判能力再动手：没有导航服务时提前失败，避免先把面板页撤了却跳不过去。
  let canNavigate = false
  try {
    const uiWorkspace = get('uiWorkspace') as SwitchUiWorkspaceService | undefined
    const sessions = get('sessions') as SwitchSessionsService | undefined
    canNavigate = (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function')
      || (sessions !== undefined && typeof sessions.open === 'function')
  } catch {
    canNavigate = false
  }
  if (!canNavigate) return { ok: false, error: '宿主导航服务不可用（uiWorkspace / sessions 均缺席）' }

  const navigate = (): OpenSessionOutcome => {
    try {
      openSessionThrough(get, id)
      return { ok: true }
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err)
      try {
        options.restorePanel?.()
      } catch { /* 恢复失败也只能如实报错 */ }
      return { ok: false, error: message }
    }
  }

  try {
    options.exitPanel?.()
  } catch {
    // 退页失败不阻断导航：最坏是面板页与目标会话争主栏，宿主自己会收敛。
  }
  if (options.defer !== true) return navigate()
  nextFrame(() => {
    const outcome = navigate()
    if (outcome.ok === false) options.onDeferredError?.(outcome.error ?? '')
  })
  return { ok: true, deferred: true }
}
