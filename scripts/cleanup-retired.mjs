#!/usr/bin/env node
/**
 * 退场会话残骸清理（drsc-redact-memory-wiring 姊妹功能，2026-10-20 用户定标）。
 *
 * 输入 = 墓碑台账 `~/.dsh-manage-sessions-index/retired-tombstones.jsonl`（管家 purge
 * 成功路径落账，见 src/host/history/tombstones.ts）。台账里每个被判退场的
 * 会话，本脚本对**仍然残留**的以下四处做兜底清残：
 *
 *   ① 转录目录        ~/.dsh/sessions/<工作区>/<会话id>/      → **移动**进归档区
 *   ② 投影缓存        ~/.dsh/storages/session_projcache/sessions/<id>.json → 移动
 *   ③ workspace.json  global.archivedSessionIds 与 tables.workspaces.*.sessionIds
 *                     里的僵尸 id → 摘除（改前整文件备份进归档区）
 *   ④ 检索面残行      管家 index.sqlite（sessions/docs，fts rebuild）与
 *                     collector projection.db（sessions/segments/segments_fts/
 *                     replaces）里该 id 的行 → 删除（改前 db+wal+shm 备份进归档区）
 *
 * 纪律（对齐 l1/l0-archive-purge 与项目删除规范）：
 * - **dry-run 缺省**，`--apply` 才动盘；
 * - **禁止永久删除**：文件/目录一律移动进 `~/.dsh-manage-sessions-index/retired-cleanup-<ts>/`，
 *   数据库改动前先备份同归档区；
 * - **DSH 必须在关闭状态运行**：检出宿主进程即中止（`--force-live` 显式越过，
 *   越过后自负数据竞争责任）；
 * - 参数校验：会话 id 必须形如 `session-<uuid>`，目录操作限定在预期根之下
 *   （resolve 后越界即拒绝）；畸形 id 记 skipped-invalid 不碰盘。
 *
 * 用法：
 *   node scripts/cleanup-retired.mjs                 # 预览（只读）
 *   node scripts/cleanup-retired.mjs --apply         # 执行
 *   可选：--ledger <path> --dsh-home <path> --index-dir <path>
 *         --collector-db <path> --force-live
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** 合法会话 id：`session-` + uuid（脚本的路径安全闸，比宿主 validSessionIds 严）。 */
export const SESSION_ID_RE = /^session-[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/

/** 台账默认路径（与 src/host/history/tombstones.ts 的缺省目录同串）。 */
export function defaultLedgerPath() {
  return join(homedir(), '.dsh-manage-sessions-index', 'retired-tombstones.jsonl')
}

/** 读台账：JSONL，畸形行跳过；按 id 去重（保留最早 retiredAt）。 */
export function readLedger(file) {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const byId = new Map()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const record = JSON.parse(trimmed)
      if (typeof record?.sessionId === 'string' && record.sessionId !== '' && !byId.has(record.sessionId)) {
        byId.set(record.sessionId, record)
      }
    } catch { /* 半行/脏行：跳过 */ }
  }
  return [...byId.values()]
}

/** `root` 下的绝对路径 `target` 是否仍在 root 内（越界闸）。 */
export function isUnder(root, target) {
  const r = resolve(root)
  const t = resolve(target)
  return t === r || t.startsWith(r + sep)
}

/** 检出 DSH 宿主进程（win32 走 tasklist，其余走 pgrep）；返回命中的进程名列表。 */
export function detectLiveHosts() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 15_000 })
      const hits = []
      for (const line of out.split(/\r?\n/)) {
        const name = (line.split('","')[0] ?? '').replace(/^"/, '').toLowerCase()
        if (/^dsh(\.exe)?$|^deepseek.harness/.test(name) || (name.includes('dsh') && name.endsWith('.exe') && !name.includes('dsh-'))) hits.push(name)
      }
      return [...new Set(hits)]
    }
    const out = execFileSync('pgrep', ['-i', '-l', '-f', 'dsh|deepseek-harness'], { encoding: 'utf8', timeout: 15_000 })
    return out.split(/\r?\n/).filter((l) => l !== '').map((l) => l.trim())
  } catch {
    return [] // pgrep 无命中即 exit 1：视为无宿主
  }
}

