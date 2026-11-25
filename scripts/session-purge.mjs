#!/usr/bin/env node
/**
 * 会话清理确定性脚本（`dsh-manage-session` 附带，宿主关闭后运行）。
 *
 * 为什么要有它
 * ------------
 * 管理台里的「真删除」在宿主进程内执行：目录删了，但宿主内存里还活着的会话、
 * 未来重启时的记账写回，都可能让侧栏/管理台仍留着一条只有 uuid 的“幽灵”行。
 * 本脚本把删除搬到**宿主关闭后**，并且**永不直接 rm**：
 *
 * ```
 * list     只读：扫盘 + 分类，产出清单（默认动作，不写任何东西）
 * archive  只写记账：把选中 id 记进 workspace.json 的 archivedSessionIds
 *          （先归档 → 侧栏立刻不可见 → 由用户复核确实“该删的是它”）
 * trash    回收站：**强制已归档且复核通过**，把会话目录 + 投影缓存整段搬进
 *          `<dshHome>/trash/manage-session/<batch>/`（含 manifest.json），
 *          并从归档集合/工作区成员表里摘掉 uuid（幽灵编号在此清除）
 * compact  二级压缩归档：把回收站里到期的**整批**按周期（day/week/month）合并重压成
 *          一个 `archive/<周期>.tar.zst`，然后把“可直接恢复”的散目录清空
 * restore  可恢复：`--batch <批次>`（未压缩散目录）或 `--archive <周期> [--ids ...]`
 * ledger   回看：打印清理/压缩/恢复台账（append-only，逐条 uuid）
 * ```
 *
 * 硬约束
 * ------
 * - 宿主（DSH Desktop / deepseek-harness）在跑就拒绝执行 trash/compact/restore
 *   （`--allow-running` 只在明知风险时用）；list 只读，随时可跑。
 * - 移动顺序固定为「先归档 → 复核 → 搬文件 → 摘记账」：任一步失败都停在
 *   可重试的状态，不会留下“文件在、记账无”或“记账在、文件无”。
 * - 每条 uuid、cwd、createdAt、字节数、批次、sha256 全部写进 ledger。
 * - 路径安全：搬运目标必须是 `<dshHome>/sessions/<workspace>/<session>/` 的直接
 *   子项；越界一律拒绝（不做“拼路径”搬运）。
 * - 会话 id ↔ 目录名：宿主用 `encodeSegment` 把非法文件名字符转成 `~XXXX`
 *   （`im:…@im.wechat` → `im~003A…~0040im.wechat`），本脚本双向都认，
 *   所以 `im:` 虚拟会话也能被列到、也能被归档进回收站。
 *
 * 用法
 * ----
 * ```
 * node scripts/session-purge.mjs list                       # 出清单（默认）
 * node scripts/session-purge.mjs list --json                # 机器可读
 * node scripts/session-purge.mjs archive --ids <id,id,...>  # 先归档（也可 --class）
 * node scripts/session-purge.mjs trash  --class empty-session --archive-first
 * node scripts/session-purge.mjs compact --older-than 7 --window week  # 按周期合并压缩并清空散目录
 * node scripts/session-purge.mjs restore --archive <周期> [--ids <id,...>]  # 反悔：从归档原样搬回
 * node scripts/session-purge.mjs ledger
 * ```
 * 通用选项：`--dsh-home <path>`、`--plan <json>`、`--allow-running`、`--dry-run`。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import zlib from 'node:zlib'

const ZSTD_MAGIC = 4247762216
/** 判定“空会话”的最大日志字节数：再大就按有内容处理（不整份解压，避免拖死）。 */
const EMPTY_SESSION_MAX_BYTES = 64 * 1024
/** 前缀读标题的帧上限（与插件 frame-title 同款预算）。 */
const TITLE_MAX_FRAMES = 32

/** 分类键（清单与 --class 共用）。 */
const CLASSES = ['orphan-id', 'empty-session', 'untitled-session', 'encoded-id', 'ok']

/** ────────────────────────────── 参数解析 ─────────────────────────────── */

function parseArgs(argv) {
  const options = { command: 'list', flags: new Map() }
  const rest = [...argv]
  const command = rest[0]
  if (command !== undefined && !command.startsWith('--')) {
    options.command = command
    rest.shift()
  }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (!arg.startsWith('--')) throw new Error(`无法识别的参数：${arg}`)
    const key = arg.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      options.flags.set(key, true)
    } else {
      options.flags.set(key, next)
      i += 1
    }
  }
  return options
}

const args = parseArgs(process.argv.slice(2))
const flag = name => args.flags.get(name)
const has = name => args.flags.has(name)

function resolveDshHome() {
  const explicit = flag('dsh-home')
  if (typeof explicit === 'string' && explicit !== '') return resolve(explicit)
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env !== '') return resolve(env)
  return join(homedir(), '.dsh')
}

const DSH_HOME = resolveDshHome()
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
const STORAGE_DIR = join(DSH_HOME, 'storages')
const WORKSPACE_FILE = join(STORAGE_DIR, 'workspace.json')
const PROJ_CACHE_ROOT = join(STORAGE_DIR, 'session_projcache', 'sessions')
const TOOL_DIR = join(STORAGE_DIR, 'manage-session')
const PLAN_FILE = join(TOOL_DIR, 'purge-plan.json')
const LEDGER_FILE = join(TOOL_DIR, 'purge-ledger.jsonl')
/** 回收站根：每批一个目录，搬进来的会话目录与投影缓存保持原相对结构。 */
const TRASH_ROOT = join(DSH_HOME, 'trash', 'manage-session')
/** 二级压缩归档（`.tar.zst`）。 */
const TRASH_ARCHIVE_DIR = join(TRASH_ROOT, 'archive')

/** ─────────────────────────── id ↔ 目录名编码 ─────────────────────────── */

/**
 * 宿主目录名编码（`session-persistence-jsonl/src/format.ts::encodeSegment` 同构）：
 * 安全字符原样，其余（含 `~`）一律 `~XXXX`（UTF-16 码元大写十六进制）。
 */
