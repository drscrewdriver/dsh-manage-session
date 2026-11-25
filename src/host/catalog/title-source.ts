/**
 * 零 I/O 标题解析（Tier 0 / Tier 1）+ 进程内 memo。
 *
 * 真值来源与宿主侧栏 / `@` 补全**同源**（`context/session-reference` 的
 * `projectedLabels`）：
 *
 * | 档 | 来源 | 成本 | 覆盖（本机） |
 * |---|---|---|---|
 * | live | `sessions.get(id)` + `sessionProjections.snapshot(session,['title'])` | 0 I/O | 全部活跃会话 |
 * | cache | `sessionProjectionCache.cachedSnapshot(header,['title'])` | 0 I/O | 243/252 |
 * | file | `storages/session_projcache/sessions/<id>.json`（服务缺席/未装载时） | 1 次读 | 同 cache |
 * | pending | 都没命中 → 交给分帧流（`frame-title.ts`） | 首窗读 | 其余 |
 *
 * 三个宿主服务（`sessions` / `sessionProjections` / `sessionProjectionCache`）在
 * 兼容区间内全部是**可选**：任一缺席都只降级该档，不抛错、不 500。
 *
 * memo 只存「已定论的结论」（cache / prefix（分帧命中）/ none（确无标题）），
 * **不存 live**：活跃会话的标题随事件推进即时变化，缓存它等于让面板显示旧名。
 * 负结论（`none`，如 `im:*` 虚拟会话在磁盘上根本没有日志）同样入 memo —— 否则
 * 每次打开面板都要白读一遍必然失败的帧。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirNameCandidates, projCacheRootFor } from '../history/purge.ts'

/** 标题结论的档位（`pending` 只在 catalog 响应里出现，不落 memo）。 */
export type CatalogTitleSource = 'live' | 'cache' | 'prefix' | 'none'

/** memo 存活时长：5 min 内二次打开面板零成本；批量操作后主动失效。 */
export const CATALOG_TITLE_MEMO_TTL_MS = 5 * 60 * 1000

/** memo 条数上限（超过即整体失效：单进程的会话数远小于此值）。 */
const CATALOG_TITLE_MEMO_MAX_ENTRIES = 20_000

/** 一条待解析的会话（header 原样透传给 `cachedSnapshot`，identity 校验靠它）。 */
export interface CatalogTitleRecord {
  id: string
  /** 宿主 `sessionQuery.listSessions()` 给出的**权威 header**（不得自造）。 */
  header: { readonly id: string }
}

/** 三级解析结果。 */
export interface CatalogTitles {
  /** 已定论的标题（live / cache）。 */
  titles: ReadonlyMap<string, { title: string; source: 'live' | 'cache' }>
  /** 三级都没命中的会话，按输入顺序。 */
  pending: readonly CatalogTitleRecord[]
}

/** 宿主上下文的最小镜像（本插件零 value-import 官方包，一切经 `ctx.get`）。 */
export interface CatalogCtxFace {
  get(name: string): unknown
}

/** `sessionProjections` 服务面（结构化镜像）。 */
interface ProjectionsFace {
  snapshot(session: unknown, keys?: readonly string[]): { values?: Record<string, unknown> } | undefined
}

/** `sessionProjectionCache` 服务面（结构化镜像）。 */
interface ProjectionCacheFace {
  cachedSnapshot?(header: unknown, keys?: readonly string[]): { values?: Record<string, unknown> } | undefined
}

/** `sessions` 服务面（结构化镜像）。 */
interface SessionsFace {
  get(id: string): unknown
}

/** 取一个可选服务：`get` 本身抛错也当缺席（老宿主可能没有该服务面）。 */
function optionalService<T>(ctx: CatalogCtxFace, name: string): T | undefined {
  try {
    const service = ctx.get(name) as T | undefined
    return service ?? undefined
  } catch {
    return undefined
  }
}

