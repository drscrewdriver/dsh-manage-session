/**
 * `session-rename` 路由层契约（handleMethod 驱动，不起 HTTP）。
 *
 * 锁的是 dispatch 面：白名单收单、开关语义、payload 校验、错误透传。
 * host 方法本体的 durable 行为由 `session-rename.spec.ts` 锁。
 */
import { describe, expect, it, vi } from 'vitest'
import { handleMethod, methodEnabled, ROW_ACTION_METHODS, type StewardRuntime } from '../src/index.ts'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { TitleMemo } from '../src/host/catalog/title-source.ts'

const SESSION = 'session-aaaa1111-2222-3333-4444-555566667777'

/** 造一个只关心 rename 链路的运行时。 */
function runtime(rename: ((r: { sessionId: string; title: string }) => Promise<unknown>) | undefined): StewardRuntime {
  return {
    config: () => DEFAULT_CONFIG,
    dshHome: 'C:/tmp/dsh-test',
    ctx: {
      get(name: string) {
        if (name !== 'sessionController') return undefined
        return rename === undefined ? undefined : { session: { rename } }
      },
    },
    registry: () => undefined,
    projectionStateFor: () => undefined,
    attribute: () => undefined,
    log: () => {},
    titles: new TitleMemo(),
  }
}

describe('session-rename 路由派发', () => {
  it('方法在册且只受总开关管（historyFiles=false 时仍可改名）', () => {
    expect(ROW_ACTION_METHODS).toContain('session-rename')
    expect(methodEnabled('session-rename', { ...DEFAULT_CONFIG, historyFiles: false })).toBe(true)
    expect(methodEnabled('session-rename', { ...DEFAULT_CONFIG, healthCheck: false })).toBe(true)
    expect(methodEnabled('session-rename', { ...DEFAULT_CONFIG, enabled: false })).toBe(false)
  })

  it('handleMethod 收单并回传 ok + title', async () => {
    const rename = vi.fn(async () => ({ title: '路由新名', seq: 3 }))
    const res = (await handleMethod('session-rename', { sessionId: SESSION, title: '路由新名' }, runtime(rename))) as {
      ok: boolean; title?: string; seq?: number
    }
    expect(res.ok).toBe(true)
    expect(res.title).toBe('路由新名')
    expect(rename).toHaveBeenCalledOnce()
  })

  it('payload 缺 sessionId / 空标题 → 400 风格的 ok:false，零宿主调用', async () => {
    const rename = vi.fn(async () => ({ title: 'x', seq: 1 }))
    const noId = (await handleMethod('session-rename', { title: '新名' }, runtime(rename))) as { ok: boolean }
    const empty = (await handleMethod('session-rename', { sessionId: SESSION, title: '  ' }, runtime(rename))) as { ok: boolean }
    expect(noId.ok).toBe(false)
    expect(empty.ok).toBe(false)
    expect(rename).not.toHaveBeenCalled()
  })

  it('宿主无 sessionController → service-unavailable（客户端据此降级）', async () => {
    const res = (await handleMethod('session-rename', { sessionId: SESSION, title: 'x' }, runtime(undefined))) as {
      ok: boolean; code?: string
    }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('service-unavailable')
  })

  it('宿主拒绝 → 错误码与消息原样透传', async () => {
    const res = (await handleMethod('session-rename', { sessionId: SESSION, title: 'x' }, runtime(async () => {
      throw Object.assign(new Error('title must contain visible characters'), { code: 'session/title-invalid' })
    }))) as { ok: boolean; code?: string; error?: string }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('session/title-invalid')
    expect(res.error).toContain('visible characters')
  })
})
