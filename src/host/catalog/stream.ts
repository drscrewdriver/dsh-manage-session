/**
 * 分帧标题流的并发编排（SSE 宿主侧）。
 *
 * 三件事，缺一不可：
 *
 * 1. **并发**：固定 4 路 worker 消费队列（与宿主 `SESSION_QUERY_DEFAULT_
 *    PERSISTED_INSPECT_CONCURRENCY` / `corpus.projectMany` 同档，避免磁盘争抢）；
 * 2. **预算**：超过 `budgetMs` 后把尚未认领的 id 一次性如实回报 `timeout`
 *    —— 面板宁可显示「未命名」也不允许一个会话把整条流拖住；
 * 3. **可中止**：`signal` 中止即停止消费并记一行 `aborted after N frames`；
 *    在途的那几条读完当前帧就退出（不会把 858 MB 解压完）。
 *
 * 单条异常只把该条记为 `none`，不影响其他会话（与批量处置的会话隔离语义一致）。
 */
import {
  CATALOG_TITLE_MAX_FRAMES,
  CATALOG_TITLE_MAX_WINDOW_BYTES,
  CATALOG_TITLE_WINDOW_BYTES,
  buildSessionDirIndex,
  locateSessionLog,
  readTitleByFrames,
  type FrameTitleHit,
  type FrameTitleOptions,
} from './frame-title.ts'
import type { CatalogTitleRecord } from './title-source.ts'

/** 并发路数（与宿主既有读并发同档）。 */
export const CATALOG_STREAM_CONCURRENCY = 4
/** 单次流的墙钟预算：到点即把剩余会话按 `timeout` 回报。 */
export const CATALOG_STREAM_BUDGET_MS = 8_000

/** 一条标题事件（SSE `data:` 的载荷形状；客户端按此就地替换行标题）。 */
export interface CatalogTitleEvent {
  sessionId: string
  /** 命中标题；`none` / `timeout` 时缺省。 */
  title?: string
  source: 'prefix' | 'none' | 'timeout'
  bytesRead: number
  frames: number
}

/** 流选项。 */
export interface CatalogStreamOptions {
  dshHome: string
  /** 中止信号（面板关闭 / 客户端 abort / 路由 close）。 */
  signal: AbortSignal
  concurrency?: number
  budgetMs?: number
  onTitle: (event: CatalogTitleEvent) => void
  log?: (message: string) => void
  /** 测试缝：默认走 `frame-title.ts` 的真实实现。 */
  readTitle?: (file: string, options?: FrameTitleOptions) => Promise<FrameTitleHit>
  /** 测试缝：默认走 `frame-title.ts` 的真实定位。 */
  locate?: (sessionId: string, dshHome: string, dirs?: ReadonlyMap<string, string>) => string | undefined
}

/** 单条读的最大窗口/帧上限：流路径与 catalog 常量同源，避免两处各自漂移。 */
const READ_OPTIONS = {
  windowBytes: CATALOG_TITLE_WINDOW_BYTES,
  maxWindowBytes: CATALOG_TITLE_MAX_WINDOW_BYTES,
  maxFrames: CATALOG_TITLE_MAX_FRAMES,
} as const

/**
 * 逐条推标题（每条会话**恰好一个**事件：命中 / `none` / `timeout`）。
 *
 * 返回时不会再有事件发出：worker 全部退出后调用方才写 `event: done`。
 * @param records - 待读会话（按输入顺序消费；结果顺序不保证）。
 * @param options - 并发/预算/中止/出口。
 */
export async function streamCatalogTitles(
  records: readonly CatalogTitleRecord[],
  options: CatalogStreamOptions,
): Promise<void> {
  if (records.length === 0) return
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? CATALOG_STREAM_CONCURRENCY))
  const budgetMs = Math.max(1, Math.floor(options.budgetMs ?? CATALOG_STREAM_BUDGET_MS))
  const readTitle = options.readTitle ?? readTitleByFrames
  const locate = options.locate ?? locateSessionLog
  // 目录索引建一次共享：252 个会话逐个重扫语料根是 O(n) syscall 放大。
  const dirs = buildSessionDirIndex(options.dshHome)
  const startedAt = Date.now()
  let cursor = 0
  let framesRead = 0
  let abortedLogged = false

  const emit = (sessionId: string, event: Omit<CatalogTitleEvent, 'sessionId'>): void => {
    try {
      options.onTitle({ sessionId, ...event })
    } catch (err) {
      // 出口（res.write / SSE 编码）异常绝不打断其余会话。
      options.log?.(`title event sink failed for ${sessionId}: ${String(err instanceof Error ? err.message : err)}`)
    }
  }

  /** 中止只记一次：既可能在循环头部发现，也可能从在途读的 AbortError 里冒上来。 */
  const stopForAbort = (): void => {
    if (abortedLogged) return
    abortedLogged = true
    options.log?.(`aborted after ${framesRead} frames`)
  }

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal.aborted) {
        stopForAbort()
        return
      }
      if (Date.now() - startedAt > budgetMs) {
        // 预算耗尽：把**尚未认领**的 id 一次回报为 timeout（每条恰好一个事件）。
        while (cursor < records.length) {
          const record = records[cursor]
          cursor += 1
          if (record === undefined) break
          emit(record.id, { source: 'timeout', bytesRead: 0, frames: 0 })
        }
        return
      }
      const record = records[cursor]
      cursor += 1
      if (record === undefined) return
      const file = locate(record.id, options.dshHome, dirs)
      if (file === undefined) {
        // 磁盘上没有日志（`im:*` 虚拟会话）：一次 `none` 即终结，不重试。
        emit(record.id, { source: 'none', bytesRead: 0, frames: 0 })
        continue
      }
      try {
        const hit = await readTitle(file, { ...READ_OPTIONS, signal: options.signal })
        framesRead += hit.frames
        emit(record.id, {
          ...(hit.title === undefined ? {} : { title: hit.title }),
          source: hit.source,
          bytesRead: hit.bytesRead,
          frames: hit.frames,
        })
      } catch (err) {
        if (options.signal.aborted) {
          // 在途读被中止：也要留一行痕（面板关掉后宿主不得继续解压）。
          stopForAbort()
          return
        }
        options.log?.(`title frame read failed for ${record.id}: ${String(err instanceof Error ? err.message : err)}`)
        emit(record.id, { source: 'none', bytesRead: 0, frames: 0 })
      }
    }
  }

  const workers = Math.min(concurrency, records.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
}
