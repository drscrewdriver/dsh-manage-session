/**
 * 首帧标题读（Tier 2 兜底）：**只读文件首窗 × 只解压到出现 `session/title` 的帧为止**。
 *
 * 为什么需要它
 * ------------
 * 宿主 `sessionQuery.readTitleSnapshots` 的契约是「解压整份日志 + 构造全部事件再
 * findLast」，取一个标题等于读完整份会话（本机实测 252 个会话 858 MB / 12.4 s）。
 * 管理台首屏只是要一个标题，不需要事件序列。实测按**帧号**统计，242/252 的首个
 * `session/title` 落在前 8 帧内 —— 于是「读到命中就停」是可行且安全的优化。
 *
 * 纪律（与 DRS 分帧解码同构，但**不 vendor 其代码**）
 * -------------------------------------------------
 * - 帧彼此独立，天然可切分：逐帧 `await` 线程池解压，绝不用同步 zstd 解压 API
 *   压住宿主主线程；
 * - 每 `CATALOG_TITLE_YIELD_EVERY_FRAMES` 帧 `setImmediate` 让路一次（DRS 的
 *   `session-decode-async.ts` 同款粒度：更细会拖垮吞吐，更粗会让主线程尖峰）；
 * - 撕裂尾帧（写到一半的帧）只作废该帧，**不抛错**（宿主正在追加写入是常态）；
 * - 只读：本模块不写、不改、不重命名任何会话文件。
 *
 * 命中判据是「首个非空 `session/title`」：缓存路径（checkpoint）取的是最后一次
 * fold 结果，前缀读只看前几帧 —— 两者只在「改名很多、且改名发生在首窗之外」时
 * 才会不一致，此时宁可显示旧名也不用整份日志去换一个新名字。
 */
import { open } from 'node:fs/promises'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { scanZstdFrames } from '../health/decode.ts'
import { readSessionGenerations } from '../health/generation.ts'
import { dirKey, indexSessionDirs, sessionsRootFor } from '../history/purge.ts'

/**
 * 帧扫描与宿主 `session-persistence-jsonl/src/zstd.ts::scanZstdFrames` 同构：
 * 本包已在 `health/decode.ts` 内置了等价实现（体检链路在用），这里直接复用，
 * 不再复制第二份扫描器（两份实现迟早会漂）。
 */
export { scanZstdFrames }

/** 首窗大小：实测 256 KB 覆盖 208/252 的首标题。 */
export const CATALOG_TITLE_WINDOW_BYTES = 256 * 1024
/** 窗口上限：噪声边界，防止「晚标题」会话把整份日志拖进来（超出按 `none` 回报）。 */
export const CATALOG_TITLE_MAX_WINDOW_BYTES = 8 * 1024 * 1024
/** 单会话最多解压的帧数（实测 6 个「晚标题」会话落在 32 帧内）。 */
export const CATALOG_TITLE_MAX_FRAMES = 32
/** 让路粒度（帧）：DRS 的同款取值。 */
export const CATALOG_TITLE_YIELD_EVERY_FRAMES = 8

/** 一次前缀读的结果。 */
export interface FrameTitleHit {
  /** 命中的标题；未命中时缺省（不填 undefined 字段）。 */
  title?: string
  /** `prefix` = 在窗口/帧上限内命中；`none` = 读完允许范围仍无标题。 */
  source: 'prefix' | 'none'
  /** 实际从磁盘读入的字节数（窗口扩张会累加）。 */
  bytesRead: number
  /** 实际解压的帧数。 */
  frames: number
  /** 依次尝试的窗口大小（字节），用于断言「有没有扩张」。 */
  windows: number[]
}

/** 前缀读选项。 */
export interface FrameTitleOptions {
  /** 首窗字节数（缺省 `CATALOG_TITLE_WINDOW_BYTES`）。 */
  windowBytes?: number
  /** 窗口上限（缺省 `CATALOG_TITLE_MAX_WINDOW_BYTES`）。 */
  maxWindowBytes?: number
  /** 帧数上限（缺省 `CATALOG_TITLE_MAX_FRAMES`）。 */
  maxFrames?: number
  /** 每多少帧让路一次（缺省 `CATALOG_TITLE_YIELD_EVERY_FRAMES`）。 */
  yieldEveryFrames?: number
  /** 中止信号：面板关闭/客户端 abort 时立刻停读。 */
  signal?: AbortSignal
}

