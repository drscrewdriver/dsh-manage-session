/**
 * `/sessions audit` 可选进度列契约（2.0.25）：
 * 服务缺席 → 输出逐字符不变；board.enabled 且可读 → 追加进度与 ETA；enabled=false → 不追加。
 */
import { describe, expect, it } from 'vitest'
import { runSessionsCommand, type SessionsDeps } from '../src/tui-command.ts'

const rows = [
  { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-123456789012', title: 'Alpha session', updatedAt: 1700000000000 },
  { sessionId: '11111111-2222-3333-4444-555555555555', title: 'Beta session', updatedAt: 1600000000000, archived: true },
]

function deps(readAnchor?: SessionsDeps['readAnchor']): SessionsDeps {
  const base: SessionsDeps = { list: async () => ({ ok: true, items: rows }) }
  if (readAnchor) base.readAnchor = readAnchor
  return base
}

const BASELINE = [
  'sessions audit — 共 2 个（归档 1），显示前 2',
  '  56789012  2023-11-14  Alpha session',
  '  55555555  2020-09-13  Beta session',
].join('\n')

describe('/sessions audit 可选进度列', () => {
  it('无 readAnchor（服务缺席）→ 输出与改动前逐字符一致', async () => {
    const result = await runSessionsCommand('audit', deps())
    expect(result.text).toBe(BASELINE)
  })

  it('board.enabled=true → 行尾含 45% 3/7 与 ETA 6m', async () => {
    const readAnchor = () => ({
      version: 1,
      board: { enabled: true, summary: { total: 7, done: 3, doing: 1, todo: 3, blocked: 0, percent: 45 }, inFlight: 0, pendingUserChanges: 0 },
      time: { etaMin: 6 },
    })
    const result = await runSessionsCommand('audit', deps(readAnchor))
    for (const line of result.text.split('\n').slice(1)) {
      expect(line).toContain('45% 3/7')
      expect(line).toContain('ETA 6m')
    }
    expect(result.text).toContain('Alpha session  45% 3/7 · ETA 6m')
  })

  it('board.enabled=false → 不追加进度列（逐字符等于基线）', async () => {
    const readAnchor = () => ({
      board: { enabled: false, summary: { percent: 45, done: 3, total: 7 } },
      time: { etaMin: 6 },
    })
    const result = await runSessionsCommand('audit', deps(readAnchor))
    expect(result.text).toBe(BASELINE)
  })

  it('readAnchor 抛错 → 零影响，退化为基线', async () => {
    const readAnchor = () => { throw new Error('service gone') }
    const result = await runSessionsCommand('audit', deps(readAnchor))
    expect(result.text).toBe(BASELINE)
  })

  it('archived 子命令即使给了 readAnchor 也不追加进度列', async () => {
    const readAnchor = () => ({ board: { enabled: true, summary: { percent: 45, done: 3, total: 7 } }, time: { etaMin: 6 } })
    const result = await runSessionsCommand('archived', deps(readAnchor))
    expect(result.text).toBe([
      'sessions archived — 1 个归档（总 2）',
      '  55555555  2020-09-13  Beta session',
    ].join('\n'))
  })
})
