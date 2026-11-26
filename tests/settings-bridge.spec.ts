/**
 * Legacy 设置桥（宿主半）行为测试：settings-describe / settings-mutate 两个
 * 桥方法在 handleMethod 层的契约——闸旁路、校验白名单、legacy 可写、modern
 * 只读投影、宿主拒绝显式失败。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { Config, handleMethod, type StewardRuntime } from '../src/index.ts'
import {
  bridgeOverlay,
  describeNamespaces,
  installLegacySettingsBridge,
  type BridgeState,
  type LegacySettingsBridge,
} from '../src/host/settings-bridge.ts'

/** 内存版 legacy settings 服务（register 忽略 schema；get/update 走同一份文档）。 */
function fakeBridge(initial: Record<string, Record<string, unknown>> = {}): {
  face: LegacySettingsBridge
  docs: Record<string, Record<string, unknown>>
  failNext: boolean
} {
  const docs = { ...initial }
  const state = {
    face: {
      get: (ns: string) => docs[ns],
      update: async (ns: string, patch: Record<string, unknown>) => {
        if (state.failNext) {
          state.failNext = false
          throw new Error('宿主拒绝写入（模拟）')
        }
        docs[ns] = { ...docs[ns], ...patch }
      },
    } as LegacySettingsBridge,
    docs,
    failNext: false,
  }
  return state
}

function runtimeWith(bridge: BridgeState | undefined): StewardRuntime {
  return {
    config: () => ({ ...DEFAULT_CONFIG }),
    dshHome: '/tmp/does-not-matter',
    registry: () => undefined,
    projectionStateFor: () => undefined,
    attribute: (projection: string) => ({ projection, package: 'unknown' }),
    log: () => {},
    settingsBridge: bridge,
  }
}


/** 假 ctx：cordis 作用域注入的最小面（回调立即以给定 settings 调用）。 */
function fakeCtx(settings: unknown): unknown {
  return {
    inject: (_deps: string[], fn: (sctx: { settings?: unknown }) => void) => { fn({ settings }) },
  }
}

