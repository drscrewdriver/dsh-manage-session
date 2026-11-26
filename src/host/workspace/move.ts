/**
 * 会话移动工作区：宿主存储层的读写原语。
 *
 * **为什么需要自己搬**：官方 `WorkspaceRegistry` 只有 `create/list/get/delete/
 * insertBefore/archiveSession/unarchiveSession/pinSession/unpinSession/resolveByPath`，
 * **没有任何跨工区转移会话的方法**。工区归属的唯一真源是会话 header 的 `cwd`
 * （见 `@deepseek-ai/dsh-workspace/lib/types/entity.d.ts`：成员判定靠「header cwd 的
 * canonical-cwd 索引」，`workspaceRecord.sessionIds` 只是记账槽位）。
 *
 * 所以「移动」只能是：改写日志首帧的 cwd + 把日志目录搬到目标 cwd 对应的
 * `--projectKey--` 下。本文件只做**纯函数与磁盘原语**，不做校验决策（那在 index.ts）。
 *
 * 目录名编码 `projectKey` 逐字符复刻宿主 `session-persistence-jsonl/lib/index.js`
 * 的 `projectKey`（含 251 截断与分隔符折叠）—— 有损，不能自创，否则宿主找不到日志。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

/** 会话日志文件名（v4 起为 zstd 压缩的 jsonl）。 */
const SESSION_LOG_V4 = 'session.v4.jsonl.zstd'
/** 未压缩形态（老会话/直接 jsonl 后端）。 */
const SESSION_LOG_PLAIN = 'session.v4.jsonl'

/**
 * 宿主目录名编码（`--<readable>--`）。与 `session-persistence-jsonl` 的
 * `projectKey()` 逐字符同构：`/ \ :` 折叠成单个 `-`，其余非安全字符 `~XXXX`，
 * 截断 251 后去前导 `-`，空则用 `root`。
 * @param cwd - 会话的项目目录（绝对路径）。
 * @returns 可直接当目录名的 key。
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 一个工区（宿主 `workspace.json` 里的行）。 */
export interface WorkspaceRow {
  id: string
  title: string
  path: string
}

/**
 * 读宿主工区表：`<dshHome>/storages/workspace.json` 的 `tables.workspaces`。
 *
 * 只读、结构畸形时抛错（宁可报错也不给调用方一个假空表 —— 那会让「移动」以为
 * 没有可用工区）。
 * @param dshHome - DSH 主目录。
 * @returns 工区行（按 id 排序稳定）。
 */
export function readWorkspaceRows(dshHome: string): WorkspaceRow[] {
  const file = join(dshHome, 'storages', 'workspace.json')
  if (!existsSync(file)) throw new Error('找不到工区表 workspace.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    tables?: { workspaces?: Record<string, { path?: unknown; title?: unknown }> }
  }
  const table = parsed.tables?.workspaces
  if (table === null || table === undefined || typeof table !== 'object') throw new Error('工区表结构异常：缺少 tables.workspaces')
  const rows: WorkspaceRow[] = []
  for (const [id, value] of Object.entries(table)) {
    if (value === null || typeof value !== 'object') continue
    const path = typeof value.path === 'string' ? value.path : ''
    if (path === '') continue
    rows.push({ id, path, title: typeof value.title === 'string' && value.title !== '' ? value.title : path })
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

/** 定位到的会话日志。 */
export interface LocatedLog {
  /** 日志文件绝对路径。 */
  file: string
  /** 所在会话目录（`sessions/--<key>--/<id>/`）。 */
  dir: string
  /** 所在 projectKey 目录（`sessions/--<key>--`）。 */
  projectDir: string
  /** 是否 zstd 压缩。 */
  compressed: boolean
}

/** 会话 id 的目录名候选（子会话目录名不带 `session-` 前缀）。 */
function dirCandidates(sessionId: string): string[] {
  const bare = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  const encode = (raw: string): string => {
    let out = ''
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i)
      const ch = String.fromCharCode(code)
      if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
      else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
    return out
  }
  return [...new Set([sessionId, bare, encode(sessionId), encode(bare)])]
}

/**
 * 在 `sessions/` 下定位某会话的日志。
 *
 * 不信任项目目录名（cwd 可能被改过/被别的进程移动过），所以**扫一遍全部
 * projectKey 目录**找会话目录。会话数规模下这是毫秒级。
 * @param dshHome - DSH 主目录。
 * @param sessionId - 会话 id。
 * @returns 定位结果，找不到返回 undefined。
 */
export function locateSessionLog(dshHome: string, sessionId: string): LocatedLog | undefined {
  const root = join(dshHome, 'sessions')
  if (!existsSync(root)) return undefined
  const wanted = new Set(dirCandidates(sessionId))
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return undefined
  }
  for (const projectName of projectDirs) {
    const projectDir = join(root, projectName)
    for (const dirName of wanted) {
      const dir = join(projectDir, dirName)
      if (!existsSync(dir)) continue
      for (const [name, compressed] of [[SESSION_LOG_V4, true], [SESSION_LOG_PLAIN, false]] as const) {
        const file = join(dir, name)
        if (!existsSync(file)) continue
        try {
          if (!statSync(file).isFile()) continue
        } catch {
          continue
        }
        return { file, dir, projectDir, compressed }
      }
    }
  }
  return undefined
}