function encodeSegment(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** 解码目录名为会话 id（`~` 在宿主编码里不可能字面出现，故可逆）。 */
function decodeSegment(name) {
  return name.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/** 一个 id 可能对应的所有目录名候选（带/不带编码，带/不带 `session-` 前缀）。 */
function dirNameCandidates(id) {
  const encoded = encodeSegment(id)
  return [...new Set([id, encoded, `session-${id}`, `session-${encoded}`])]
}

/** ───────────────────────────── 扫描会话盘 ────────────────────────────── */

function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function dirSize(dir) {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(path)
    else {
      try {
        total += statSync(path).size
      } catch { /* 竞态：刚被删 */ }
    }
  }
  return total
}

/** 扫一遍 `<dshHome>/sessions`：会话 id → { dir, workspaceDir }。 */
function indexSessions() {
  const byId = new Map()
  if (!existsSync(SESSIONS_ROOT)) return byId
  for (const workspace of readdirSync(SESSIONS_ROOT)) {
    const wsDir = join(SESSIONS_ROOT, workspace)
    if (!isDir(wsDir)) continue
    for (const name of readdirSync(wsDir)) {
      const dir = join(wsDir, name)
      if (!isDir(dir)) continue
      const id = name.startsWith('session-') ? name : decodeSegment(name)
      const existing = byId.get(id)
      // 同 id 两个目录：优先 `session-` 前缀那个（归档集合里的 id 本身带前缀）。
      if (existing === undefined || (name.startsWith('session-') && !existing.dir.endsWith(`session-${id}`))) {
        byId.set(id, { id, dir, workspaceDir: wsDir, dirName: name, encoded: name.includes('~') })
      }
    }
  }
  return byId
}

/** 读 workspace 文档（不存在时给空壳，绝不新建）。 */
function readWorkspaceDoc(path) {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8'))
}

function bookkeepingIds(doc) {
  const ids = new Set()
  for (const id of doc?.global?.archivedSessionIds ?? []) if (typeof id === 'string') ids.add(id)
  const workspaces = doc?.tables?.workspaces ?? {}
  for (const workspace of Object.values(workspaces)) {
    for (const id of workspace?.sessionIds ?? []) if (typeof id === 'string') ids.add(id)
  }
  return ids
}

/** ──────────────────────────── 会话标题/体量 ──────────────────────────── */

/** 扫 zstd 帧边界（与插件 `health/decode.ts::scanZstdFrames` 同构，撕裂即停）。 */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) return { frames, tornStart: start }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    if (buffer.length - offset < (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes) {
      return { frames, tornStart: start }
    }
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return { frames, tornStart: start }
      const payload = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payload) return { frames, tornStart: start }
      offset += payload
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** 当前代日志文件名（`session.v<N>.jsonl[.zstd]` 取最高代）。 */
function currentLogFile(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return undefined
  }
  const logs = entries
    .filter(name => /^session\.v\d+\.jsonl(\.zstd)?$/.test(name))
    .sort((a, b) => Number(/v(\d+)/.exec(b)?.[1] ?? 0) - Number(/v(\d+)/.exec(a)?.[1] ?? 0))
  return logs.length === 0 ? undefined : join(dir, logs[0])
}

/** 解压前 `limit` 帧并返回拼接文本（失败帧跳过，不抛）。 */
function decodeHead(file, limit) {
  let buffer
  try {
    buffer = readFileSync(file)
  } catch {
    return { text: '', frames: 0, bytes: 0 }
  }
  const { frames } = scanZstdFrames(buffer)
  let text = ''
  let used = 0
  for (const frame of frames) {
    if (used >= limit) break
    try {
      text += zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8')
      used += 1
    } catch { /* 单帧坏掉只跳过 */ }
  }
  return { text, frames: used, bytes: buffer.length }
}

function headerOf(text) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{') || !line.includes('"type":"session"')) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === 'session') return parsed
    } catch { /* 继续找 */ }
  }
  return undefined
}

function titleOf(text) {
  for (const line of text.split('\n')) {
    if (!line.includes('"session/title"')) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === 'session/title' && typeof parsed.data?.title === 'string' && parsed.data.title.trim() !== '') {
        return parsed.data.title
      }
    } catch { /* 继续找 */ }
  }
  return undefined
}

/** 投影缓存里的标题（宿主布局：文件名 = encodeSegment(id)）。 */
function cachedTitle(id) {
  for (const name of dirNameCandidates(id)) {
    const path = join(PROJ_CACHE_ROOT, `${name}.json`)
    if (!existsSync(path)) continue
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      const value = parsed?.record?.rows?.title?.val
      if (typeof value === 'string' && value.trim() !== '') return value
    } catch { /* 坏缓存当没有 */ }
  }
  return undefined
}

function cacheFileOf(id) {
  for (const name of dirNameCandidates(id)) {
    const path = join(PROJ_CACHE_ROOT, `${name}.json`)
    if (existsSync(path)) return path
  }
  return undefined
}

/** ─────────────────────────────── 清单构建 ─────────────────────────────── */

/**
 * 扫全量会话并分类。
 * @returns {{ items: object[], counts: Record<string, number>, totals: object }}
 */
function buildPlan() {
  const doc = readWorkspaceDoc(WORKSPACE_FILE)
  const archived = new Set(doc?.global?.archivedSessionIds ?? [])
  const onDisk = indexSessions()
  const items = []

  for (const [id, entry] of onDisk) {
    const logFile = currentLogFile(entry.dir)
    const { text, bytes } = logFile === undefined
      ? { text: '', bytes: 0 }
      : decodeHead(logFile, TITLE_MAX_FRAMES)
    const header = headerOf(text)
    const title = cachedTitle(id) ?? titleOf(text)
    // 只有小日志才整份解压数消息：大日志按“有内容”处理（不为了分类拖死脚本）。
    const hasMessage = text.includes('"user/message"')
      || (bytes > EMPTY_SESSION_MAX_BYTES && text.length > 0)
    const cacheFile = cacheFileOf(id)
    let klass = 'ok'
    if (entry.encoded) klass = 'encoded-id'
    else if (title === undefined && !hasMessage) klass = 'empty-session'
    else if (title === undefined) klass = 'untitled-session'
    items.push({
      id,
      class: klass,
      archived: archived.has(id),
      cwd: header?.cwd ?? '',
      createdAt: header?.createdAt ?? 0,
      title: title ?? '',
      bytes,
      cacheBytes: cacheFile === undefined ? 0 : (() => { try { return statSync(cacheFile).size } catch { return 0 } })(),
      dir: entry.dir,
      dirName: entry.dirName,
      logFile: logFile ?? '',
    })
  }

  // 记账里有、磁盘上没有的 id：真正的“幽灵 uuid”（删了文件但记账没清）。
  for (const id of bookkeepingIds(doc)) {
    if (onDisk.has(id)) continue
    items.push({
      id,
      class: 'orphan-id',
      archived: archived.has(id),
      cwd: '',
      createdAt: 0,
      title: '',
      bytes: 0,
      cacheBytes: 0,
      dir: '',
      dirName: '',
      logFile: '',
    })
  }

  items.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id))
  const counts = Object.fromEntries(CLASSES.map(name => [name, 0]))
  for (const item of items) counts[item.class] += 1
  const totals = {
    sessions: onDisk.size,
    items: items.length,
    bytes: items.reduce((sum, item) => sum + item.bytes + item.cacheBytes, 0),
    archived: items.filter(item => item.archived).length,
  }
  return { items, counts, totals }
}