describe('Config schema 的 volatile 标记（设置表单的地基）', () => {
  // 这条契约抓的是真出过的线上事故：schema 是 **callable**（typeof 'function'），
  // 早期 withVolatile 用 typeof === 'object' 守卫 → 恒假 → 一个字段都没标 volatile
  // → 宿主 volatileForm() 返回 undefined → describe() 整条跳过本 entry（ns 都不出现）
  // → 设置表单一律不可写、写请求被 "No configurable plugin entry" 拒绝。
  it('五个字段全部带 volatile 元数据（否则宿主根本不认这个命名空间）', () => {
    const dict = (Config as unknown as { dict?: Record<string, { meta?: { volatile?: unknown } }> }).dict ?? {}
    const fields = ['enabled', 'historyFiles', 'healthCheck', 'directDelete', 'columns']
    for (const field of fields) {
      expect(dict[field], field).toBeDefined()
      expect(dict[field]!.meta?.volatile, field).toBe(true)
    }
  })
})
describe('桥咬合（两代宿主）', () => {
  it('老线（≤0.1.5）：register 在 → 先注册 schema，读写落 manage-session', async () => {
    const registered: string[] = []
    const written: Array<[string, Record<string, unknown>]> = []
    const docs: Record<string, Record<string, unknown>> = { 'manage-session': { enabled: false } }
    const settings = {
      register: (ns: string, _schema: unknown) => { registered.push(ns); return undefined },
      get: (ns: string) => docs[ns],
      update: async (ns: string, patch: Record<string, unknown>) => {
        written.push([ns, patch])
        docs[ns] = { ...docs[ns], ...patch }
      },
    }
    const state = installLegacySettingsBridge(fakeCtx(settings))
    expect(state.bridge).toBeDefined()
    expect(registered).toEqual(['manage-session'])
    expect(describeNamespaces(state)['manage-session']).toMatchObject({ enabled: false, columns: 3 })
    await state.bridge!.update('manage-session', { columns: 4 })
    expect(written.map(([ns]) => ns)).toEqual(['manage-session'])
  })

  it('现代线（0.1.7+，无 register）：describe+update 咬合，ns 用 profile entry id 且不传 revision', async () => {
    const calls: Array<{ ns: string; patch: Record<string, unknown>; revision: unknown }> = []
    const settings = {
      describe: () => [{ ns: 'dsh-manage-session', revision: 9, value: { enabled: false, columns: 5 } }],
      update: async (ns: string, patch: Record<string, unknown>, revision?: unknown) => {
        calls.push({ ns, patch, revision })
      },
    }
    const state = installLegacySettingsBridge(fakeCtx(settings))
    expect(state.bridge).toBeDefined()
    // 读：describe 同 ns 行的 value 即权威投影（含缺省）
    expect(describeNamespaces(state)['manage-session']).toMatchObject({ enabled: false, columns: 5 })
    await state.bridge!.update('manage-session', { columns: 2 })
    // 写：ns 换成正宿主 entry id；expectedRevision 必须缺席（宿主据此跳过比对）
    expect(calls).toEqual([{ ns: 'dsh-manage-session', patch: { columns: 2 }, revision: undefined }])
  })

  it('现代线无 update 时用 mutate 逐字段下发', async () => {
    const ops: unknown[] = []
    const settings = {
      describe: () => [{ ns: 'dsh-manage-session', value: { enabled: true } }],
      mutate: async (_ns: string, list: unknown[]) => { ops.push(...list) },
    }
    const state = installLegacySettingsBridge(fakeCtx(settings))
    await state.bridge!.update('manage-session', { enabled: false, columns: 2 })
    expect(ops).toEqual([
      { op: 'set', path: ['enabled'], value: false },
      { op: 'set', path: ['columns'], value: 2 },
    ])
  })

  it('没有任何写入口：桥保持空（真只读），settings-describe 才报 writable=false', () => {
    const state = installLegacySettingsBridge(fakeCtx({ describe: () => [{ ns: 'dsh-manage-session', value: {} }] }))
    expect(state.bridge).toBeUndefined()
  })
})
describe('settings-describe', () => {
  it('legacy 桥：回两命名空间文档 + writable=true + revision', async () => {
    const docs = fakeBridge({ 'manage-session': { enabled: false } })
    const runtime = runtimeWith({ bridge: docs.face, revision: 7 })
    const res = await handleMethod('settings-describe', {}, runtime) as {
      ok: boolean
      writable: boolean
      revision: number
      namespaces: Record<string, Record<string, unknown>>
    }
    expect(res.ok).toBe(true)
    expect(res.writable).toBe(true)
    expect(res.revision).toBe(7)
    expect(res.namespaces['manage-session']).toMatchObject({ enabled: false, historyFiles: true })
  })

  it('modern 宿主（无桥）：只读投影 + writable=false，mutate 显式拒绝', async () => {
    const runtime = runtimeWith(undefined)
    const described = await handleMethod('settings-describe', {}, runtime) as { ok: boolean; writable: boolean; namespaces: Record<string, Record<string, unknown>> }
    expect(described.ok).toBe(true)
    expect(described.writable).toBe(false)
    const mutated = await handleMethod('settings-mutate', { ns: 'manage-session', fields: { enabled: false } }, runtime) as { ok: boolean; error?: string }
    expect(mutated.ok).toBe(false)
    // 文案已改口径：真正缺的是「写入口」，不再是「缺 legacy settings 服务」。
    expect(mutated.error).toContain('设置写入口')
  })

  it('闸旁路：enabled/healthCheck/historyFiles 全关，describe 仍然可读', async () => {
    const docs = fakeBridge()
    const runtime = runtimeWith({ bridge: docs.face, revision: 0 })
    runtime.config = () => ({
      ...DEFAULT_CONFIG,
      enabled: false,
      healthCheck: false,
      historyFiles: false,
    })
    const res = await handleMethod('settings-describe', {}, runtime) as { ok: boolean; error?: string }
    expect(res.ok).toBe(true)
    expect(res.error).toBeUndefined()
  })
})