/** 读日志文本（自动解 zstd）。 */
export function readLogText(log: LocatedLog): string {
  const raw = readFileSync(log.file)
  if (!log.compressed) return raw.toString('utf8')
  return zstdDecompressSync(raw).toString('utf8')
}

/** 写日志文本（按原压缩形态回写）。 */
export function writeLogText(log: LocatedLog, text: string): Buffer {
  return log.compressed ? zstdCompressSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8')
}

/** 会话 header（只取我们要改的那个字段 + 校验用的 id）。 */
export interface LogHeader {
  cwd?: string
  id?: string
  [key: string]: unknown
}

/**
 * 改写日志首帧的 `cwd`。
 *
 * **只碰首帧第一行**：其余行原样保留（包括结尾换行形态），行数必须不变。
 * @param text - 日志全文。
 * @param targetCwd - 目标工区路径。
 * @returns 改写后的全文与解析出的原 header。
 * @throws 首帧不是 session header / id 缺失 / 结果行数与原文不同。
 */
export function rewriteHeaderCwd(text: string, targetCwd: string): { text: string; header: LogHeader; fromCwd: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const first = lines[0]
  if (first === undefined || first.trim() === '') throw new Error('会话日志首行为空，拒绝改写')
  let header: LogHeader
  try {
    header = JSON.parse(first) as LogHeader
  } catch {
    throw new Error('会话日志首行不是合法 JSON，拒绝改写')
  }
  if (header === null || typeof header !== 'object' || header.type !== 'session') {
    throw new Error('会话日志首行不是 session header，拒绝改写')
  }
  if (typeof header.id !== 'string' || header.id === '') throw new Error('会话 header 缺少 id，拒绝改写')
  const fromCwd = typeof header.cwd === 'string' ? header.cwd : ''
  const next: LogHeader = { ...header, cwd: targetCwd }
  const nextLines = [JSON.stringify(next), ...lines.slice(1)]
  const out = nextLines.join(eol)
  if (nextLines.length !== lines.length) throw new Error('改写后行数变化，拒绝写入')
  return { text: out, header: next, fromCwd }
}

/** 一次移动操作的结果（落盘层面）。 */
export interface MoveOutcome {
  fromPath: string
  toPath: string
  /** 移动前的 cwd（也就是原工区路径的真源）。 */
  fromCwd: string
  fromProjectKey: string
  toProjectKey: string
  bytes: number
  /** 备份目录（旧目录整体搬到这里，不硬删）。 */
  backupDir: string
}

/**
 * 执行移动：写新目录 → 备份旧目录。
 *
 * 顺序不可反：先让新位置完整可读（先写临时名再 rename），再动旧目录；
 * 中途失败时新目录会被清掉，旧目录原封不动。
 * @param input - 定位结果 + 目标 cwd + 备份根 + 会话 id。
 * @returns 落盘结果。
 */
