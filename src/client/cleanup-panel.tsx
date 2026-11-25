/**
 * 清理页签（与「体检」并列的后台标签）：只看没删干净的墓碑 + 确定性清理命令。
 *
 * 为什么在这里而不是管理台底部（用户定标 2026-11-25）：管理台主视图只放会话本身；
 * 墓碑区是「删除没做干净」的运维面，和体检同属后台，集中在一个页签里更好找。
 *
 * 数据源（host 只返回待处理项）：
 * - `session-tombstones`：`pending-cleanup`（目录/缓存仍在）或墓碑失效的条目；
 * - `session-tombstone-forget`：实体已无才允许撤墓碑（实体还在必须走回收站）。
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { callSteward } from './host-api.ts'
import { translate } from './manage-locales.ts'

/** 清理区的一行（host `session-tombstones` 的 pending 项）。 */
export interface CleanupRow {
  sessionId: string
  state: string
  reason: string
  retiredAt: string
  cwd: string
  entityExists: boolean
}

/** 确定性清理命令（页签内可一键复制；需先完全退出 DSH，再在 profile 目录执行）。 */
export const CLEANUP_COMMANDS = [
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs list',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs tombstones',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger',
].join('\n')

const STYLE_ID = 'dmsc-cleanup-style'
const CLEANUP_CSS = `
.dmsc_root{display:flex;flex-direction:column;gap:0;flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px 14px}
.dmsc_head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dmsc_title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dmsc_tag{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dmsc_tagPend{flex:none;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-caption));font-size:10px;line-height:16px;border:1px solid currentColor;border-radius:999px;padding:0 6px;white-space:nowrap}
.dmsc_btn{height:26px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:0 10px;font-size:12px;line-height:24px;white-space:nowrap}
.dmsc_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmsc_btn:disabled{cursor:not-allowed;opacity:.5}
.dmsc_btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dmsc_row{display:flex;align-items:center;gap:8px;margin-top:8px;min-width:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.dmsc_id{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dmsc_reason{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dmsc_cmd{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:17px;white-space:pre;overflow:auto;max-height:150px}
.dmsc_hint{margin-top:8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;word-break:break-all}
.dmsc_msg{margin-top:8px;font-size:12px;line-height:18px}
.dmsc_ok{color:var(--dsw-alias-label-secondary)}
.dmsc_err{color:var(--dsw-alias-state-error-primary)}
`

/** 注入清理页签样式（卸载即移除）。 */
function useCleanupStyles(): void {
  useEffect(() => {
    if (document.getElementById(STYLE_ID) !== null) return
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.textContent = CLEANUP_CSS
    document.head.appendChild(tag)
    return () => {
      if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
    }
  }, [])
}

