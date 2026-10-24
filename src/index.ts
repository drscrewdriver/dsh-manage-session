/**
 * dsh-manage-session 主机半身（会话管理器）：一条 fenced HTTP 路由 ——
 *
 * - `/manage-session/api`：管理 + 体检，方法名一律 `session-*`。
 *
 * 两个子域开关（feature gate，关掉不注册对应方法，调用返回显式 disabled 错误，
 * 不留空壳）：
 * - `historyFiles`（会话历史文件 / 归档）：`session-history-*`；
 * - `healthCheck`（健康检查 / 体检）：`session-health-*`。
 * 另有插件总开关 `enabled`：关闭后不注册任何路由。
 *
 * **本包不再带搜索/索引**（已拆回 dsh-search-index，DRS 依赖也随之回去）：
 * 管理台的语料改由 `session-catalog` 方法从宿主 `sessionQuery` + 官方归档集合
 * 现场拼装（活跃/归档同表），不维护任何自有索引、不依赖 DRS。
 *
 * 只读诊断 + 可逆处置；不改会话日志、不改历史数据、不静默丢弃字段。
 */
import type { Context } from 'cordis'
import z from '@deepseek-ai/schemastery'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG,
  STEWARD_API_PREFIX,
  STEWARD_SETTINGS_NAMESPACE,
  type StewardConfig,
} from './config.ts'
import { archiveHistory, listHistory, pruneHistory, storagePathsFor } from './host/history/archive.ts'
import { listFavorites, setFavoriteState } from './host/history/favorites.ts'
import type { StewardRegistryFace } from './host/history/archive-source.ts'
import { readArchiveSet } from './host/history/archive-source.ts'
import { locateSessionUsage, purgeHistory } from './host/history/purge.ts'
import {
  bridgeOverlay,
  installLegacySettingsBridge,
  settingsDescribe,
  settingsMutate,
  type BridgeState,
} from './host/settings-bridge.ts'
import { buildProjectionOwnerIndex, createAttributor, defaultProfileNodeModules } from './host/health/attribution.ts'
import { HealthCache } from './host/health/cache.ts'
import { buildSessionReport, type SessionHealthReport } from './host/health/gates.ts'
import { decodeSessionLogFile } from './host/health/decode.ts'
import { assessRepair, prescribe, quarantineProjectionCache } from './host/health/repair.ts'
import { countCorpus, findSession, findSessionLog, scanSessions } from './host/health/scan.ts'
import { gateSourceKind, migrateSessionSourceKind, readSourceKindFacts } from './host/health/source-kind.ts'

export { DEFAULT_CONFIG, STEWARD_API_PREFIX, STEWARD_SETTINGS_NAMESPACE } from './config.ts'
export type { StewardConfig } from './config.ts'
export { readArchiveSet, pruneArchiveFile, archiveArchiveFile, editWorkspaceDocument } from './host/history/archive-source.ts'
export { listHistory, pruneHistory, archiveHistory } from './host/history/archive.ts'
export { purgeHistory, locateSessionUsage, indexSessionDirs, isSafeChild, dirSize, sessionsRootFor, projCacheRootFor, isSourceMigrateBackupName, backupFilesIn } from './host/history/purge.ts'
export { buildSessionReport, gateColdRead, gateGeneration, gateLogIntegrity, gateLosslessJson, gateProjectionCache, readProjectionCache, readTailFacts } from './host/health/gates.ts'
export { gateSourceKind, migrateSessionSourceKind, migrateLegacySource, readSourceKindFacts, SOURCE_MIGRATE_BACKUP_SUFFIX, V4_HOST_MIN } from './host/health/source-kind.ts'
export { firstLosslessViolation, isLossless } from './host/health/lossless.ts'
export { decodeSessionLogBytes, decodeSessionLogFile, scanZstdFrames } from './host/health/decode.ts'
export {
  classifyGenerationFilename,
  generationLogFilename,
  isMigrationStagingFilename,
  latestArtifactMtime,
  parseGenerationLogFilename,
  readSessionGenerations,
  sessionPriority,
} from './host/health/generation.ts'
export type {
  GenerationArtifact,
  LogArtifact,
  LogCompression,
  SessionGenerations,
  SessionPriority,
} from './host/health/generation.ts'
export { buildProjectionOwnerIndex, createAttributor } from './host/health/attribution.ts'
export { prescribe, quarantineProjectionCache } from './host/health/repair.ts'
export { countCorpus, discoverSessions, findSession, findSessionLog, scanSessions } from './host/health/scan.ts'
export type { DiscoveredSession } from './host/health/scan.ts'
export { HealthCache } from './host/health/cache.ts'
export type { HealthCacheEntry } from './host/health/cache.ts'
export { assessRepair } from './host/health/repair.ts'
export type { RepairAssessment, RepairVerdict } from './host/health/repair.ts'