/** 从投影快照里取标题字符串（宿主 `title` 投影就是 `string | null`）。 */
function titleOf(snapshot: { values?: Record<string, unknown> } | undefined): string | undefined {
  const value = snapshot?.values?.['title']
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

/** Tier 0：活跃会话的**实时**投影（标题随事件推进即时准）。 */
function liveTitle(
  record: CatalogTitleRecord,
  sessions: SessionsFace | undefined,
  projections: ProjectionsFace | undefined,
): string | undefined {
  if (sessions === undefined || projections === undefined) return undefined
  try {
    const session = sessions.get(record.id)
    if (session === undefined || session === null) return undefined
    return titleOf(projections.snapshot(session, ['title']))
  } catch {
    return undefined
  }
}

/** Tier 1：冷会话的持久化 checkpoint（零 I/O；identity 不匹配时宿主返回 undefined）。 */
function cachedTitle(record: CatalogTitleRecord, cache: ProjectionCacheFace | undefined): string | undefined {
  if (cache?.cachedSnapshot === undefined) return undefined
  try {
    return titleOf(cache.cachedSnapshot(record.header, ['title']))
  } catch {
    return undefined
  }
}

/**
 * Tier 1 回退：直接读逐条投影缓存文件（服务缺席的老线 / 装配序未到时）。
 *
 * 缓存文件名可能带 `session-` 前缀也可能不带 —— **两个候选都试**（`dirKey`
 * 同款归一化）。只试白名单候选名，不接受任意路径。
 */
export function titleFromProjectionCacheFile(sessionId: string, dshHome: string): string | undefined {
  if (dshHome === '') return undefined
  const root = projCacheRootFor(dshHome)
  // 候选包含编码名（`im~003A…`）：im: 会话的缓存文件不是原始 id。
  const names = dirNameCandidates(sessionId)
  for (const name of names) {
    const path = join(root, `${name}.json`)
    try {
      if (!existsSync(path)) continue
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        record?: { rows?: { title?: { val?: unknown } } }
      }
      const value = parsed.record?.rows?.title?.val
      if (typeof value === 'string' && value.trim() !== '') return value
    } catch {
      // 单条缓存坏掉只降级该条（不牵连整表，也不抛）。
    }
  }
  return undefined
}

/**
 * 解析一批会话的标题（Tier 0 → Tier 1 → 文件回退 → pending）。
 *
 * 逐条 try/catch：任何单条异常只把该条降级成 `pending`，绝不炸整表。
 * @param ctx - 宿主上下文镜像（`get(name)`）。
 * @param records - 待解析会话（header 必须来自 `listSessions()`）。
 * @param dshHome - DSH 主目录（文件回退定位用）。
 * @returns 已定论标题 + 待分帧读取的会话。
 */
export function resolveTitlesFromProjections(
  ctx: CatalogCtxFace,
  records: readonly CatalogTitleRecord[],
  dshHome: string,
): CatalogTitles {
  const titles = new Map<string, { title: string; source: 'live' | 'cache' }>()
  const pending: CatalogTitleRecord[] = []
  if (records.length === 0) return { titles, pending }
  const sessions = optionalService<SessionsFace>(ctx, 'sessions')
  const projections = optionalService<ProjectionsFace>(ctx, 'sessionProjections')
  const cache = optionalService<ProjectionCacheFace>(ctx, 'sessionProjectionCache')
  for (const record of records) {
    const live = liveTitle(record, sessions, projections)
    if (live !== undefined) {
      titles.set(record.id, { title: live, source: 'live' })
      continue
    }
    const cached = cachedTitle(record, cache) ?? titleFromProjectionCacheFile(record.id, dshHome)
    if (cached !== undefined) {
      titles.set(record.id, { title: cached, source: 'cache' })
      continue
    }
    pending.push(record)
  }
  return { titles, pending }
}

/** memo 的一条结论。 */
export interface TitleMemoEntry {
  /** 标题；`source: 'none'` 时为空串。 */
  title: string
  source: CatalogTitleSource
  /** 过期时刻（epoch ms）。 */
  expiresAt: number
}

/**
 * 进程内标题 memo（5 min TTL）。
 *
 * 只缓存「已定论的结论」：`cache` / `prefix` / `none`。
 * `set(id, title, 'live')` 是显式 no-op —— 活跃会话的标题必须每次重取。
 */
export class TitleMemo {
  private readonly entries = new Map<string, TitleMemoEntry>()

  constructor(
    private readonly ttlMs: number = CATALOG_TITLE_MEMO_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 取一条未过期的结论；过期即顺手清掉。 */
  get(sessionId: string): TitleMemoEntry | undefined {
    const entry = this.entries.get(sessionId)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(sessionId)
      return undefined
    }
    return entry
  }

  /** 记一条结论（`live` 不入 memo；条数超限整体失效）。 */
  set(sessionId: string, title: string | undefined, source: CatalogTitleSource): void {
    if (source === 'live') return
    if (this.entries.size >= CATALOG_TITLE_MEMO_MAX_ENTRIES) this.entries.clear()
    const value = typeof title === 'string' ? title : ''
    this.entries.set(sessionId, { title: value, source, expiresAt: this.now() + this.ttlMs })
  }

  /** 让指定会话失效（清理成功时用：实体没了，负结论也不能留）。 */
  invalidate(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) this.entries.delete(sessionId)
  }

  /** 全量失效（归档/取消归档改变可见性：列表要重排，标题可能也变了）。 */
  invalidateAll(): void {
    this.entries.clear()
  }

  /** 当前条数（测试与诊断用）。 */
  get size(): number {
    return this.entries.size
  }
}
