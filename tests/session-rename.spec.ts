/**
 * `session-rename`（host 半身）行为契约单测。
 *
 * 锁三件事：
 * 1. 走宿主 durable 通道 `sessionController.session.rename`，并把接受后的标题回传；
 * 2. **成功后必须失效本插件标题 memo** —— 否则面板 5 分钟内重取会拿回旧标题，
 *    用户体感就是「改名存不住」（本次修复的核心）；
 * 3. 服务缺席/抛错都转成结构化失败，不向路由层抛异常。
 */
import { describe, expect, it, vi } from 'vitest'
import { renameSessionViaHost, type StewardRuntime } from '../src/index.ts'
import { TitleMemo } from '../src/host/catalog/title-source.ts'

const SESSION = 'session-2f0f7f5a-1111-4a2a-9d1e-123456789abc'

/**
 * 造一个只带 rename 通道的运行时。
 * @param rename - 宿主 `session.rename` 的实现（可抛错）。
 * @param withTitles - 是否挂标题 memo（缺省挂，用于验证失效）。
 */
function runtimeWith(
  rename: ((request: { sessionId: string; title: string }) => Promise<unknown>) | undefined,
  withTitles = true,
): StewardRuntime {
  const titles = withTitles ? new TitleMemo() : undefined
  return {
    config: () => ({ enabled: true, historyFiles: true, healthCheck: true, directDelete: false }),
    dshHome: 'C:/tmp/dsh-test',
    ctx: {
      get(name: string) {
        if (name !== 'sessionController') return undefined
        if (rename === undefined) return undefined
        return { session: { rename } }
      },
    },
    registry: () => undefined,
    projectionStateFor: () => undefined,
    attribute: () => undefined,
    log: () => {},
    titles,
  }
}

describe('session-rename（host durable 通道）', () => {
  it('调用宿主 rename 并回传接受后的标题与 seq', async () => {
    const rename = vi.fn(async () => ({ title: '新名字', seq: 42 }))
    const res = (await renameSessionViaHost(runtimeWith(rename), { sessionId: SESSION, title: '  新名字  ' })) as {
      ok: boolean
      title?: string
      seq?: number
      sessionId?: string
    }
    expect(res.ok).toBe(true)
    expect(res.title).toBe('新名字')
    expect(res.seq).toBe(42)
    expect(res.sessionId).toBe(SESSION)
    // 传给宿主的是**未 trim 的原文**（标题规范化归宿主，我们不抢这个职责）
    expect(rename).toHaveBeenCalledWith({ sessionId: SESSION, title: '  新名字  ' })
  })

  it('成功后失效标题 memo（改名存得住的前提）', async () => {
    const runtime = runtimeWith(async () => ({ title: '持久名字', seq: 7 }))
    // 先塞一条旧结论进 memo，模拟「面板刚打开过」
    runtime.titles!.set(SESSION, '旧名字', 'cache')
    expect(runtime.titles!.get(SESSION)?.title).toBe('旧名字')

    const res = (await renameSessionViaHost(runtime, { sessionId: SESSION, title: '持久名字' })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(runtime.titles!.get(SESSION)).toBeUndefined()
  })

  it('服务缺席时返回可识别的 service-unavailable（供客户端降级）', async () => {
    const res = (await renameSessionViaHost(runtimeWith(undefined), { sessionId: SESSION, title: 'x' })) as {
      ok: boolean
      code?: string
    }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('service-unavailable')
  })

  it('宿主抛错转结构化失败，不冒泡', async () => {
    const rename = async (): Promise<unknown> => {
      const err = Object.assign(new Error('session title must contain visible characters'), {
        code: 'session/title-invalid',
      })
      throw err
    }
    const res = (await renameSessionViaHost(runtimeWith(rename), { sessionId: SESSION, title: '   ' })) as {
      ok: boolean
      code?: string
      error?: string
    }
    // 空标题在进宿主之前就被拦下
    expect(res.ok).toBe(false)
    expect(res.error).toBe('名称不能为空')

    const res2 = (await renameSessionViaHost(runtimeWith(async () => {
      throw Object.assign(new Error('boom'), { code: 'gateway/internal' })
    }), { sessionId: SESSION, title: 'ok' })) as { ok: boolean; code?: string; error?: string }
    expect(res2.ok).toBe(false)
    expect(res2.code).toBe('gateway/internal')
    expect(res2.error).toBe('boom')
  })

  it('缺 sessionId 直接拒绝（零宿主调用）', async () => {
    const rename = vi.fn(async () => ({ title: 'x', seq: 1 }))
    const res = (await renameSessionViaHost(runtimeWith(rename), { title: '新名' })) as { ok: boolean }
    expect(res.ok).toBe(false)
    expect(rename).not.toHaveBeenCalled()
  })
})