/** 本插件声明的宿主服务（与 toggle 相同的注入面）。0.2.1-a.2 起 webRuntime 更名 webStartup，读取面走双名回退链。 */
export const inject = ['webServer', 'webStartup']

/** webServer 服务面（结构化镜像，零 value import）。 */
interface StewardWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** web runtime 服务面：绑定派生的可信 authority。 */
interface StewardWebRuntime {
  trustedHosts: readonly string[]
}

/** Live reference the 0.1.7 loader hands `apply` for `.volatile()` config fields. */
interface VolatileRef<T> {
  get(): T
}

/** Resolve one possibly-volatile field: a live ref on 0.1.7+, a plain value otherwise. */
function readVolatileValue<T>(value: T | VolatileRef<T> | undefined): T | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as VolatileRef<T>).get === 'function') {
    return (value as VolatileRef<T>).get()
  }
  return value as T | undefined
}

/**
 * `.volatile()` 探针回退（preset-manager 的 volatile breakpoint 同款）：宿主
 * schemastery 只在 0.1.7+ 线提供 `.volatile()`，老线上该方法是 undefined ——
 * 在模块加载期链式调用直接 TypeError，插件整包起不来。这里探测到才链，探测
 * 不到就返回普通字段（老线的配置只来自组合入口，无设置表单，行为正确）。
 */
function withVolatile<T extends { volatile?: unknown }>(field: T): T {
  if (field !== null && typeof field === 'object' && typeof field.volatile === 'function') {
    return (field as { volatile: () => T }).volatile()
  }
  return field
}

/** 运行时配置 schema（与 src/config.ts 的形状保持一致）。0.1.7+：volatile 字段即设置表单。 */
export const Config = z.object({
  enabled: withVolatile(z.boolean().default(true)),
  historyFiles: withVolatile(z.boolean().default(true)),
  healthCheck: withVolatile(z.boolean().default(true)),
  directDelete: withVolatile(z.boolean().default(false)),
})

/** 单次请求体的上限（防御无界读取）。 */
const MAX_BODY_BYTES = 16 << 20

/** 归一化 Host authority，无法解析时为 undefined。 */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** 主机名是否本机回环。 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Host 是否命中 trustedHosts（精确或省略端口）。 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    const canonical = entryUrl.port === '' ? entryUrl.hostname : entryUrl.host
    return canonical === hostUrl.host
  })
}

/** 浏览器可信围栏（与 /api 网关行为一致）：DNS 重绑定/跨站防御，不是鉴权。 */
function isTrustedApiRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = req.headers.host
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 读原始请求体（有界）。 */
async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 读 JSON 请求体（空体视为 {}）。 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const text = await readRawBody(req)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('request body is not JSON')
  }
}

/** 写 JSON 响应。 */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

/** 写原始文本响应。 */
function writeRaw(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-cache' })
  res.end(body)
}

/** 会话 id 形状校验（拒绝任意字符串进入路径拼接）。 */
function asSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 200) return undefined
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return undefined
  return trimmed
}

/** 单会话体检的最大扫描上限。 */
const MAX_SCAN_LIMIT = 200

/** 运行时依赖。 */
export interface StewardRuntime {
  config: () => Required<StewardConfig>
  dshHome: string
  registry: () => StewardRegistryFace | undefined
  projectionStateFor: (sessionId: string) => Record<string, unknown> | undefined
  attribute: (projection: string) => { projection?: string; package?: string; field?: string } | undefined
  log: (message: string) => void
  /**
   * 管理台语料来源（宿主 `sessionQuery`；可选：缺席时 `session-catalog` 显式报错）。
   */
  sessionQuery?: SwitchSessionQuery
  /**
   * 体检结果缓存（进程内，随 fiber 存活）。
   *
   * 可选：缺省表示本次装配不启用缓存（只影响「关面板重开」是否零延迟，
   * 不影响任何判定结果）。`apply()` 总是提供实例。
   */
  cache?: HealthCache
  /**
   * Legacy 设置桥（≤0.1.5；可选）：老宿主 settings 服务的 register/get/update
   * 租约。缺省（单测/modern 宿主）= describe 回空投影、mutate 显式拒绝。
   */
  settingsBridge?: BridgeState
}