describe('settings-mutate', () => {
  it('合法字段：合并写入 + revision 自增 + 回权威文档', async () => {
    const docs = fakeBridge()
    const state: BridgeState = { bridge: docs.face, revision: 0 }
    const runtime = runtimeWith(state)
    const res = await handleMethod('settings-mutate', { ns: 'manage-session', fields: { enabled: false, historyFiles: false } }, runtime) as {
      ok: boolean
      revision?: number
      namespaces?: Record<string, Record<string, unknown>>
    }
    expect(res.ok).toBe(true)
    expect(res.revision).toBe(1)
    expect(docs.docs['manage-session']).toMatchObject({ enabled: false, historyFiles: false })
    expect(res.namespaces?.['manage-session']).toMatchObject({ enabled: false, healthCheck: true })
  })


  it('未知命名空间 / 白名单外字段 / 类型错误 / 空 fields 一律显式拒绝', async () => {
    const docs = fakeBridge()
    const runtime = runtimeWith({ bridge: docs.face, revision: 0 })
    const cases: Array<{ payload: unknown; errorPart: string }> = [
      { payload: { ns: 'no-such-ns', fields: { enabled: true } }, errorPart: '未知设置命名空间' },
      { payload: { ns: 'manage-session', fields: { nope: true } }, errorPart: '不接受字段' },
      { payload: { ns: 'manage-session', fields: { enabled: 'yes' } }, errorPart: '期望布尔值' },
      { payload: { ns: 'manage-session', fields: {} }, errorPart: 'fields 为空' },
      { payload: { ns: 'manage-session', fields: 'not-an-object' }, errorPart: 'fields 必须是对象' },
    ]
    for (const { payload, errorPart } of cases) {
      const res = await handleMethod('settings-mutate', payload, runtime) as { ok: boolean; error?: string }
      expect(res.ok, JSON.stringify(payload)).toBe(false)
      expect(res.error, JSON.stringify(payload)).toContain(errorPart)
    }
  })

  it('宿主拒绝写入：显式失败且不 bump revision', async () => {
    const docs = fakeBridge()
    const state: BridgeState = { bridge: docs.face, revision: 3 }
    docs.failNext = true
    const res = await handleMethod('settings-mutate', { ns: 'manage-session', fields: { enabled: false } }, runtimeWith(state)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('宿主拒绝写入')
    expect(state.revision).toBe(3)
  })
})

describe('bridgeOverlay（运行时叠加文档——3085 实锤补口）', () => {
  it('桥未咬合（modern/undefined）：两 ns 皆空对象 = 零叠加', () => {
    expect(bridgeOverlay({ bridge: undefined, revision: 0 })).toEqual({ steward: {} })
  })

  it('桥咬合：只回已写键、不铺缺省；两 ns 分开不串', () => {
    const docs = fakeBridge({ 'manage-session': { directDelete: true } })
    const ov = bridgeOverlay({ bridge: docs.face, revision: 0 })
    // 已写键原样透出
    expect(ov.steward).toEqual({ directDelete: true })
    // 未写键缺席（不铺 DEFAULT_CONFIG）——current() 据此回退组合值
    expect('enabled' in ov.steward).toBe(false)
    // 两 ns 各自独立：manage-session 的 enabled 不会被 manage-session-search 串改
    expect(ov.steward['syncIntervalMs']).toBeUndefined()
  })

  it('空文档桥：两 ns 都回空对象（老线从未拨过任何开关）', () => {
    const docs = fakeBridge()
    const ov = bridgeOverlay({ bridge: docs.face, revision: 0 })
    expect(ov.steward).toEqual({})
  })
})