/** 线程池解压（`zlib.zstdDecompress` 的 promisify；禁止同步版出现在读路径）。 */
const decompressAsync = promisify(zlib.zstdDecompress) as unknown as (chunk: Buffer) => Promise<Buffer>

/** 让路一帧：把主线程交还给宿主的交互路径。 */
function yieldToHost(): Promise<void> {
  return new Promise<void>((resolve) => { setImmediate(resolve) })
}

/** 从一行 JSONL 里取标题（预筛之后的唯一解析点）。 */
function titleFromLine(line: string): string | undefined {
  if (!line.includes('"session/title"')) return undefined
  try {
    const parsed = JSON.parse(line) as { type?: unknown; data?: { title?: unknown } }
    if (parsed.type !== 'session/title') return undefined
    const title = parsed.data?.title
    if (typeof title !== 'string') return undefined
    const trimmed = title.trim()
    return trimmed === '' ? undefined : title
  } catch {
    return undefined
  }
}

/**
 * 把一段解压文本按行切分取标题；跨帧的半行留在 `carry` 里等内容补全。
 * @returns 本次是否命中，以及新的未完成行。
 */
function takeTitle(carry: string, text: string): { carry: string; title?: string } {
  const combined = carry + text
  const lines = combined.split('\n')
  const carryOut = lines.pop() ?? ''
  for (const line of lines) {
    const title = titleFromLine(line)
    if (title !== undefined) return { carry: carryOut, title }
  }
  return { carry: carryOut }
}

/** 明文产物（`compression=none`）的整窗取标题。 */
function titleInPlaintext(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const title = titleFromLine(line)
    if (title !== undefined) return title
  }
  return undefined
}

/** 读文件的一段（从 `offset` 起补足到 `target` 字节）。 */
async function fill(
  handle: Awaited<ReturnType<typeof open>>,
  collected: Buffer,
  target: number,
): Promise<{ collected: Buffer; read: number }> {
  if (target <= collected.length) return { collected, read: 0 }
  const want = target - collected.length
  const chunk = Buffer.allocUnsafe(want)
  const { bytesRead } = await handle.read(chunk, 0, want, collected.length)
  return {
    collected: bytesRead === 0 ? collected : Buffer.concat([collected, chunk.subarray(0, bytesRead)]),
    read: bytesRead,
  }
}

/**
 * 只读首窗、逐帧解压到出现 `session/title` 即停。
 *
 * 失败一律降级：打不开文件、窗口内无命中、帧解压失败、尾帧撕裂 —— 都返回
 * `source:'none'`（调用方据此如实回报，不得编造标题）。只有 `signal` 中止会抛
 * `AbortError`，让上层立刻停止整批读取。
 * @param file - 当前代日志的绝对路径（由 `locateSessionLog` 给出，**不做路径拼接**）。
 * @param options - 窗口/帧/让路/中止选项。
 * @returns 命中的标题、实际读入字节、解压帧数与窗口序列。
 */