/**
 * 支持的路由方法（按子域分组；用于对外声明与测试断言）。
 *
 * `session-history-prune` 与 `session-history-purge` 是**两件事**，不可合并：
 * prune = 取消归档状态（可逆，会话回到侧边栏）；purge = 清理归档文件（不可逆，真删实体）。
 */
export const HISTORY_METHODS = [
  'session-history-list',
  'session-history-archive',
  'session-history-prune',
  'session-history-purge',
  'session-history-favorites-list',
  'session-history-favorite-set',
] as const
export const HEALTH_METHODS = [
  'session-health-status',
  'session-health-scan',
  'session-health-session',
  'session-health-repair',
  'session-health-source-migrate',
] as const

/** 依据开关判定某方法是否启用。 */
export function methodEnabled(method: string, config: Required<StewardConfig>): boolean {
  if (method === 'session-catalog') return config.enabled !== false
  if ((HISTORY_METHODS as readonly string[]).includes(method)) return config.historyFiles !== false
  if ((HEALTH_METHODS as readonly string[]).includes(method)) return config.healthCheck !== false
  return false
}

/** ------------------------------------------------------------------ 会话语料结构镜像 */

/**
 * One session header shape the query service returns (structural subset).
 */
interface SwitchSessionHeader {
  id: string
  version: number
  createdAt: number
  cwd?: string
  parentSession?: string
  seedLength?: number
  delegationDepth?: number
  agentPreset?: string
}

/** One logical-session record (structural subset). */
interface SwitchSessionRecord {
  header: SwitchSessionHeader
  live: boolean
  persisted: boolean
}

/** One title observation result (structural subset). */
interface SwitchTitleObservationResult {
  status: 'fulfilled' | 'rejected'
  value?: { session: SwitchSessionHeader; title?: { title: string } }
  reason?: unknown
}