function formatDate(ms) {
  if (!ms) return '—'
  const date = new Date(ms)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function writePlan(plan) {
  mkdirSync(TOOL_DIR, { recursive: true })
  const payload = {
    dshHome: DSH_HOME,
    generatedAt: new Date().toISOString(),
    counts: plan.counts,
    totals: plan.totals,
    items: plan.items,
  }
  writeFileSync(PLAN_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  return PLAN_FILE
}

function printPlan(plan) {
  const { items, counts, totals } = plan
  console.log(`dshHome: ${DSH_HOME}`)
  console.log(`会话 ${totals.sessions} 个（清单 ${totals.items} 行，已归档 ${totals.archived}，占用 ${formatBytes(totals.bytes)}）`)
  console.log(`分类：${CLASSES.map(name => `${name}=${counts[name] ?? 0}`).join('  ')}`)
  if (items.length === 0) return
  console.log('')
  console.log(['class', 'id', 'cwd', 'created', 'size', 'arch', 'title'].join('\t'))
  for (const item of items) {
    console.log([
      item.class,
      item.id,
      item.cwd || '—',
      formatDate(item.createdAt),
      formatBytes(item.bytes + item.cacheBytes),
      item.archived ? 'Y' : '',
      item.title || '—',
    ].join('\t'))
  }
  console.log('')
  const batches = trashBatches()
  const archives = trashArchives()
  if (batches.length > 0 || archives.length > 0) {
    console.log(`回收站：${batches.length} 批未压缩（${formatBytes(batches.reduce((sum, item) => sum + item.bytes, 0))}），`
      + `${archives.length} 个 .tar.zst（${formatBytes(archives.reduce((sum, item) => sum + item.bytes, 0))}）`)
    for (const batch of batches.slice(-5)) console.log(`  未压缩批次 ${batch.batch}（${formatBytes(batch.bytes)}）`)
  }
  console.log('提示：archive（侧栏立即不可见）→ 复核 → 退出 DSH → trash（搬回收站）→ compact（定期压缩）')
}

/** ───────────────────────────── workspace.json ────────────────────────── */

/** 原子改写 workspace.json（先备份，再 temp+rename；失败不动原文件）。 */
function editWorkspace(mutator) {
  const doc = readWorkspaceDoc(WORKSPACE_FILE)
  if (doc === undefined) throw new Error(`workspace 存储文件不存在：${WORKSPACE_FILE}`)
  const backup = `${WORKSPACE_FILE}.bak-${Date.now()}`
  copyFileSync(WORKSPACE_FILE, backup)
  const changed = mutator(doc)
  if (changed === false) return { changed: false, backup }
  const temp = `${WORKSPACE_FILE}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`)
  // rename 覆盖在 Windows 上不是原子的，但“先备份 + 单次写入”已足够可回滚。
  writeFileSync(WORKSPACE_FILE, readFileSync(temp))
  rmSync(temp, { force: true })
  return { changed: true, backup }
}

/** ───────────────────────────── 宿主在跑？ ────────────────────────────── */

function dshProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      return out.split(/\r?\n/)
        .map(line => line.split('","')[0]?.replace(/^"/, '') ?? '')
        .filter(name => /deepseek-harness|dsh-desktop|DSH\.exe|dsh-host|deepseek desktop/i.test(name))
    }
    const out = execFileSync('ps', ['-eo', 'comm='], { encoding: 'utf8' })
    return out.split('\n').map(line => line.trim())
      .filter(name => /deepseek-harness|dsh-desktop|dsh-host|^dsh$/i.test(name))
  } catch {
    return []
  }
}

function assertHostClosed() {
  if (has('allow-running')) {
    console.warn('⚠ --allow-running：宿主可能在运行，删除后侧栏可能残留到重启为止。')
    return
  }
  const running = dshProcesses()
  if (running.length === 0) return
  throw new Error(
    `检测到宿主进程（${[...new Set(running)].join(', ')}）正在运行。\n`
    + '请先完全退出 DSH Desktop 再运行 purge（list 不受限制）。\n'
    + '确知风险时可用 --allow-running 跳过本检查。',
  )
}

/** ─────────────────────────────── 参数选择 ────────────────────────────── */

/** 从 `--ids` / `--class` / `--plan` 解析出目标 id（保持输入顺序，去重）。 */
function selectIds(plan) {
  const ids = []
  const raw = flag('ids')
  if (typeof raw === 'string' && raw !== '') ids.push(...raw.split(',').map(id => id.trim()).filter(Boolean))
  const klass = flag('class')
  if (typeof klass === 'string' && klass !== '') {
    if (!CLASSES.includes(klass)) throw new Error(`--class 只能是：${CLASSES.join(' / ')}`)
    const byClass = plan.items.filter(item => item.class === klass).map(item => item.id)
    if (byClass.length === 0) throw new Error(`清单里没有 ${klass} 类的会话`)
    ids.push(...byClass)
  }
  const planPath = flag('plan')
  if (typeof planPath === 'string' && planPath !== '') {
    const parsed = JSON.parse(readFileSync(resolve(planPath), 'utf8'))
    const planned = (parsed.items ?? []).filter(item => item.class !== 'ok').map(item => item.id)
    if (planned.length === 0) throw new Error(`${planPath} 里没有可清理条目`)
    ids.push(...planned)
  }
  const unique = [...new Set(ids)]
  if (unique.length === 0) throw new Error('没有选中任何会话：用 --ids、--class 或 --plan 指定')
  for (const id of unique) {
    if (id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
      throw new Error(`非法会话 id：${id}`)
    }
  }
  return unique
}

