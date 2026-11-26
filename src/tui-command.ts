/**
 * tui-command.ts — `/sessions`：会话管理台的 dsh-tui 终端面。
 *
 * 背景：dsh-tui 不加载侧栏/管理台页面；TUI 只有 `/list`（本地）与 `/resume`，
 * 看不到归档/收藏/体检。命令面复用 `listSessions()` 的同一份语料，只读。
 *
 * 契约：单行 <=100、总行 <=40、无 ANSI、--json 单行。
 */

import type { Context } from 'cordis'

export type CommandKind = 'success' | 'error'
export interface CommandResult { kind: CommandKind; text: string }

export interface SessionRow {
  sessionId?: string
  title?: string
  cwd?: string
  updatedAt?: number
  archived?: boolean
}

export interface ProgressAnchorFace {
  board?: {
    enabled?: boolean
    summary?: { percent?: number; done?: number; total?: number }
  }
  time?: { etaMin?: number }
}

export interface SessionsDeps {
  list(): Promise<{ ok: boolean; items?: unknown[]; error?: string }>
  /** 可选：宿主 progressAnchor 服务的同步读取；缺席/抛错时退化为不渲染进度列。 */
  readAnchor?(sessionId: string): any
}

const MAX_LINES = 40
const MAX_WIDTH = 100

export function clip(text: string, width = MAX_WIDTH): string {
  const value = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+$/, '')
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`
}

export function renderLines(lines: string[], limit = MAX_LINES): string {
  const clipped = lines.map((line) => clip(line))
  if (clipped.length <= limit) return clipped.join('\n')
  const kept = clipped.slice(0, limit - 1)
  return [...kept, `… 还有 ${clipped.length - kept.length} 行，加 --all 查看`].join('\n')
}

function day(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toISOString().slice(0, 10)
}

export async function runSessionsCommand(rawInput: string, deps: SessionsDeps): Promise<CommandResult> {
  const argv = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
  const json = argv.includes('--json')
  const all = argv.includes('--all')
  const sub = (argv.find((token) => !token.startsWith('--')) ?? 'audit').toLowerCase()
  const limit = all ? 40 : 10
  const wrap = (result: CommandResult, data: unknown): CommandResult => {
    if (!json) return result
    const body = result.kind === 'error'
      ? { ok: false, cmd: 'sessions', error: { message: result.text.split('\n')[0] ?? result.text } }
      : { ok: true, cmd: 'sessions', data }
    return { kind: result.kind, text: JSON.stringify(body) }
  }
  if (sub === 'help' || sub === '?') {
    return wrap({ kind: 'success', text: renderLines([
      'sessions — 会话管理台（只读）',
      '  /sessions audit     会话总数 + 最近 10 个（--all 取 40）',
      '  /sessions archived  只看已归档会话',
      '  /sessions prune     dry run：预估可清理的归档会话数（不删）',
      '  flags               --json 单行 JSON',
      '  note                归档/删除仍在 Desktop 管理台；TUI 本地 /list 只看本机列表',
    ]) }, { help: true })
  }
  if (sub === 'prune') {
    const listed = await deps.list()
    if (!listed.ok) {
      return wrap({ kind: 'error', text: renderLines([
        `sessions prune: 读取语料失败：${listed.error ?? '未知原因'}`,
        '  next 检查 sessionQuery 服务是否可用',
      ]) }, {})
    }
    const all = (listed.items ?? []) as SessionRow[]
    const archived = all.filter((row) => row.archived === true)
    const yes = /(^|\s)--yes(\s|$)/.test(String(rawInput ?? ''))
    const lines = [
      `sessions prune — dry run：将清理 ${archived.length} 个归档会话（总 ${all.length}）`,
      ...archived.slice(0, 10).map((row) => `  ${String(row.sessionId ?? '').slice(-8)}  ${clip(row.title || '(untitled)', 52)}`),
    ]
    if (archived.length > 10) lines.push(`  … 还有 ${archived.length - 10} 个`)
    if (yes) {
      lines.push('  blocked   命令层不提供删除：批量清理会真删会话，只能在 Desktop 管理台里手动执行')
      return wrap({ kind: 'error', text: renderLines(lines) }, { archived: archived.length })
    }
    lines.push('  next      确认后去 Desktop 管理台批量清理；命令只做影响面预估')
    return wrap({ kind: 'success', text: renderLines(lines) }, { dry: true, archived: archived.length, total: all.length })
  }
  if (sub !== 'audit' && sub !== 'archived') {
    return wrap({ kind: 'error', text: renderLines([`sessions: 未知子命令 "${sub}"`, '  next: /sessions help']) }, {})
  }
  const listed = await deps.list()
  if (!listed.ok) {
    return wrap({ kind: 'error', text: renderLines([
      `sessions: 读取语料失败：${listed.error ?? '未知原因'}`,
      '  next 检查 sessionQuery 服务是否可用',
    ]) }, {})
  }
  const allRows = (listed.items ?? []) as SessionRow[]
  const rows = sub === 'archived' ? allRows.filter((row) => row.archived === true) : allRows
  const archivedCount = allRows.filter((row) => row.archived === true).length
  if (rows.length === 0) {
    return wrap({ kind: 'success', text: sub === 'archived' ? 'sessions archived — 没有已归档会话' : 'sessions audit — 没有会话' }, { total: 0 })
  }
  const sorted = [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const head = sub === 'archived'
    ? `sessions archived — ${sorted.length} 个归档（总 ${allRows.length}）`
    : `sessions audit — 共 ${sorted.length} 个（归档 ${archivedCount}），显示前 ${Math.min(limit, sorted.length)}`
  const lines = [head]
  for (const row of sorted.slice(0, limit)) {
    let line = `  ${String(row.sessionId ?? '').slice(-8)}  ${day(row.updatedAt)}  ${clip(row.title || '(untitled)', 52)}`
    if (sub === 'audit' && typeof deps.readAnchor === 'function' && row.sessionId) {
      try {
        const anchor = deps.readAnchor(row.sessionId) as ProgressAnchorFace | undefined
        const board = anchor?.board
        const summary = board?.enabled === true ? board.summary : undefined
        if (summary) {
          line += `  ${summary.percent}% ${summary.done}/${summary.total}`
          const eta = anchor?.time?.etaMin
          if (typeof eta === 'number' && Number.isFinite(eta)) line += ` · ETA ${eta}m`
        }
      } catch {
        // 进度列是可选增强：读数抛错时保持原行不变。
      }
    }
    lines.push(line)
  }
  if (sorted.length > limit) lines.push(`  … 还有 ${sorted.length - limit} 个，加 --all 查看`)
  return wrap({ kind: 'success', text: renderLines(lines) }, { total: allRows.length, archived: archivedCount, items: sorted.slice(0, limit) })
}

export function registerSessionsCommand(ctx: Context, deps: SessionsDeps): void {
  const registry = (ctx as unknown as { commands?: { register(definition: unknown): unknown } }).commands
  if (!registry || typeof registry.register !== 'function') return
  registry.register({
    definitionId: 'dsh-manage-session',
    name: 'sessions',
    description: 'Session console: total count + most recent sessions (read-only)',
    input: { hint: '[audit|archived] [--all] [--json]' },
    handler: (invocation: { rawInput?: string }) => runSessionsCommand(invocation?.rawInput ?? '', deps),
  })
}