export function moveSessionLog(input: {
  log: LocatedLog
  targetCwd: string
  dshHome: string
  sessionId: string
  backupRoot: string
  stamp: string
}): MoveOutcome {
  const { log, targetCwd, dshHome, sessionId, backupRoot, stamp } = input
  const text = readLogText(log)
  const rewritten = rewriteHeaderCwd(text, targetCwd)

  const targetKey = projectKey(targetCwd)
  const fromKey = projectKey(rewritten.fromCwd === '' ? targetCwd : rewritten.fromCwd)
  const targetProjectDir = join(dshHome, 'sessions', targetKey)
  mkdirSync(targetProjectDir, { recursive: true })
  // 复用原会话目录名（通常就是 id 或裸 id；保持宿主既有命名）
  const dirName = log.dir.slice(log.dir.replace(/[\\/]+$/, '').lastIndexOf(log.projectDir) + log.projectDir.length + 1) || sessionId
  const targetDir = join(targetProjectDir, dirName)
  const targetFile = join(targetDir, log.compressed ? SESSION_LOG_V4 : SESSION_LOG_PLAIN)
  const tmpFile = join(targetDir, `.${log.compressed ? SESSION_LOG_V4 : SESSION_LOG_PLAIN}.tmp`)

  if (existsSync(targetFile)) throw new Error(`目标位置已存在同名日志：${targetFile}`)

  const bytes = Buffer.byteLength(rewritten.text, 'utf8')
  try {
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(tmpFile, writeLogText(log, rewritten.text))
    // 原子落地：同目录 rename 不会跨盘
    renameSync(tmpFile, targetFile)
    // 回读校验：解压后首帧 id 与 cwd 都要对
    const verify = readLogText({ ...log, file: targetFile })
    const firstLine = verify.split(verify.includes('\r\n') ? '\r\n' : '\n')[0] ?? ''
    const verified = JSON.parse(firstLine) as LogHeader
    if (verified.id !== rewritten.header.id || verified.cwd !== targetCwd) {
      throw new Error('新日志回读校验失败（id 或 cwd 不符）')
    }
  } catch (err) {
    // 回滚：新目录整体删掉，旧位置未动
    try {
      rmSync(targetDir, { recursive: true, force: true })
    } catch { /* 回滚失败不掩盖原错误 */ }
    throw err
  }

  // 旧目录进备份（不硬删：出问题能整目录搬回去）
  mkdirSync(backupRoot, { recursive: true })
  const backupDir = join(backupRoot, `${sessionId}-${stamp}`)
  mkdirSync(backupDir, { recursive: true })
  const movedFromPath = log.dir
  const backupTarget = join(backupDir, dirName)
  try {
    renameSync(log.dir, backupTarget)
  } catch (err) {
    // 备份失败：把新目录撤掉，保持「要么移动成功要么原样」
    try {
      rmSync(targetDir, { recursive: true, force: true })
    } catch { /* noop */ }
    throw new Error(`旧目录备份失败，已回滚：${String(err instanceof Error ? err.message : err)}`)
  }
  // 顺手清掉空掉的旧 projectKey 目录（宿主会自建，不影响正确性）
  try {
    if (readdirSync(log.projectDir).length === 0) rmSync(log.projectDir, { recursive: true, force: true })
  } catch { /* 非空/占用都跳过 */ }

  return {
    fromPath: movedFromPath,
    toPath: targetDir,
    fromCwd: rewritten.fromCwd,
    fromProjectKey: fromKey,
    toProjectKey: targetKey,
    bytes,
    backupDir,
  }
}

/** 一条移动履历。 */
export interface MoveLedgerEntry {
  ts: number
  sessionId: string
  fromPath: string
  toPath: string
  fromWorkspaceId: string
  toWorkspaceId: string
  fromProjectKey: string
  toProjectKey: string
  bytes: number
}

/** 履历文件路径。 */
export function moveLedgerPath(dshHome: string): string {
  return join(dshHome, 'storages', 'manage-session', 'move-ledger.jsonl')
}

/**
 * 追加一条移动履历（首次调用时创建文件）。
 * @param dshHome - DSH 主目录。
 * @param entry - 履历条目。
 * @returns 履历文件路径。
 */
export function appendMoveLedger(dshHome: string, entry: MoveLedgerEntry): string {
  const file = moveLedgerPath(dshHome)
  mkdirSync(join(dshHome, 'storages', 'manage-session'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(entry)}\n`, { flag: 'a' })
  return file
}

/**
 * 读最近 N 条履历（新的在后）。
 * @param dshHome - DSH 主目录。
 * @param limit - 条数上限。
 */
export function readMoveLedger(dshHome: string, limit = 50): MoveLedgerEntry[] {
  const file = moveLedgerPath(dshHome)
  if (!existsSync(file)) return []
  const entries: MoveLedgerEntry[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      entries.push(JSON.parse(line) as MoveLedgerEntry)
    } catch { /* 坏行跳过：履历是旁路证据，不该让面板打不开 */ }
  }
  return entries.slice(-limit)
}