/** The session-query service face used by the manage console catalog. */
interface SwitchSessionQuery {
  listSessions(signal?: AbortSignal): Promise<readonly SwitchSessionRecord[]>
  readSession?(sessionId: string): Promise<{
    session: SwitchSessionHeader
    events: readonly unknown[]
  }>
  readTitleSnapshots(
    sessionIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly SwitchTitleObservationResult[]>
}

/**
 * The workspace registry face the search side reads (structural mirror): the
 * official archive set. Read lazily — the registry may mount after plugins.
 */
interface SwitchWorkspaceRegistry {
  readonly archivedSessionIds: readonly string[]
}

/** Fold titles for a set of sessions into a sessionId → title map. */
async function titleMap(
  sessionQuery: SwitchSessionQuery,
  sessionIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (sessionIds.length === 0) return new Map()
  const observations = await sessionQuery.readTitleSnapshots([...new Set(sessionIds)])
  const map = new Map<string, string>()
  for (const observation of observations) {
    if (observation.status !== 'fulfilled' || observation.value === undefined) continue
    const title = observation.value.title?.title
    if (typeof title === 'string' && title.trim().length > 0) map.set(observation.value.session.id, title)
  }
  return map
}

/** session-catalog: 管理台语料（活跃 + 归档同表，无自有索引、无 DRS）。 */
async function listSessions(runtime: StewardRuntime): Promise<{ ok: boolean; items?: unknown[]; error?: string }> {
  const sessionQuery = runtime.sessionQuery
  if (sessionQuery === undefined) return { ok: false, error: 'sessionQuery 服务不可用，无法列出会话' }
  // 归档集合与管理台写路同源（存储文件优先、registry 兜底）——否则清理后列表不跟。
  const archivedIds = new Set(readArchiveSet(runtime.registry(), storagePathsFor(runtime.dshHome)).ids)
  try {
    const records = await sessionQuery.listSessions()
    const titles = await titleMap(sessionQuery, records.map(record => record.header.id))
    const seen = new Set<string>()
    const items: unknown[] = records.map((record) => {
      seen.add(record.header.id)
      return {
        sessionId: record.header.id,
        title: titles.get(record.header.id) ?? '',
        cwd: record.header.cwd ?? '',
        updatedAt: record.header.createdAt,
        archived: archivedIds.has(record.header.id),
      }
    })
    // 归档集合里未被 sessionQuery 语料覆盖的 id（老线/离线条目）也列出来，
    // 否则「归档域筛选」会漏掉真实存在于归档数组里的会话。
    for (const sessionId of archivedIds) {
      if (seen.has(sessionId)) continue
      items.push({ sessionId, title: '', cwd: '', updatedAt: 0, archived: true })
    }
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

/** 管理台语料运行时（无索引、无 DRS；只认宿主 sessionQuery + 官方归档集合）。 */
interface CatalogRuntime {
  sessionQuery: SwitchSessionQuery | undefined
  registry: () => { archivedSessionIds: readonly string[] }
}

interface MemoryRegistryFace {
  archiveSession?(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession?(sessionId: string): Promise<void>
  readonly archivedSessionIds?: readonly string[]
}

/** 逐 id 串行调用官方内存方法;失败按会话隔离收集（AM 批量语义）。 */
async function runMemoryArchiveOps(
  registry: MemoryRegistryFace,
  ids: readonly string[],
  op: 'archive' | 'unarchive',
): Promise<{ succeeded: string[]; failures: { sessionId: string; reason: string }[] }> {
  const fn = op === 'archive' ? registry.archiveSession : registry.unarchiveSession
  const succeeded: string[] = []
  const failures: { sessionId: string; reason: string }[] = []
  for (const id of ids) {
    try {
      await fn!.call(registry, id)
      succeeded.push(id)
    } catch (err) {
      failures.push({ sessionId: id, reason: String(err instanceof Error ? err.message : err) })
    }
  }
  return { succeeded, failures }
}

/** 收藏文件候选（与管家其余域同一 dshHome 纪律）。 */
function favoritesPathsFor(dshHome: string): string[] {
  return [join(dshHome, 'storages', 'manage-session-favorites.json')]
}

/** 本地日界（YYYY-MM-DD → epoch ms;nextDay 为排他上界）。非法返回 undefined。 */
function dayBoundaryMs(value: unknown, nextDay = false): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** 从 payload 抽合法 sessionIds（与 prune/purge 的入参纪律一致）；不合法返回 undefined。 */
function validSessionIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const ids = [...new Set(value.filter((id): id is string => typeof id === 'string' && id !== ''))]
  return ids.length > 0 ? ids : undefined
}

/**
 * 处理一次管家子域 API 调用（导出以便单测直接驱动，不需要起 HTTP）。
 * @param method - 路由方法名。
 * @param payload - 已解析的请求体。
 * @param runtime - 运行时依赖。
 */
/** 现代宿主的只读投影：把运行时配置按命名空间形状输出（describe 用）。 */
function configSnapshotProjection(
  config: Required<StewardConfig>,
): Record<string, Record<string, unknown>> {
  return {
    [STEWARD_SETTINGS_NAMESPACE]: {
      enabled: config.enabled,
      historyFiles: config.historyFiles,
      healthCheck: config.healthCheck,
      // 老线卡回读面：漏字段 = 拨了显示不跟（写路 bridge schema 已在位）。
      directDelete: config.directDelete,
    },
  }
}

export async function handleMethod(
  method: string,
  payload: unknown,
  runtime: StewardRuntime,
): Promise<unknown> {
  const config = runtime.config()
  // 设置桥方法不受子域闸管——关掉 enabled/historyFiles/healthCheck 后仍必须
  // 能读配置（否则卡片永远读不到「把它打开」的开关）。
  const settingsMethods = method === 'settings-describe' || method === 'settings-mutate'
  const known = [...HISTORY_METHODS, ...HEALTH_METHODS, 'session-catalog', 'settings-describe', 'settings-mutate'] as readonly string[]
  if (!known.includes(method)) {
    return { ok: false, error: `未知的 manage-session API 方法 "${method}"` }
  }
  if (!settingsMethods && !methodEnabled(method, config)) {
    const which = (HISTORY_METHODS as readonly string[]).includes(method) ? 'historyFiles' : 'healthCheck'
    return { ok: false, error: `子域已关闭（${which}=false）：${method} 未注册` }
  }

  if (method === 'settings-describe') {
    const state = runtime.settingsBridge
    if (state !== undefined && state.bridge !== undefined) return settingsDescribe(state)
    // modern 宿主（0.1.7+，无 legacy settings 服务）：运行时配置只读投影。
    return { ok: true, namespaces: configSnapshotProjection(config), writable: false, revision: state?.revision ?? 0 }
  }
  if (method === 'settings-mutate') {
    const state = runtime.settingsBridge ?? { bridge: undefined, revision: 0 }
    return await settingsMutate(state, payload)
  }

  if (method === 'session-history-list') {
    return await listHistory(runtime.registry, undefined, storagePathsFor(runtime.dshHome), runtime.dshHome)
  }
  if (method === 'session-catalog') {
    return await listSessions(runtime)
  }
  if (method === 'session-history-archive') {
    const request = (payload ?? {}) as { sessionIds?: unknown }
    const ids = validSessionIds(request.sessionIds)
    if (ids === undefined) return { ok: false, error: '缺少 sessionIds 数组' }
    // 内存路径优先（0.1.7+ 双方法齐全）:官方 archiveSession 自带 setState
    // 持久化,即时生效免重启;活动回合/未知会话按会话隔离报失败。
    const mem = runtime.registry() as MemoryRegistryFace | undefined
    if (mem?.archiveSession !== undefined) {
      const before = new Set(mem.archivedSessionIds ?? [])
      const { succeeded, failures } = await runMemoryArchiveOps(mem, ids, 'archive')
      const total = (mem.archivedSessionIds ?? []).length
      return {
        ok: true,
        added: ids.filter(id => !before.has(id)).length,
        total,
        requiresRestart: false,
        ...(failures.length === 0 ? {} : { failures }),
      }
    }
    return archiveHistory(payload, runtime.log, storagePathsFor(runtime.dshHome))
  }
  if (method === 'session-history-prune') {
    const request = (payload ?? {}) as { sessionIds?: unknown }
    const ids = validSessionIds(request.sessionIds)
    // 内存路径优先（unarchiveSession 为 0.1.7+ 方法,0.1.5 无 → 文件降级）。
    const mem = runtime.registry() as MemoryRegistryFace | undefined
    if (mem?.unarchiveSession !== undefined && ids !== undefined) {
      const { succeeded, failures } = await runMemoryArchiveOps(mem, ids, 'unarchive')
      const remaining = (mem.archivedSessionIds ?? []).length
      return {
        ok: true,
        removed: succeeded.length,
        remaining,
        requiresRestart: false,
        ...(failures.length === 0 ? {} : { failures }),
      }
    }
    return pruneHistory(payload, runtime.log, storagePathsFor(runtime.dshHome))
  }
  if (method === 'session-history-purge') {
    const request = (payload ?? {}) as { sessionIds?: unknown }
    const ids = validSessionIds(request.sessionIds)
    if (ids === undefined) return { ok: false, error: '缺少 sessionIds 数组' }
    // 内存路径优先（P1:替换后的 registry 子类带 deleteSession 全痕删除,
    // 官方 0.1.7/0.2.0 双线可用）—— 即时生效免重启;失败按会话隔离。
    const mem = runtime.registry() as (MemoryRegistryFace & {
      deleteSession?: (sessionId: string) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>
      dshHome?: string
    }) | undefined
    if (typeof mem?.deleteSession === 'function') {
      mem.dshHome = runtime.dshHome
      const succeeded: string[] = []
      const failures: { sessionId: string; reason: string }[] = []
      const usage = locateSessionUsage(ids, runtime.dshHome)
      let freedBytes = 0
      for (const id of ids) {
        freedBytes += usage.get(id)?.bytes ?? 0
        freedBytes += usage.get(id)?.cacheBytes ?? 0
      }
      for (const id of ids) {
        try {
          const outcome = await mem.deleteSession(id)
          if (outcome.ok) succeeded.push(id)
          else failures.push({ sessionId: id, reason: outcome.error ?? '删除失败' })
        } catch (err) {
          failures.push({ sessionId: id, reason: String(err instanceof Error ? err.message : err) })
        }
      }
      return {
        ok: true,
        purged: succeeded.length,
        freedBytes,
        requiresRestart: false,
        ...(failures.length === 0 ? {} : { failures }),
      }
    }
    return purgeHistory(payload, runtime.log, {
      dshHome: runtime.dshHome,
      searchPaths: storagePathsFor(runtime.dshHome),
    })
  }

  if (method === 'session-history-favorites-list') {
    return { ok: true, favorites: listFavorites(favoritesPathsFor(runtime.dshHome)) }
  }
  if (method === 'session-history-favorite-set') {
    const request = (payload ?? {}) as { sessionId?: unknown; favorite?: unknown }
    const sessionId = asSessionId(request.sessionId)
    if (sessionId === undefined) return { ok: false, error: '缺少合法的 sessionId' }
    if (typeof request.favorite !== 'boolean') return { ok: false, error: '缺少 favorite 布尔值' }
    return setFavoriteState(sessionId, request.favorite, favoritesPathsFor(runtime.dshHome))
  }

  if (method === 'session-health-status') {
    return {
      ok: true,
      namespace: STEWARD_SETTINGS_NAMESPACE,
      prefix: STEWARD_API_PREFIX,
      switches: {
        enabled: config.enabled,
        historyFiles: config.historyFiles,
        healthCheck: config.healthCheck,
        directDelete: config.directDelete,
      },
      historyMethods: [...HISTORY_METHODS],
      healthMethods: [...HEALTH_METHODS],
      home: runtime.dshHome,
    }
  }

  if (method === 'session-health-scan') {
    const request = (payload ?? {}) as { limit?: unknown; offset?: unknown; onlyProblems?: unknown; resume?: unknown }
    const onlyProblems = request.onlyProblems !== false

    // resume：**纯读缓存，不扫描**（面板挂载时零成本探一次）。
    // 无缓存时如实回 cached:false 并捎带语料总数，让面板知道「有多少待体检」，
    // 而不是偷偷跑一批——挂载就干重活是上一版被诟病的问题。
    if (request.resume === true) {
      const cached = runtime.cache?.read()
      if (cached === undefined) {
        return { ok: true, cached: false, scanned: 0, total: countCorpus(runtime.dshHome), offset: 0, findings: [] }
      }
      return {
        ok: true,
        cached: true,
        scanned: 0,
        total: cached.total,
        offset: 0,
        findings: cached.findings,
        generatedAt: cached.generatedAt,
        // 当前语料总数：客户端据此提示「语料已变化，建议刷新」。
        currentTotal: countCorpus(runtime.dshHome),
      }
    }

    const limit = typeof request.limit === 'number' && Number.isFinite(request.limit)
      ? Math.max(1, Math.min(MAX_SCAN_LIMIT, Math.floor(request.limit)))
      : 30
    // offset 支持分批扫描：客户端用小批次连续调用并自行累计进度。
    const offset = typeof request.offset === 'number' && Number.isFinite(request.offset) && request.offset > 0
      ? Math.floor(request.offset)
      : 0
    const result = scanSessions({
      dshHome: runtime.dshHome,
      limit,
      offset,
      onlyProblems,
      attribute: runtime.attribute,
      projectionStateFor: runtime.projectionStateFor,
    })
    // 累积缓存：`offset: 0` 起一轮，走满语料才成型（半途而废不留半份缓存）。
    // 只累积「只列问题」的视图；onlyProblems=false 的扫描不碰缓存。
    if (result.ok && onlyProblems) {
      if (offset === 0) runtime.cache?.begin(result.total)
      runtime.cache?.append(result.findings, result.scanned)
    }
    return result
  }

  const request = (payload ?? {}) as { sessionId?: unknown }
  const sessionId = asSessionId(request.sessionId)
  if (sessionId === undefined) return { ok: false, error: '缺少合法的 sessionId' }
  // 按代次定位：会话存在但尚未发布当前代时 logPath 为 undefined，此时仍要出报告
  // （generation / log-integrity 两门如实报出），不能笼统回「未找到会话日志」。
  const session = findSession(sessionId, runtime.dshHome)
  if (session === undefined) return { ok: false, error: `未找到会话日志：${sessionId}` }

  const projectionState = runtime.projectionStateFor(sessionId)
  const reportFor = (): SessionHealthReport => buildSessionReport({
    sessionId,
    dshHome: runtime.dshHome,
    ...(session.logPath === undefined ? {} : { logPath: session.logPath }),
    generations: session.generations,
    ...(projectionState === undefined ? {} : { projectionState }),
    attribute: runtime.attribute,
  })

  if (method === 'session-health-session') {
    const report = reportFor()
    // 单条体检可能改变该会话的档位（如宿主已结算 open step）：就地回写缓存，
    // 免得为了刷新一行而重扫整个语料。
    runtime.cache?.patch(report)
    return { ok: true, report, prescriptions: prescribe(report, runtime.dshHome) }
  }

  // session-health-source-migrate：把 v4 日志里的旧署名行（kind:'plugin' + plugin 字段）
  // 转换为 producer-owned kind。这是「禁止改写会话日志」红线的唯一显式例外：
  // 只动 source 署名字段、先整文件备份、v3 及更早版本线拒绝执行（见 source-kind.ts 的版本依赖表）。
  if (method === 'session-health-source-migrate') {
    if (session.logPath === undefined) {
      return { ok: false, error: '会话尚未发布当前代日志，无从转换（先用会话代次工具发布）' }
    }
    const log = decodeSessionLogFile(session.logPath)
    const outcome = migrateSessionSourceKind(sessionId, session.logPath, log, runtime.dshHome)
    // 转换后重出报告：source-kind 门应转 ok；失败时报告原样（便于面板对照）。
    const after = buildSessionReport({
      sessionId,
      dshHome: runtime.dshHome,
      logPath: session.logPath,
      generations: session.generations,
      ...(projectionState === undefined ? {} : { projectionState }),
      attribute: runtime.attribute,
    })
    runtime.cache?.patch(after)
    runtime.log(
      `source-kind migrate ${sessionId}: ok=${outcome.ok} changed=${outcome.changedRows ?? 0}` +
        (outcome.error === undefined ? '' : ` error=${outcome.error}`),
    )
    return { ok: outcome.ok, outcome, after, report: after, error: outcome.error }
  }

  // session-health-repair：出院前的可逆处置 + before/after 对照 + 结果定性
  const before = reportFor()
  if (before.level === 'ok') {
    // 缓存里可能还留着这个会话的旧档位（扫描时是 warn，宿主后来结算了）：
    // 就地回写把这个陈旧行摘掉。
    runtime.cache?.patch(before)
    const clean = assessRepair({ before, after: before, repair: { ok: false, action: 'quarantine-projection-cache', sessionId, from: '' } })
    return {
      ok: true,
      changed: false,
      before,
      after: before,
      repair: null,
      verdict: clean.verdict,
      explanation: clean.explanation,
      residual: clean.residual,
      prescriptions: ['# 全部检查通过：无需处置'],
    }
  }
  const repair = quarantineProjectionCache(sessionId, runtime.dshHome)
  const after = reportFor()
  // 处置只隔离投影缓存记录；异常若来自别处（如 open step），处置必然无变化。
  // 定性结论把这个事实讲清楚，否则用户只看到「异常 → 异常」会以为功能坏了。
  const assessment = assessRepair({ before, after, repair })
  // 处置本就重算了 after：把它写回缓存，面板退回列表时该行即是最新档位。
  runtime.cache?.patch(after)
  runtime.log(
    `health repair ${sessionId}: verdict=${assessment.verdict} quarantine=${repair.ok ? 'ok' : repair.error ?? 'skipped'} before=${before.level} after=${after.level}`,
  )
  return {
    ok: true,
    changed: repair.ok,
    repair,
    before,
    after,
    verdict: assessment.verdict,
    explanation: assessment.explanation,
    residual: assessment.residual,
    prescriptions: prescribe(after, runtime.dshHome),
  }
}

/**
 * 插件主体：装配运行时、挂载两条 fenced 路由与索引生命周期。
 * @param ctx - host 插件上下文（webServer / webStartup（旧名 webRuntime）/ 可选 sessionQuery、workspaceRegistry）。
 * @param config - 组合条目（0.1.7：`.volatile()` 字段为 live ref）。
 */
export function apply(ctx: Context, config: Partial<StewardConfig> = {}): void {
  // 0.1.7：volatile 字段每次读取解引出最新快照（开关即时生效），不再有任何
  // settings 注册调用。
  // ≤0.1.5 补口（3085 实锤）：老线组合 config 是静态缺省，卡的写落在宿主
  // settings 服务（下方 settingsBridge）——不叠加则「拨得动、不生效」；
  // 已写键才采信（型别不符/缺席回退组合值），桥未咬合（0.1.7+）零叠加。
  const current = (): Required<StewardConfig> => {
    const { steward } = bridgeOverlay(settingsBridge)
    const bool = (doc: Record<string, unknown>, key: string, v: boolean): boolean =>
      typeof doc[key] === 'boolean' ? (doc[key] as boolean) : v
    return {
      enabled: bool(steward, 'enabled', readVolatileValue(config.enabled) ?? DEFAULT_CONFIG.enabled),
      historyFiles: bool(steward, 'historyFiles', readVolatileValue(config.historyFiles) ?? DEFAULT_CONFIG.historyFiles),
      healthCheck: bool(steward, 'healthCheck', readVolatileValue(config.healthCheck) ?? DEFAULT_CONFIG.healthCheck),
      directDelete: bool(steward, 'directDelete', readVolatileValue(config.directDelete) ?? DEFAULT_CONFIG.directDelete),
    }
  }

  const log = (message: string): void => {
    try {
      const logger = (ctx as unknown as { logger?: { info?: (m: string) => void; warn?: (m: string) => void } }).logger
      logger?.info?.(`[manage-session] ${message}`)
    } catch { /* 日志绝不允许破坏宿主 */ }
  }

  const homeEnv = process.env['DSH_HOME']
  const resolvedHome = homeEnv !== undefined && homeEnv !== '' ? homeEnv : join(homedir(), '.dsh')

  // 结构镜像取宿主服务（本插件不 value-import 官方包，也不假设 Context 有这些属性）。
  const webServer = (ctx as unknown as { webServer?: StewardWebServer }).webServer
  // 双名回退链：a.2 起宿主服务 webRuntime 更名 webStartup；能力探测不分派，两代宿主通吃。
  const webRuntime = (ctx as unknown as { webStartup?: StewardWebRuntime }).webStartup
    ?? ctx.get?.("webRuntime") as StewardWebRuntime | undefined
  if (webServer === undefined || webRuntime === undefined) {
    log('webServer / webStartup(webRuntime) 不可用：不注册路由')
    return
  }

  let ownerIndex: ReturnType<typeof buildProjectionOwnerIndex> | undefined
  const attributor = (projection: string): { projection?: string; package?: string } | undefined => {
    try {
      ownerIndex ??= buildProjectionOwnerIndex(defaultProfileNodeModules(resolvedHome))
    } catch (err) {
      log(`attribution index build failed: ${String(err instanceof Error ? err.message : err)}`)
      ownerIndex = []
    }
    return createAttributor(ownerIndex)(projection)
  }

  // 热态投影状态：宿主暴露 sessionProjections.checkpoint(session) 时取得逐行状态（真实判据来源）。
  const projectionStateFor = (sessionId: string): Record<string, unknown> | undefined => {
    try {
      const sessions = ctx.get('sessions') as { get?: (id: string) => unknown } | undefined
      const projections = ctx.get('sessionProjections') as
        | { checkpoint?: (session: unknown) => Record<string, unknown> }
        | undefined
      if (sessions?.get === undefined || projections?.checkpoint === undefined) return undefined
      const session = sessions.get(sessionId)
      if (session === undefined || session === null) return undefined
      return projections.checkpoint(session)
    } catch (err) {
      log(`projection checkpoint unavailable for ${sessionId}: ${String(err instanceof Error ? err.message : err)}`)
      return undefined
    }
  }

  const registry = (): StewardRegistryFace | undefined =>
    ctx.get('workspaceRegistry') as StewardRegistryFace | undefined

  // Legacy 设置桥（≤0.1.5）：同步建 holder，桥面在 ctx.inject(['settings'])
  // 回调里咬合（0.1.7+ 无 register → 永远空桥 = describe 只读投影）。
  const settingsBridge: BridgeState = installLegacySettingsBridge(ctx)

  const runtime: StewardRuntime = {
    config: () => current(),
    settingsBridge,
    dshHome: resolvedHome,
    registry,
    projectionStateFor,
    attribute: attributor,
    log,
    cache: new HealthCache(),
    // 管理台语料：宿主 sessionQuery（惰性取，装载序不保证）。
    sessionQuery: ctx.get('sessionQuery') as SwitchSessionQuery | undefined,
  }

  // ── 管家子域路由。
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: STEWARD_API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedApiRequest(req, webRuntime.trustedHosts)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const prefix = `${STEWARD_API_PREFIX}/`
      const method = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined
      if (method === undefined || method === '' || method.includes('/')) {
        writeJson(res, 404, { ok: false, error: `unknown manage-session API method` })
        return
      }
      try {
        const payload = await readJsonBody(req)
        writeJson(res, 200, await handleMethod(method, payload, runtime))
      } catch (err) {
        // 显式失败：任何未识别方法/异常都返回错误，绝不静默。
        writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  }), 'dsh-manage-session: /manage-session/api route')
}