/** ─────────────────────────────── archive ─────────────────────────────── */

function runArchive(plan, ids) {
  const onDisk = indexSessions()
  const unknown = ids.filter(id => !onDisk.has(id) && !plan.items.some(item => item.id === id))
  if (unknown.length > 0) console.warn(`⚠ 不认识（未在盘上、也不在清单里）：${unknown.join(', ')}`)
  const outcome = editWorkspace((doc) => {
    doc.global = doc.global ?? {}
    const current = Array.isArray(doc.global.archivedSessionIds) ? doc.global.archivedSessionIds : []
    const merged = [...new Set([...current, ...ids])].sort()
    if (merged.length === current.length) return false
    doc.global.archivedSessionIds = merged
    return true
  })
  // 复核：重读文件确认每条都在归档集合里（“确认处于归档后再删”）。
  const after = readWorkspaceDoc(WORKSPACE_FILE)
  const archivedNow = new Set(after?.global?.archivedSessionIds ?? [])
  const missing = ids.filter(id => !archivedNow.has(id))
  if (missing.length > 0) throw new Error(`归档复核失败，以下 id 不在归档集合里：${missing.join(', ')}`)
  console.log(`已归档 ${ids.length} 条${outcome.changed ? '' : '（原本就在归档集合里）'}；备份：${outcome.backup}`)
  console.log(`复核通过：${ids.join(', ')}`)
  console.log('下一步：确认侧栏/管理台里这些会话已归入“归档”，再完全退出 DSH 后运行 purge。')
}

/** ─────────────────── 回收站 / 二级压缩 / 恢复 / 记账 ─────────────────── */

function isSafeChild(root, target, depth) {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '' || rel.startsWith('..') || resolve(root, rel) !== resolve(target)) return false
  return rel.split(sep).filter(part => part !== '').length === depth
}

function appendLedger(entries) {
  if (entries.length === 0) return
  mkdirSync(TOOL_DIR, { recursive: true })
  const lines = entries.map(entry => JSON.stringify(entry)).join('\n')
  writeFileSync(LEDGER_FILE, `${lines}\n`, { flag: 'a' })
}

/** 时间戳（批次名与恢复目录后缀共用，本地时区、精确到秒）。 */
function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 批次名：时间戳 + 选中集合短指纹（同批可复现、不同批不撞）。 */
function batchNameFor(ids) {
  const digest = createHash('sha1').update([...ids].sort().join('\n')).digest('hex').slice(0, 6)
  return `${stamp()}-${digest}`
}

function copyTree(from, to) {
  const info = statSync(from)
  if (info.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) copyTree(join(from, name), join(to, name))
    return
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

/** 搬运：同盘 rename；跨盘 copy+rm（目标父目录自动创建）。 */
function movePath(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err
    copyTree(from, to)
    rmSync(from, { recursive: true, force: true })
  }
}

/** 从记账（归档集合 + 工作区成员表）里摘掉 uuid —— 幽灵编号就在这里清。 */
function dropBookkeeping(ids) {
  const wanted = new Set(ids)
  return editWorkspace((doc) => {
    let changed = false
    const global = doc.global ?? {}
    if (Array.isArray(global.archivedSessionIds)) {
      const kept = global.archivedSessionIds.filter(id => !wanted.has(id))
      if (kept.length !== global.archivedSessionIds.length) {
        doc.global = { ...global, archivedSessionIds: kept }
        changed = true
      }
    }
    const workspaces = doc.tables?.workspaces
    if (workspaces !== undefined) {
      for (const [key, workspace] of Object.entries(workspaces)) {
        if (!Array.isArray(workspace?.sessionIds)) continue
        const kept = workspace.sessionIds.filter(id => !wanted.has(id))
        if (kept.length !== workspace.sessionIds.length) {
          workspaces[key] = { ...workspace, sessionIds: kept }
          changed = true
        }
      }
    }
    return changed
  })
}

/** 恢复时重新挂回归档集合（工作区成员按 cwd 兜底），避免还原后直接冒到侧栏。 */
function restoreBookkeeping(ids, cwdById) {
  const wanted = [...new Set(ids)].sort()
  if (wanted.length === 0) return
  editWorkspace((doc) => {
    let changed = false
    doc.global = doc.global ?? {}
    const current = Array.isArray(doc.global.archivedSessionIds) ? doc.global.archivedSessionIds : []
    const merged = [...new Set([...current, ...wanted])].sort()
    if (merged.length !== current.length) {
      doc.global.archivedSessionIds = merged
      changed = true
    }
    const workspaces = doc.tables?.workspaces
    if (workspaces !== undefined) {
      for (const [key, workspace] of Object.entries(workspaces)) {
        if (!Array.isArray(workspace?.sessionIds) || typeof workspace?.path !== 'string') continue
        const additions = wanted.filter(id => cwdById.get(id) === workspace.path && !workspace.sessionIds.includes(id))
        if (additions.length === 0) continue
        workspaces[key] = { ...workspace, sessionIds: [...workspace.sessionIds, ...additions] }
        changed = true
      }
    }
    return changed
  })
}

/** ────────────────────────────── tar(.zst) ────────────────────────────── */

/** ustar 名字切分：短名 ≤100 字节，长路径拆 prefix（≤155 字节）。 */
function splitTarName(name) {
  if (Buffer.byteLength(name) <= 100) return { shortName: name, prefix: '' }
  const parts = name.split('/')
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const shortName = parts.slice(i).join('/')
    const prefix = parts.slice(0, i).join('/')
    if (Buffer.byteLength(shortName) <= 100 && Buffer.byteLength(prefix) <= 155) return { shortName, prefix }
  }
  return undefined
}