/** 扫 sessions 根，找该 id 的转录目录（<root>/<工作区>/<id>/）。 */
export function findSessionDirs(sessionsRoot, id) {
  const out = []
  if (!existsSync(sessionsRoot)) return out
  for (const ws of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue
    const dir = join(sessionsRoot, ws.name, id)
    try {
      if (statSync(dir).isDirectory()) out.push({ workspace: ws.name, dir })
    } catch { /* 不存在是常态 */ }
  }
  return out
}

/**
 * 为一个会话 id 探测全部残留面（只读）。返回计划对象；execute 阶段照单执行。
 */
export function probeId(id, ctx) {
  const { dshHome, indexDir, collectorDb } = ctx
  const plan = { sessionId: id, sessionDirs: [], cacheFile: undefined, workspaceHits: [], stewardRows: 0, collectorRows: 0 }
  plan.sessionDirs = findSessionDirs(join(dshHome, 'sessions'), id)
  const cache = join(dshHome, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  if (existsSync(cache)) plan.cacheFile = cache
  // workspace.json 两处 id 清单
  const wsDoc = ctx.workspaceDoc()
  if (Array.isArray(wsDoc?.global?.archivedSessionIds) && wsDoc.global.archivedSessionIds.includes(id)) {
    plan.workspaceHits.push('global.archivedSessionIds')
  }
  const tables = wsDoc?.tables?.workspaces
  if (tables !== null && typeof tables === 'object') {
    for (const [key, value] of Object.entries(tables)) {
      if (Array.isArray(value?.sessionIds) && value.sessionIds.includes(id)) {
        plan.workspaceHits.push(`tables.workspaces.${key}.sessionIds`)
      }
    }
  }
  // 管家 index.sqlite（sessions/docs 存在才计）
  plan.stewardRows = countSqliteRows(indexDir, id)
  // collector projection.db
  plan.collectorRows = countSqliteRows(collectorDb, id)
  return plan
}

/** 库内该会话的行数（sessions 表口径；库/表不存在回 0，全程只读）。 */
function countSqliteRows(dbPath, id) {
  if (dbPath === '' || !existsSync(dbPath)) return 0
  let db = null
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()
    if (has === undefined) return 0
    return Number(db.prepare('SELECT COUNT(*) n FROM sessions WHERE session_id=?').get(id).n)
  } catch {
    return 0
  } finally {
    try { db?.close() } catch { /* 只读句柄关闭失败无害 */ }
  }
}

/** 备份一个文件（含 sqlite 的 -wal/-shm 伴生件）进归档区 backups/。 */
export function backupFile(src, archiveRoot) {
  const dir = join(archiveRoot, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = Date.now()
  const out = []
  for (const suffix of ['', '-wal', '-shm']) {
    const f = src + suffix
    if (!existsSync(f)) continue
    const dst = join(dir, `${basename(f)}.bak-${stamp}`)
    copyFileSync(f, dst)
    out.push(dst)
  }
  return out
}

/** 移动文件/目录进归档区（禁止永久删除纪律）；同名冲突加序号。 */
export function moveToArchive(src, destDir) {
  mkdirSync(destDir, { recursive: true })
  let dst = join(destDir, basename(src))
  for (let i = 1; existsSync(dst); i += 1) dst = join(destDir, `${basename(src)}.${i}`)
  renameSync(src, dst)
  return dst
}

/**
 * 管家 index.sqlite 内删该会话行：sessions/docs（表存在才动），外部内容 fts
 * 用 `rebuild` 命令从内容表重导（免逐行 delete 记账）。改前备份三件。
 * @returns 删除的 sessions 行数
 */
export function purgeStewardIndex(dbPath, id, archiveRoot) {
  if (!existsSync(dbPath)) return 0
  const backups = backupFile(dbPath, archiveRoot)
  const db = new DatabaseSync(dbPath)
  try {
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)))
    if (!names.has('sessions')) return 0
    let removed = 0
    db.exec('BEGIN')
    try {
      removed = Number(db.prepare('DELETE FROM sessions WHERE session_id=?').run(id).changes)
      if (names.has('docs')) db.prepare('DELETE FROM docs WHERE session_id=?').run(id)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    for (const fts of ['docs_fts']) {
      if (names.has(fts)) {
        try { db.exec(`INSERT INTO ${fts}(${fts}) VALUES('rebuild')`) } catch { /* 普通表 fts 无需 rebuild */ }
      }
    }
    return removed
  } finally {
    db.close()
  }
}