export async function readTitleByFrames(file: string, options: FrameTitleOptions = {}): Promise<FrameTitleHit> {
  const windowBytes = Math.max(4096, Math.floor(options.windowBytes ?? CATALOG_TITLE_WINDOW_BYTES))
  const maxWindowBytes = Math.max(windowBytes, Math.floor(options.maxWindowBytes ?? CATALOG_TITLE_MAX_WINDOW_BYTES))
  const maxFrames = Math.max(1, Math.floor(options.maxFrames ?? CATALOG_TITLE_MAX_FRAMES))
  const yieldEveryFrames = Math.max(1, Math.floor(options.yieldEveryFrames ?? CATALOG_TITLE_YIELD_EVERY_FRAMES))
  const signal = options.signal
  const windows: number[] = []
  let bytesRead = 0
  let frames = 0
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    signal?.throwIfAborted()
    handle = await open(file, 'r')
    const size = (await handle.stat()).size
    if (size === 0) return { source: 'none', bytesRead: 0, frames: 0, windows: [] }
    let collected: Buffer = Buffer.alloc(0)
    /** 已处理到的帧下标（窗口扩张后只处理新增的完整帧）。 */
    let frameIndex = 0
    let carry = ''
    /** 首个完整帧的魔数判定：不是 zstd 头就按明文 JSONL 处理。 */
    let plaintext: boolean | undefined
    let window = Math.min(windowBytes, size)
    for (;;) {
      signal?.throwIfAborted()
      windows.push(window)
      const filled = await fill(handle, collected, Math.min(window, size))
      collected = filled.collected
      bytesRead += filled.read
      if (plaintext === undefined && collected.length > 0) {
        // 只判一次：首帧魔数不是 zstd 就是明文产物（`compression: 'none'`）。
        plaintext = collected.length >= 4 ? !isZstdMagic(collected) : false
      }
      if (plaintext === true) {
        const title = titleInPlaintext(collected.toString('utf8'))
        if (title !== undefined) return { title, source: 'prefix', bytesRead, frames: 0, windows }
      } else {
        const scan = scanZstdFrames(collected)
        while (frameIndex < scan.frames.length && frames < maxFrames) {
          const frame = scan.frames[frameIndex]
          frameIndex += 1
          frames += 1
          let text: string
          try {
            text = (await decompressAsync(collected.subarray(frame.start, frame.end))).toString('utf8')
          } catch {
            // 单帧坏掉不影响其余帧：如实跳过（与宿主的 fail-soft 同语义）。
            continue
          }
          const step = takeTitle(carry, text)
          carry = step.carry
          if (step.title !== undefined) return { title: step.title, source: 'prefix', bytesRead, frames, windows }
          if (frames % yieldEveryFrames === 0) await yieldToHost()
          signal?.throwIfAborted()
        }
      }
      if (collected.length >= size) break
      if (window >= maxWindowBytes) break
      if (frames >= maxFrames) break
      window = Math.min(maxWindowBytes, window * 4)
    }
    return { source: 'none', bytesRead, frames, windows }
  } catch (err) {
    if (signal?.aborted === true) throw err
    return { source: 'none', bytesRead, frames, windows }
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close()
      } catch { /* 已关闭 */ }
    }
  }
}

/** zstd 帧魔数（0xFD2FB528 的小端读取值），与 `health/decode.ts` 同一常量。 */
function isZstdMagic(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 4247762216
}

/**
 * 扫一遍 `<dshHome>/sessions`，建立「归一化会话 id → 目录」索引。
 *
 * 复用 `history/purge.ts::indexSessionDirs`（同一套白名单：只认两层目录结构），
 * 批处理时**建一次共享**，避免每个会话都重扫一遍语料根。
 * @param dshHome - DSH 主目录。
 * @returns 归一化 id → 目录绝对路径（读不到时为空表，不抛）。
 */
export function buildSessionDirIndex(dshHome: string): Map<string, string> {
  try {
    return indexSessionDirs(sessionsRootFor(dshHome))
  } catch {
    return new Map()
  }
}

/**
 * 会话 id → 当前代日志文件。
 *
 * 只走 `indexSessionDirs` 的白名单定位，**绝不按 id 拼路径**：`im:union:*` 这类
 * 虚拟会话在索引里查不到就是 `undefined`（如实回报 `source:'none'`），拼路径会让
 * 它们变成一次必然失败的 `open`。
 * @param sessionId - 会话 id（带不带 `session-` 前缀都接受）。
 * @param dshHome - DSH 主目录。
 * @param dirs - 可选的预建索引（批处理共享）。
 * @returns 当前代产物路径；目录不存在/无规范产物时为 undefined。
 */
export function locateSessionLog(
  sessionId: string,
  dshHome: string,
  dirs?: ReadonlyMap<string, string>,
): string | undefined {
  try {
    const index = dirs ?? buildSessionDirIndex(dshHome)
    const dir = index.get(dirKey(sessionId))
    if (dir === undefined) return undefined
    return readSessionGenerations(dir).current?.path
  } catch {
    return undefined
  }
}