function octalField(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`
}

function tarHeader(name, size, type) {
  const split = splitTarName(name)
  if (split === undefined) throw new Error(`tar 路径过长，拒绝打包：${name}`)
  const header = Buffer.alloc(512)
  header.write(split.shortName, 0, 100, 'utf8')
  header.write(octalField(0o644, 8), 100, 8, 'ascii')
  header.write(octalField(0, 8), 108, 8, 'ascii')
  header.write(octalField(0, 8), 116, 8, 'ascii')
  header.write(octalField(size, 12), 124, 12, 'ascii')
  header.write(octalField(0, 12), 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write(type, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write(split.prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

/** 递归列出目录下全部条目（目录带尾 `/`，便于恢复时重建层级）。 */
function walkFiles(root, base = '') {
  const out = []
  const dir = base === '' ? root : join(root, ...base.split('/'))
  for (const name of readdirSync(dir).sort()) {
    const rel = base === '' ? name : `${base}/${name}`
    const abs = join(dir, name)
    if (isDir(abs)) {
      out.push({ name: `${rel}/`, type: '5', size: 0, path: '' })
      out.push(...walkFiles(root, rel))
    } else {
      out.push({ name: rel, type: '0', size: statSync(abs).size, path: abs })
    }
  }
  return out
}

/** 把一棵目录树读进内存（`name → content`，目录隐式由前缀重建）。 */
function readTreeInto(files, root, prefix) {
  for (const entry of walkFiles(root)) {
    if (entry.type === '5') continue
    files.set(`${prefix}/${entry.name}`, readFileSync(entry.path))
  }
}

/** 把内存文件表 + manifest 打成一个 zstd 压缩的 ustar（标准格式，7-Zip 可解）。 */
function packFromFiles(files, manifest) {
  const chunks = []
  const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  chunks.push(tarHeader('manifest.json', manifestData.length, '0'), manifestData, Buffer.alloc((512 - (manifestData.length % 512)) % 512))
  for (const name of [...files.keys()].sort()) {
    const data = files.get(name)
    chunks.push(tarHeader(name, data.length, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  chunks.push(Buffer.alloc(1024))
  return zlib.zstdCompressSync(Buffer.concat(chunks))
}

/** 读回自制 ustar（只取普通文件；目录条目按前缀重建）。 */
function readTar(buffer) {
  const files = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const shortName = header.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0[\s\S]*$/, '')
    const name = prefix === '' ? shortName : `${prefix}/${shortName}`
    const sizeRaw = header.subarray(124, 136).toString('ascii').replace(/\0[\s\S]*$/, '').trim()
    const size = sizeRaw === '' ? 0 : parseInt(sizeRaw, 8)
    const type = header.subarray(156, 157).toString('ascii')
    offset += 512
    const padded = Math.ceil(size / 512) * 512
    if ((type === '0' || type === '\0' || type === '') && !name.endsWith('/')) {
      files.set(name, buffer.subarray(offset, offset + size))
    }
    offset += padded
  }
  return files
}

/** 批次名去重：同秒同名同选集合也不撞（追加序号）。 */
function uniqueBatchName(base) {
  let candidate = base
  let index = 1
  while (existsSync(join(TRASH_ROOT, candidate)) || existsSync(join(TRASH_ARCHIVE_DIR, `${candidate}.tar.zst`))) {
    index += 1
    candidate = `${base}-${index}`
  }
  return candidate
}

/** 统一成 tar 内部的分隔符（Windows 的 `\` 必须换成 `/`，否则归档内找不到）。 */
function toTarPath(value) {
  return value.split('\\').join('/')
}

/** 从 tar 内容重建一棵子树到 `targetAbs`（`prefix` 为 tar 内的相对目录）。 */
function restoreTreeFromTar(files, targetAbs, prefix) {
  const normPrefix = toTarPath(prefix)
  let count = 0
  for (const [name, data] of files) {
    if (!name.startsWith(`${normPrefix}/`)) continue
    const rel = name.slice(normPrefix.length + 1)
    if (rel === '') continue
    const out = join(targetAbs, ...rel.split('/'))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, data)
    count += 1
  }
  if (count === 0) throw new Error(`归档里没有 ${normPrefix} 的文件`)
}

function restoreFileFromTar(files, targetAbs, name) {
  const data = files.get(toTarPath(name))
  if (data === undefined) throw new Error(`归档里没有 ${name}`)
  mkdirSync(dirname(targetAbs), { recursive: true })
  writeFileSync(targetAbs, data)
}

/** ───────────────────────────── 回收站现状 ────────────────────────────── */

function trashBatches() {
  if (!existsSync(TRASH_ROOT)) return []
  return readdirSync(TRASH_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => {
      const dir = join(TRASH_ROOT, entry.name)
      let manifest
      try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch { manifest = undefined }
      const createdAt = typeof manifest?.createdAt === 'string' ? manifest.createdAt : ''
      return { batch: entry.name, dir, manifest, bytes: dirSize(dir), createdAt }
    })
    .sort((a, b) => a.batch.localeCompare(b.batch))
}

function trashArchives() {
  if (!existsSync(TRASH_ARCHIVE_DIR)) return []
  return readdirSync(TRASH_ARCHIVE_DIR)
    .filter(name => name.endsWith('.tar.zst'))
    .sort()
    .map((name) => {
      const path = join(TRASH_ARCHIVE_DIR, name)
      let bytes = 0
      try { bytes = statSync(path).size } catch { /* 竞态 */ }
      return { name, path, bytes }
    })
}

/** ─────────────────────────────── trash ──────────────────────────────── */

/**
 * 回收站（默认的“删除”动作）：先确认已归档，再把会话目录 + 投影缓存整段搬进
 * `<dshHome>/trash/manage-session/<batch>/`，最后从记账里摘掉 uuid。
 * 文件一个都不删，`restore` 可原样搬回。
 */
function runTrash(plan, ids) {
  assertHostClosed()
  const doc = readWorkspaceDoc(WORKSPACE_FILE)
  const archivedNow = new Set(doc?.global?.archivedSessionIds ?? [])
  const notArchived = ids.filter(id => !archivedNow.has(id))
  if (notArchived.length > 0) {
    if (!has('archive-first')) {
      throw new Error(`拒绝搬动未归档的会话（先跑 archive，或加 --archive-first 让本步先归档并复核）：${notArchived.join(', ')}`)
    }
    runArchive(plan, notArchived)
  }

  const onDisk = indexSessions()
  const batch = uniqueBatchName(batchNameFor(ids))
  const batchDir = join(TRASH_ROOT, batch)
  const manifest = { batch, createdAt: new Date().toISOString(), dshHome: DSH_HOME, items: [] }
  const ledger = []
  const failures = []
  let moved = 0
  let bytes = 0
  for (const id of [...ids].sort()) {
    const entry = onDisk.get(id)
    const item = plan.items.find(candidate => candidate.id === id)
    if (entry === undefined) {
      // 幽灵 uuid：盘上没有实体可搬，只要摘记账（幂等可重跑）。
      ledger.push({
        ts: new Date().toISOString(), phase: 'bookkeeping-only', batch, id,
        cwd: item?.cwd ?? '', createdAt: item?.createdAt ?? 0, bytes: 0, cacheBytes: 0,
        from: '', to: '', cacheFrom: '', cacheTo: '',
      })
      continue
    }
    if (!isSafeChild(SESSIONS_ROOT, entry.dir, 2)) {
      failures.push({ id, reason: `拒绝搬动越界路径：${entry.dir}` })
      continue
    }
    const relDir = relative(DSH_HOME, entry.dir)
    const trashDir = join(batchDir, relDir)
    const cacheFile = cacheFileOf(id)
    const relCache = cacheFile === undefined ? '' : relative(DSH_HOME, cacheFile)
    const trashCache = cacheFile === undefined ? '' : join(batchDir, relCache)
    try {
      if (has('dry-run')) {
        console.log(`[dry-run] would move ${entry.dir} → ${trashDir}`)
        continue
      }
      if (existsSync(trashDir)) throw new Error(`回收站目标已存在：${trashDir}`)
      if (cacheFile !== undefined && !isSafeChild(PROJ_CACHE_ROOT, cacheFile, 1)) {
        throw new Error(`拒绝搬动越界缓存：${cacheFile}`)
      }
      const dirBytes = dirSize(entry.dir)
      let cacheBytes = 0
      movePath(entry.dir, trashDir)
      if (cacheFile !== undefined) {
        try { cacheBytes = statSync(cacheFile).size } catch { /* 竞态 */ }
        movePath(cacheFile, trashCache)
      }
      moved += 1
      bytes += dirBytes + cacheBytes
      manifest.items.push({
        id, cwd: item?.cwd ?? '', createdAt: item?.createdAt ?? 0, title: item?.title ?? '',
        bytes: dirBytes, cacheBytes, from: relDir, to: relative(DSH_HOME, trashDir),
        cacheFrom: relCache, cacheTo: relCache === '' ? '' : relative(DSH_HOME, trashCache),
      })
      ledger.push({
        ts: new Date().toISOString(), phase: 'trashed', batch, id,
        cwd: item?.cwd ?? '', createdAt: item?.createdAt ?? 0, bytes: dirBytes, cacheBytes,
        from: entry.dir, to: trashDir, cacheFrom: cacheFile ?? '', cacheTo: trashCache,
      })
    } catch (err) {
      failures.push({ id, reason: String(err instanceof Error ? err.message : err) })
    }
  }

  if (has('dry-run')) {
    console.log(`[dry-run] 选中 ${ids.length} 条；未搬动任何文件，未写记账。`)
    return
  }
  if (moved === 0 && ledger.length === 0) {
    console.log('没有可搬动的条目')
    return
  }
  if (manifest.items.length > 0) {
    mkdirSync(batchDir, { recursive: true })
    writeFileSync(join(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }
  // 记账清理放在搬运之后：中途失败时归档标记仍在，可 restore / 重跑。
  const removedIds = new Set([
    ...manifest.items.map(item => item.id),
    ...ledger.filter(entry => entry.phase === 'bookkeeping-only').map(entry => entry.id),
  ])
  if (removedIds.size > 0) dropBookkeeping([...removedIds])
  appendLedger(ledger)
  console.log(`已搬入回收站 ${moved} 条（${formatBytes(bytes)}），记账清理 ${removedIds.size} 条；失败 ${failures.length} 条`)
  if (moved > 0) {
    console.log(`批次：${batch}`)
    console.log(`  还原：node scripts/session-purge.mjs restore --batch ${batch}`)
    console.log(`  压缩：node scripts/session-purge.mjs compact --older-than 7`)
  }
  console.log(`台账（uuid 列表）：${LEDGER_FILE}`)
  for (const failure of failures) console.log(`  ✗ ${failure.id}: ${failure.reason}`)
  if (failures.length > 0) process.exitCode = 1
}


/** ─────────────────────────────── compact ────────────────────────────── */

/** 周期键（`--window`）：day → `2026-11-25`，week → `2026-W48`，month → `2026-11`。 */
function windowKeyOf(date, window) {
  const pad = value => String(value).padStart(2, '0')
  if (window === 'month') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
  if (window === 'day') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  // ISO 周：本周四所在的年 + 周序。
  const probe = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = probe.getUTCDay() || 7
  probe.setUTCDate(probe.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(probe.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((probe - yearStart) / 86400000 + 1) / 7)
  return `${probe.getUTCFullYear()}-W${pad(week)}`
}

/**
 * 二级压缩归档（按周期）：把到期回收站批次**合并重压**成一个 `archive/<周期>.tar.zst`，
 * 然后把“可直接恢复”的散目录整批清空（还原从此走 `restore --archive <周期>`）。
 *
 * - `--window week|day|month|all`：合并粒度（缺省 week）。
 * - `--older-than N`：只处理回收超过 N 天的批次（缺省 7）。
 * - 同一周期反复跑会**合并进现有归档**（先解旧归档再重写），不会一个周期长出多个文件。
 */
function runCompact() {
  assertHostClosed()
  const olderThan = Number(flag('older-than') ?? 7)
  if (!Number.isFinite(olderThan) || olderThan < 0) throw new Error('--older-than 需要非负天数')
  const window = String(flag('window') ?? 'week')
  if (!['day', 'week', 'month', 'all'].includes(window)) {
    throw new Error('--window 只能是 day / week / month / all')
  }
  const batches = trashBatches()
  if (batches.length === 0) {
    console.log('回收站是空的，无需压缩')
    return
  }
  const cutoff = Date.now() - olderThan * 86400000
  const groups = new Map()
  for (const batch of batches) {
    const parsed = Date.parse(batch.createdAt)
    const created = Number.isFinite(parsed)
      ? parsed
      : (() => { try { return statSync(batch.dir).mtimeMs } catch { return Date.now() } })()
    if (created > cutoff) {
      console.log(`跳过 ${batch.batch}（未到 ${olderThan} 天）`)
      continue
    }
    const key = window === 'all' ? 'all' : windowKeyOf(new Date(created), window)
    const list = groups.get(key) ?? []
    list.push(batch)
    groups.set(key, list)
  }
  if (groups.size === 0) {
    console.log('没有到期的批次')
    return
  }
  if (has('dry-run')) {
    for (const [key, list] of groups) {
      console.log(`[dry-run] would pack ${list.length} 批 → ${key}.tar.zst（${formatBytes(list.reduce((sum, batch) => sum + batch.bytes, 0))}）`)
    }
    return
  }
  mkdirSync(TRASH_ARCHIVE_DIR, { recursive: true })
  const ledger = []
  let packedBatches = 0
  let freed = 0
  for (const [key, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const archivePath = join(TRASH_ARCHIVE_DIR, `${key}.tar.zst`)
    const files = new Map()
    let manifest = { archive: key, window, createdAt: new Date().toISOString(), batches: [], items: [] }
    // 同周期已有归档：先解出来再合并（“重新压缩放好”，而不是一周多个包）。
    if (existsSync(archivePath)) {
      const existing = readTar(zlib.zstdDecompressSync(readFileSync(archivePath)))
      const raw = existing.get('manifest.json')
      if (raw !== undefined) manifest = JSON.parse(raw.toString('utf8'))
      for (const [name, data] of existing) {
        if (name !== 'manifest.json') files.set(name, data)
      }
    }
    for (const batch of list) {
      // 还原过的批次只剩空壳 manifest（条目已被搬回）：直接清掉，不把空条目带进归档。
      if ((batch.manifest?.items ?? []).length === 0) {
        rmSync(batch.dir, { recursive: true, force: true })
        continue
      }
      readTreeInto(files, batch.dir, `batches/${batch.batch}`)
      manifest.batches = [...new Set([...(manifest.batches ?? []), batch.batch])].sort()
      for (const item of batch.manifest?.items ?? []) manifest.items.push({ ...item, batch: batch.batch })
      packedBatches += 1
    }
    manifest.items.sort((a, b) => String(a.batch).localeCompare(String(b.batch)) || String(a.id).localeCompare(String(b.id)))
    const output = packFromFiles(files, manifest)
    writeFileSync(archivePath, output)
    const sha256 = createHash('sha256').update(output).digest('hex')
    ledger.push({
      ts: new Date().toISOString(), phase: 'compacted', window, archive: key, path: archivePath,
      sha256, bytes: output.length, batches: manifest.batches, ids: manifest.items.map(item => item.id),
    })
    // “可直接恢复的散目录”此刻清空：之后只能走归档还原。
    for (const batch of list) {
      freed += batch.bytes
      rmSync(batch.dir, { recursive: true, force: true })
    }
    console.log(`已合并 ${list.length} 批 → ${archivePath}（${formatBytes(output.length)}，sha256 ${sha256.slice(0, 12)}…）`)
  }
  appendLedger(ledger)
  console.log(`共压缩 ${packedBatches} 批到 ${groups.size} 个周期归档，释放 ${formatBytes(freed)}`)
  console.log('可直接恢复的散目录已清空；还原用 restore --archive <周期> [--ids ...]')
  console.log(`台账：${LEDGER_FILE}`)
}

/** ─────────────────────────────── restore ────────────────────────────── */

/**
 * 从回收站还原：默认还原散批次目录，压缩后走 `--archive <周期>` 从 `.tar.zst` 还原。
 * `--ids` 可只还原周期归档里的某几条（按 uuid）。
 */
function runRestore() {
  const batchFlag = flag('batch')
  const archiveFlag = flag('archive')
  const batch = typeof batchFlag === 'string' && batchFlag !== '' ? batchFlag : undefined
  const archiveKey = typeof archiveFlag === 'string' && archiveFlag !== '' ? archiveFlag : undefined
  if (batch === undefined && archiveKey === undefined) {
    throw new Error('restore 需要 --batch <批次>（散目录，未压缩）或 --archive <周期>（已压缩）')
  }
  assertHostClosed()
  const idsFlag = flag('ids')
  const onlyIds = typeof idsFlag === 'string' && idsFlag !== ''
    ? new Set(idsFlag.split(',').map(id => id.trim()).filter(Boolean))
    : undefined

  const expandedDir = batch === undefined ? undefined : join(TRASH_ROOT, batch)
  const archivePath = join(TRASH_ARCHIVE_DIR, `${archiveKey ?? batch}.tar.zst`)
  let manifest
  let files
  let fromArchive = false
  if (expandedDir !== undefined && existsSync(expandedDir)) {
    try { manifest = JSON.parse(readFileSync(join(expandedDir, 'manifest.json'), 'utf8')) } catch { manifest = undefined }
  } else if (existsSync(archivePath)) {
    const tar = readTar(zlib.zstdDecompressSync(readFileSync(archivePath)))
    const manifestBuf = tar.get('manifest.json')
    if (manifestBuf === undefined) throw new Error(`归档里没有 manifest.json：${archivePath}`)
    manifest = JSON.parse(manifestBuf.toString('utf8'))
    files = tar
    fromArchive = true
  } else {
    throw new Error(`找不到批次/周期：${archiveKey ?? batch}（既不在 ${TRASH_ROOT}，也没有 ${archivePath}）`)
  }
  if (manifest === undefined) throw new Error(`批次 ${archiveKey ?? batch} 缺 manifest.json，拒绝盲搬`)

  // 周期归档的布局是 `batches/<批次>/<原相对路径>`；单批旧归档仍是原相对路径。
  const isPeriod = typeof manifest.archive === 'string'
  const treePrefix = item => (isPeriod ? `batches/${item.batch}/${item.from}` : item.from)
  const cachePrefix = item => (isPeriod ? `batches/${item.batch}/${item.cacheFrom}` : item.cacheFrom)

  const restored = []
  const cwdById = new Map()
  const failures = []
  const ledger = []
  for (const item of manifest.items ?? []) {
    if (onlyIds !== undefined && !onlyIds.has(item.id)) continue
    if (batch !== undefined && isPeriod && item.batch !== batch) continue
    const target = resolve(DSH_HOME, item.from)
    const cacheTarget = item.cacheFrom === '' ? '' : resolve(DSH_HOME, item.cacheFrom)
    try {
      if (existsSync(target)) throw new Error(`原路径已存在，拒绝覆盖：${target}`)
      if (has('dry-run')) {
        console.log(`[dry-run] would restore ${item.id} → ${target}`)
        continue
      }
      if (fromArchive) {
        restoreTreeFromTar(files, target, treePrefix(item))
        if (cacheTarget !== '') restoreFileFromTar(files, cacheTarget, cachePrefix(item))
      } else {
        // manifest 里的 to/cacheTo 是相对 dshHome 的路径（与批次目录同根），不得再拼 dir。
        movePath(resolve(DSH_HOME, item.to), target)
        if (cacheTarget !== '') movePath(resolve(DSH_HOME, item.cacheTo), cacheTarget)
      }
      restored.push(item.id)
      cwdById.set(item.id, item.cwd ?? '')
      ledger.push({
        ts: new Date().toISOString(), phase: 'restored',
        batch: item.batch ?? batch, archive: isPeriod ? manifest.archive : undefined, id: item.id,
        cwd: item.cwd ?? '', createdAt: item.createdAt ?? 0,
        bytes: item.bytes ?? 0, cacheBytes: item.cacheBytes ?? 0, target,
      })
    } catch (err) {
      failures.push({ id: item.id, reason: String(err instanceof Error ? err.message : err) })
    }
  }
  if (has('dry-run')) {
    console.log(`[dry-run] ${archiveKey ?? batch}；未搬回任何文件。`)
    return
  }
  // 从散目录还原后，批次清单要跟着缩（否则 compact 会把已还原的条目当成还在，
  // 归档里只有 manifest 没有文件）。全还原完就把空壳批次一并删掉。
  if (!fromArchive && expandedDir !== undefined && restored.length > 0) {
    try {
      const restoredSet = new Set(restored)
      const remaining = (manifest.items ?? []).filter(item => !restoredSet.has(item.id))
      if (remaining.length === 0) rmSync(expandedDir, { recursive: true, force: true })
      else writeFileSync(join(expandedDir, 'manifest.json'), `${JSON.stringify({ ...manifest, items: remaining }, null, 2)}\n`)
    } catch (err) {
      console.log(`  ! 批次清单更新失败（下次 compact 会跳过空条目）：${String(err instanceof Error ? err.message : err)}`)
    }
  }
  if (restored.length > 0) restoreBookkeeping(restored, cwdById)
  appendLedger(ledger)
  console.log(`已从 ${fromArchive ? archivePath : expandedDir} 还原 ${restored.length} 条（已重新挂入归档集合）`)
  for (const failure of failures) console.log(`  ✗ ${failure.id}: ${failure.reason}`)
  if (failures.length > 0) process.exitCode = 1
}

/** ──────────────────────────────── purge ─────────────────────────────── */

/**
 * 只清“幽灵编号”：记账里有、盘上已经没有实体。
 * 有实体的会话不允许走这里 —— 请用 trash（回收站可恢复）。
 */
function runPurge(plan, ids) {
  const onDisk = indexSessions()
  const withFiles = ids.filter(id => onDisk.has(id))
  if (withFiles.length > 0) {
    throw new Error(`这些会话还有磁盘实体，请用 trash（可恢复）：${withFiles.join(', ')}`)
  }
  assertHostClosed()
  dropBookkeeping(ids)
  appendLedger(ids.map((id) => {
    const item = plan.items.find(candidate => candidate.id === id)
    return {
      ts: new Date().toISOString(), phase: 'bookkeeping-only', id,
      cwd: item?.cwd ?? '', createdAt: item?.createdAt ?? 0, bytes: 0, cacheBytes: 0,
    }
  }))
  console.log(`已从记账里摘除 ${ids.length} 条幽灵 uuid（无实体可搬）`)
}

/** 永久销毁一个回收站批次（散目录或已压缩包）——不可恢复，需显式 --yes。 */
function destroyBatch(batch) {
  if (!has('yes')) throw new Error('永久销毁不可恢复：确认后加 --yes')
  assertHostClosed()
  const targets = [join(TRASH_ROOT, batch), join(TRASH_ARCHIVE_DIR, `${batch}.tar.zst`)]
    .filter(path => existsSync(path))
  if (targets.length === 0) throw new Error(`找不到批次：${batch}`)
  for (const target of targets) rmSync(target, { recursive: true, force: true })
  appendLedger([{ ts: new Date().toISOString(), phase: 'destroyed', batch, targets }])
  console.log(`已永久销毁批次 ${batch}`)
}

/** ──────────────────────────────── ledger ─────────────────────────────── */

function printLedger() {
  if (!existsSync(LEDGER_FILE)) {
    console.log(`还没有清理记录：${LEDGER_FILE}`)
    return
  }
  const lines = readFileSync(LEDGER_FILE, 'utf8').split('\n').filter(Boolean)
  console.log(`清理记录 ${lines.length} 条（${LEDGER_FILE}）`)
  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    console.log([entry.ts, entry.phase, entry.id, entry.cwd || '—',
      formatBytes((entry.bytes ?? 0) + (entry.cacheBytes ?? 0))].join('\t'))
  }
}

/** ──────────────────────────────── 主流程 ─────────────────────────────── */

function main() {
  if (!existsSync(SESSIONS_ROOT)) {
    throw new Error(`会话根目录不存在：${SESSIONS_ROOT}（用 --dsh-home 指定 DSH 主目录）`)
  }
  const plan = buildPlan()
  if (args.command === 'list') {
    const path = writePlan(plan)
    if (has('json')) console.log(JSON.stringify({ dshHome: DSH_HOME, counts: plan.counts, totals: plan.totals, items: plan.items }, null, 2))
    else printPlan(plan)
    if (!has('json')) console.log(`清单已写入：${path}`)
    return
  }
  if (args.command === 'archive') {
    runArchive(plan, selectIds(plan))
    return
  }
  if (args.command === 'trash') {
    runTrash(plan, selectIds(plan))
    return
  }
  if (args.command === 'compact') {
    runCompact()
    return
  }
  if (args.command === 'restore') {
    runRestore()
    return
  }
  if (args.command === 'purge') {
    // 只处理幽灵编号；`purge --batch <名> --yes` 才是永久销毁回收站批次。
    const batch = flag('batch')
    if (typeof batch === 'string' && batch !== '') {
      destroyBatch(batch)
      return
    }
    runPurge(plan, selectIds(plan))
    return
  }
  if (args.command === 'ledger') {
    printLedger()
    return
  }
  throw new Error(`未知子命令：${args.command}（list / archive / trash / compact / restore / purge / ledger）`)
}

try {
  main()
} catch (err) {
  console.error(`✗ ${String(err instanceof Error ? err.message : err)}`)
  process.exitCode = 1
}