/**
 * collector projection.db 内删该会话行（segments/segments_fts/replaces/sessions，
 * 与在线 deleteSession 同集合；库由 collector 持有，本脚本只在宿主关闭后动）。
 * @returns 删除的 sessions 行数
 */
export function purgeCollectorDb(dbPath, id, archiveRoot) {
  if (!existsSync(dbPath)) return 0
  backupFile(dbPath, archiveRoot)
  const db = new DatabaseSync(dbPath)
  try {
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)))
    if (!names.has('sessions')) return 0
    db.exec('BEGIN')
    try {
      // 旧版 collector 库的 segments_fts 可能无 session_id 列：清不到就交给
      // segments 主表删除 + 搜索侧 JOIN 自然失效（孤儿 fts 行不可见）。
      if (names.has('segments_fts')) {
        try { db.prepare('DELETE FROM segments_fts WHERE session_id=?').run(id) } catch { /* 列形不符：跳过 */ }
      }
      if (names.has('segments')) db.prepare('DELETE FROM segments WHERE session_id=?').run(id)
      if (names.has('replaces')) db.prepare('DELETE FROM replaces WHERE session_id=?').run(id)
      const removed = Number(db.prepare('DELETE FROM sessions WHERE session_id=?').run(id).changes)
      db.exec('COMMIT')
      return removed
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.close()
  }
}

/**
 * 从 workspace.json 文档摘除 id（两处清单），返回 {doc, changed}。
 * 纯函数（不落盘），落盘由 writeWorkspaceJson 完成（保留原 BOM 形态）。
 */
export function stripIdFromWorkspace(doc, id) {
  let changed = false
  const strip = (arr) => arr.filter((x) => {
    const hit = x === id
    if (hit) changed = true
    return !hit
  })
  if (Array.isArray(doc?.global?.archivedSessionIds)) {
    doc.global.archivedSessionIds = strip(doc.global.archivedSessionIds)
  }
  const tables = doc?.tables?.workspaces
  if (tables !== null && typeof tables === 'object') {
    for (const value of Object.values(tables)) {
      if (Array.isArray(value?.sessionIds)) value.sessionIds = strip(value.sessionIds)
    }
  }
  return { doc, changed }
}

/** 无 BOM 感知写回（读时探 BOM，写时保持同形态）。 */
export function writeWorkspaceJson(file, doc, hadBom) {
  const text = JSON.stringify(doc, null, 2) + '\n'
  writeFileSync(file, hadBom ? '\uFEFF' + text : text, 'utf8')
}

/** 解析命令行参数（纯函数，供单测）。 */
export function parseArgs(argv) {
  const opts = { apply: false, forceLive: false, ledger: '', dshHome: '', indexDir: '', collectorDb: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--apply') opts.apply = true
    else if (a === '--force-live') opts.forceLive = true
    else if (a === '--ledger') opts.ledger = argv[++i] ?? ''
    else if (a === '--dsh-home') opts.dshHome = argv[++i] ?? ''
    else if (a === '--index-dir') opts.indexDir = argv[++i] ?? ''
    else if (a === '--collector-db') opts.collectorDb = argv[++i] ?? ''
    else throw new Error(`未知参数：${a}`)
  }
  return opts
}