/** 清理页签主体。 */
export function CleanupPanel(): ReactElement {
  const [rows, setRows] = useState<CleanupRow[] | null>(null)
  const [ledger, setLedger] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  useCleanupStyles()

  /** 只读拉一次：host 只返回没删干净的条目。 */
  const refresh = (): void => {
    void callSteward<{ pending?: CleanupRow[]; ledger?: string }>('session-tombstones', {}).then((res) => {
      if (!res.ok) return
      setRows(Array.isArray(res.pending) ? res.pending : [])
      setLedger(res.ledger ?? '')
    })
  }
  useEffect(refresh, [])

  /** 重试删除：复用 purge（先归档 → detach → 删盘 → 后置校验）。 */
  const retry = (sessionId: string): void => {
    if (busy) return
    setBusy(true)
    void callSteward<{ ok: boolean; pendingCleanup?: string[]; failures?: { reason: string }[] }>(
      'session-history-purge', { sessionIds: [sessionId] },
    ).then((res) => {
      setBusy(false)
      const residual = res.pendingCleanup ?? []
      const reason = res.failures?.[0]?.reason
      const text = res.ok !== true
        ? translate(undefined, 'manage.done.error', { error: res.error ?? '?' })
        : residual.length > 0
          ? translate(undefined, 'manage.done.pending', { n: residual.length })
          : `${translate(undefined, 'manage.done.purge', { n: 1 })}${reason === undefined ? '' : ` · ${reason}`}`
      setMessage({ text, ok: res.ok !== false })
      refresh()
    })
  }

  /** 撤墓碑：仅实体已无时允许（host 侧会再校验）。 */
  const forget = (sessionId: string): void => {
    if (busy) return
    setBusy(true)
    void callSteward<{ ok: boolean; forgotten?: number }>('session-tombstone-forget', { sessionIds: [sessionId] }).then((res) => {
      setBusy(false)
      setMessage({
        text: res.ok
          ? translate(undefined, 'manage.cleanup.forgot', { n: res.forgotten ?? 1 })
          : translate(undefined, 'manage.done.error', { error: res.error ?? '?' }),
        ok: res.ok,
      })
      refresh()
    })
  }

  /** 一键复制命令（剪贴板被拒时静默）。 */
  const copy = (): void => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined) return
    void clipboard.writeText(CLEANUP_COMMANDS).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => { /* 不阻断面板 */ })
  }

  const list = rows ?? []
  return createElement('section', { className: 'dmsc_root' }, [
    createElement('div', { key: 'head', className: 'dmsc_head' }, [
      createElement('span', { key: 'title', className: 'dmsc_title' }, translate(undefined, 'manage.cleanup.title')),
      list.length > 0
        ? createElement('span', { key: 'count', className: 'dmsc_tagPend' }, translate(undefined, 'manage.cleanup.pending', { n: list.length }))
        : createElement('span', { key: 'count', className: 'dmsc_tag' }, translate(undefined, 'manage.cleanup.empty')),
      createElement('button', {
        key: 'copy', type: 'button', className: 'dmsc_btn', title: CLEANUP_COMMANDS, onClick: copy,
      }, translate(undefined, copied ? 'manage.cleanup.copied' : 'manage.cleanup.copy')),
    ]),
    ...(message === null
      ? []
      : [createElement('div', { key: 'msg', className: `dmsc_msg ${message.ok ? 'dmsc_ok' : 'dmsc_err'}`, role: 'status' }, message.text)]),
    ...list.map(row => createElement('div', { key: row.sessionId, className: 'dmsc_row' }, [
      createElement('span', { key: 'id', className: 'dmsc_id', title: row.sessionId },
        row.sessionId.length > 34 ? `${row.sessionId.slice(0, 34)}…` : row.sessionId),
      createElement('span', { key: 'state', className: 'dmsc_tagPend' }, row.entityExists ? row.state : 'stale'),
      createElement('span', {
        key: 'reason', className: 'dmsc_reason', title: row.reason !== '' ? row.reason : row.cwd,
      }, row.reason !== '' ? row.reason : (row.cwd !== '' ? row.cwd : '—')),
      createElement('button', {
        key: 'retry', type: 'button', className: 'dmsc_btn', disabled: busy,
        onClick: () => { retry(row.sessionId) },
      }, translate(undefined, 'manage.cleanup.retry')),
      ...(row.entityExists
        ? []
        : [createElement('button', {
          key: 'forget', type: 'button', className: 'dmsc_btn dmsc_btnDanger', disabled: busy,
          onClick: () => { forget(row.sessionId) },
        }, translate(undefined, 'manage.cleanup.forget'))]),
    ])),
    createElement('div', { key: 'scriptHead', className: 'dmsc_hint' }, translate(undefined, 'manage.cleanup.script')),
    createElement('pre', { key: 'script', className: 'dmsc_cmd' }, CLEANUP_COMMANDS),
    ...(ledger === '' ? [] : [createElement('div', { key: 'ledger', className: 'dmsc_hint' }, ledger)]),
  ])
}