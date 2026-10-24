/**
 * 退场墓碑台账（2026-10-20 用户定标）：任何 purge 成功路径都往
 * `~/.dsh-manage-sessions-index/retired-tombstones.jsonl` 追加一行
 * `{sessionId, retiredAt, source}`，作为离线清残脚本
 * （scripts/cleanup-retired.mjs）的驱动清单。
 *
 * 为什么需要：宿主 `registry.deleteSession` 与 `purgeHistory` 各自覆盖 4 处
 * 实体（转录目录/projcache/workspace.json 两处 id），但任一路径中途失败、
 * 索引联动（onPurged）进程崩溃、或 collector 同步轮未跑，都会留下残行/残
 * 目录。墓碑 = 「这个 id 已被判退场」的持久凭证，DSH 关闭后脚本据此兜底
 * 清扫，不靠现场推断。
 *
 * 纪律：
 * - **append-only、best-effort**：写台账失败绝不影响删除结果返回（try/catch
 *   吞错并 log），台账是副账不是主账；
 * - 每行一个 JSON（JSONL），读侧跳过畸形行——半行（进程崩在 append 中间）
 *   不致命；
 * - 幂等消费：脚本按 id 集合去重，重复墓碑无害；台账只增不删（体积可忽略，
 *   每行 ~120B）。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 台账文件名（固定；脚本以默认路径发现）。 */
export const TOMBSTONE_FILE = 'retired-tombstones.jsonl'

/** 一条退场墓碑。 */
export interface RetiredTombstone {
  sessionId: string
  /** ISO 时间串（写入时刻）。 */
  retiredAt: string
  /** 落账来源：内存全痕删除 / 文件兜底删除 / 测试注入。 */
  source: string
}

/** 默认台账目录 = 索引缺省落点（与 rebuild.ts 的 ~/.dsh-manage-sessions-index 同根）。 */
export function defaultTombstoneDir(): string {
  return join(homedir(), '.dsh-manage-sessions-index')
}

/** 台账文件绝对路径。 */
export function tombstonePathFor(dir: string): string {
  return join(dir, TOMBSTONE_FILE)
}

/**
 * 追加一批墓碑（一次 purge 成功的 id 集）。best-effort：目录不可建/盘不可写
 * 只经 `log` 报一行，绝不抛——删除动作的成败判定先于本调用完成。
 * @returns 实际写出的行数（0 = 静默失败或空入参）。
 */
export function appendRetiredTombstones(
  sessionIds: readonly string[],
  opts: { dir?: string; source: string; now?: () => Date; log?: (msg: string) => void },
): number {
  const ids = [...new Set(sessionIds.filter((id) => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) return 0
  const dir = opts.dir ?? defaultTombstoneDir()
  const now = opts.now ?? (() => new Date())
  try {
    mkdirSync(dir, { recursive: true })
    const stamp = now().toISOString()
    const lines = ids.map((id) => JSON.stringify({ sessionId: id, retiredAt: stamp, source: opts.source } satisfies RetiredTombstone) + '\n')
    appendFileSync(join(dir, TOMBSTONE_FILE), lines.join(''), 'utf8')
    return lines.length
  } catch (err) {
    opts.log?.(`tombstone append failed (deletion itself succeeded): ${String(err instanceof Error ? err.message : err)}`)
    return 0
  }
}

/**
 * 读台账（脚本与单测共用）：畸形行/半行跳过，缺文件回空数组。
 */
export function readRetiredTombstones(file: string): RetiredTombstone[] {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: RetiredTombstone[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof record['sessionId'] === 'string' && record['sessionId'] !== '') {
        out.push({
          sessionId: record['sessionId'],
          retiredAt: typeof record['retiredAt'] === 'string' ? record['retiredAt'] : '',
          source: typeof record['source'] === 'string' ? record['source'] : '',
        })
      }
    } catch {
      /* 半行/脏行：跳过（append 撕裂的预期形态） */
    }
  }
  return out
}