/** 汇总一次运行（导出供单测直接驱动；main 只是它的 CLI 壳）。 */
export function runCleanup(opts) {
  const home = opts.dshHome !== '' ? opts.dshHome : join(homedir(), '.dsh')
  const indexDir = opts.indexDir !== '' ? opts.indexDir : join(homedir(), '.dsh-manage-sessions-index')
  const ledger = opts.ledger !== '' ? opts.ledger : join(indexDir, 'retired-tombstones.jsonl')
  const collectorDb = opts.collectorDb !== '' ? opts.collectorDb : join(homedir(), '.dsh-reference-session-collector', 'projection.db')
  const wsFile = join(home, 'storages', 'workspace.json')

  const wsRaw = existsSync(wsFile) ? readFileSync(wsFile, 'utf8') : ''
  const hadBom = wsRaw.charCodeAt(0) === 0xFEFF
  let wsDoc = null
  try {
    wsDoc = wsRaw === '' ? null : JSON.parse(hadBom ? wsRaw.slice(1) : wsRaw)
  } catch {
    wsDoc = null
  }
  const ctx = {
    dshHome: home,
    indexDir: join(indexDir, 'index.sqlite'),
    collectorDb,
    workspaceDoc: () => wsDoc,
  }

  const entries = readLedger(ledger)
  const report = {
    mode: opts.apply ? 'apply' : 'dry-run',
    ledger,
    entries: entries.length,
    invalid: [],
    clean: [],
    workspaceBackedUp: false,
    archiveRoot: '',
  }
  for (const entry of entries) {
    if (typeof entry.sessionId !== 'string' || !SESSION_ID_RE.test(entry.sessionId)) {
      report.invalid.push(entry.sessionId)
      continue
    }
    report.clean.push(probeId(entry.sessionId, ctx))
  }
  const residual = report.clean.filter(p =>
    p.sessionDirs.length > 0 || p.cacheFile !== undefined || p.workspaceHits.length > 0
    || p.stewardRows > 0 || p.collectorRows > 0)
  report.withResidue = residual.length

  if (!opts.apply) return report

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const archiveRoot = join(indexDir, `retired-cleanup-${stamp}`)
  report.archiveRoot = archiveRoot
  mkdirSync(archiveRoot, { recursive: true })

  // ③ workspace.json：先整体备份再摘僵尸 id（一次读写的文档，多 id 共用一遍）
  if (wsDoc !== null) {
    const anyHit = report.clean.some(p => p.workspaceHits.length > 0)
    if (anyHit) {
      backupFile(wsFile, archiveRoot)
      report.workspaceBackedUp = true
      for (const p of report.clean) {
        if (p.workspaceHits.length === 0) continue
        const outcome = stripIdFromWorkspace(wsDoc, p.sessionId)
        wsDoc = outcome.doc
      }
      writeWorkspaceJson(wsFile, wsDoc, hadBom)
    }
  }

  for (const p of report.clean) {
    // ① 实体移动（越界闸：目标必须在预期根下）
    for (const s of p.sessionDirs) {
      if (!isUnder(join(home, 'sessions'), s.dir)) throw new Error(`路径越界拒绝：${s.dir}`)
      p.movedDirs = (p.movedDirs ?? []).concat([moveToArchive(s.dir, join(archiveRoot, 'sessions'))])
    }
    if (p.cacheFile !== undefined) {
      if (!isUnder(join(home, 'storages'), p.cacheFile)) throw new Error(`路径越界拒绝：${p.cacheFile}`)
      p.movedCache = moveToArchive(p.cacheFile, join(archiveRoot, 'projcache'))
    }
    // ④ 检索面残行（备份在 purge* 内部完成）
    if (p.stewardRows > 0) p.stewardRemoved = purgeStewardIndex(join(indexDir, 'index.sqlite'), p.sessionId, archiveRoot)
    if (p.collectorRows > 0) p.collectorRemoved = purgeCollectorDb(collectorDb, p.sessionId, archiveRoot)
  }
  writeFileSync(join(archiveRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  return report
}

/** 仅作为 CLI 直跑时执行 main（被 import 时不副作用运行）。 */
function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.forceLive) {
    const live = detectLiveHosts()
    if (live.length > 0) {
      console.error(`检测到 DSH 宿主仍在运行（${live.join(', ')}）——请先完全关闭再跑本脚本。`
        + '（确认知道自己在做什么时可用 --force-live 越过）')
      process.exit(2)
    }
  }
  const report = runCleanup(opts)
  console.log(JSON.stringify(report, null, 2))
  if (opts.apply) console.error(`APPLIED：残骸已归档/清残，归档区 ${report.archiveRoot}`)
  else console.error('DRY-RUN：以上为将处理的残骸预览，加 --apply 执行')
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('cleanup-retired.mjs')
if (invokedDirectly) main()
