/**
 * 设置桥（宿主半身）：老宿主（≤0.1.5）保留 register/get/update 三件套，
 * 0.1.7+ 换成 describe/update/mutate（**没有 register**）。两代都必须咬合：
 *
 *  - 老线：register 注册 plain schema → get 读文档 → update 合并写；
 *  - 现代线：describe() 的 ns 是 **profile entry id**（本包 `dsh-manage-session`）
 *    → 同 ns 行的 value 即权威投影 → update 合并写（不传 expectedRevision）。
 *
 * 2026-11 实锤：现代线原来只按 `register` 判定咬合，桥永远空 → settings-describe
 * 报 writable=false → 设置卡整片禁用（宿主 provider 的 writable 恒 true，只读
 * 从来不是宿主给的，是本插件自己的缺陷）。
 *
 * 设置命名空间只有一个：`manage-session`（搜索子域已拆回 dsh-search-index，
 * 搜索字段与命名空间不在本包）。schema 必须
 * **纯 plain**（不 withVolatile）—— volatile 节点会被 legacy register 拒收
 * （`$.enabled expected boolean`，TL beta.18 教训）。
 *
 * 同一 settings 服务上重复 apply（HMR/双 loader 行）的防重：Symbol.for 键挂
 * 在服务对象上（cordis 同服务的所有代理共享该属性，cci 租约同款），首见者
 * 注册，后来者直接共享。
 */
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_CONFIG,
  STEWARD_ENTRY_ID,
  STEWARD_SETTINGS_NAMESPACE,
} from '../config.ts'

/** 老宿主 settings 服务面（结构化镜像，绝不 value-import 官方包）。 */
export interface LegacySettingsFace {
  register?: (ns: string, schema: unknown) => unknown
  get?: (ns: string) => unknown
  update?: (ns: string, patch: Record<string, unknown>) => Promise<unknown>
  /** 0.1.7+ 读面：每个 ACTIVE entry 一行（`{ ns, value, revision, … }`）。 */
  describe?: () => unknown
  /** 0.1.7+ 逐字段写面（`update` 缺席时兜底）。 */
  mutate?: (ns: string, ops: unknown[], expectedRevision?: number) => Promise<unknown>
}

/** 桥对 handleMethod 暴露的面。 */
export interface LegacySettingsBridge {
  /** 读一个命名空间文档（无文档/非对象 → undefined）。 */
  get(ns: string): Record<string, unknown> | undefined
  /** 合并写一个命名空间文档；宿主拒绝时抛错（调用方转显式失败）。 */
  update(ns: string, patch: Record<string, unknown>): Promise<void>
}

const SHARED_LEASE = Symbol.for('dsh-manage-session/legacy-settings-bridge')

/** 宿主 describe() 的一行（现代线的 ns = profile entry id）。 */
interface DescribeRow {
  ns?: unknown
  value?: unknown
}

/** 逻辑命名空间 → 宿主 ns 的候选表（顺序即优先级；现代线在前）。 */
const HOST_NS_CANDIDATES: readonly string[] = [STEWARD_ENTRY_ID, STEWARD_SETTINGS_NAMESPACE]

/** 管理命名空间 schema（纯 plain，无 volatile —— 老线 register 拒收 volatile 节点）。 */
const StewardNsSchema = z.object({
  enabled: z.boolean().default(true),
  historyFiles: z.boolean().default(true),
  healthCheck: z.boolean().default(true),
  directDelete: z.boolean().default(false),
  columns: z.number().default(3),
})

/** settings.get 返回值是否像一份文档（老宿主对未写过的 ns 可能回 undefined）。 */
function asDoc(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 读一次宿主 describe（不可读 / 抛错 = 空表；桥的任何失败都不许拖死插件树）。 */
function describeRows(settings: LegacySettingsFace): DescribeRow[] {
  if (typeof settings.describe !== 'function') return []
  try {
    const rows = settings.describe()
    return Array.isArray(rows) ? (rows as DescribeRow[]) : []
  } catch {
    return []
  }
}

/**
 * 现解析宿主 ns 与它的权威文档。
 *
 * **不许缓存**：现代线的 ns 是 profile entry id（`dsh-manage-session`），老线是
 * `manage-session`；而且本插件自己那一行在 apply 期可能还没 ACTIVE（宿主 describe
 * 只列 ACTIVE entry），锁死一次就会永久落空。
 */
function resolveHostDoc(
  settings: LegacySettingsFace,
): { ns: string; value: Record<string, unknown> } | undefined {
  const rows = describeRows(settings)
  for (const ns of HOST_NS_CANDIDATES) {
    const doc = asDoc(rows.find((row) => row?.ns === ns)?.value)
    if (doc !== undefined) return { ns, value: doc }
  }
  return undefined
}

/**
 * 咬合两代宿主；返回**同步创建的可变 holder**，桥面在 `ctx.inject(['settings'], …)`
 * 回调里填入（cordis 作用域注入——settings 服务只在回调的 sctx 上可见，
 * `ctx.get('settings')` 在 0.1.0 拿不到）。
 *
 * 重复 apply 经 Symbol 租约只注册一次 schema；回调体内全部 try/catch——桥的任何
 * 失败都不允许拖死插件树（0.1.0 实机教训：严格 ctx 上裸属性读即 fatal）。
 */
export function installLegacySettingsBridge(ctx: unknown): BridgeState {
  const state: BridgeState = { bridge: undefined, revision: 0 }
  const injectFn = (ctx as {
    inject?: (deps: string[], fn: (sctx: { settings?: LegacySettingsFace }) => void) => void
  }).inject
  if (typeof injectFn !== 'function') return state
  try {
    injectFn.call(ctx, ['settings'], (sctx) => {
      try {
        const settings = sctx?.settings
        if (settings === undefined || settings === null) return
        // 咬合条件=「有写入口」：update（两代都有）或 0.1.7+ 的 mutate。
        // 无写入口 = 真只读，保持空桥（settings-describe 落运行时投影 + writable=false）。
        if (typeof settings.update !== 'function' && typeof settings.mutate !== 'function') return
        // 老线专属：register 在就先注册 plain schema（现代宿主没有这个方法）。
        if (typeof settings.register === 'function') {
          const carrier = settings as LegacySettingsFace & { [SHARED_LEASE]?: true }
          if (carrier[SHARED_LEASE] !== true) {
            settings.register(STEWARD_SETTINGS_NAMESPACE, StewardNsSchema)
            try {
              Object.defineProperty(carrier, SHARED_LEASE, {
                configurable: false,
                enumerable: false,
                writable: false,
                value: true,
              })
            } catch {
              /* 服务对象冻结时无法钉标记：退化为可能重复注册（幂等宿主无碍） */
            }
          }
        }
        state.bridge = {
          get: (ns) => {
            // 现代线：describe 同 ns 行的 value 是权威投影（含缺省），优先它。
            const modern = resolveHostDoc(settings)
            if (modern !== undefined) return modern.value
            // 老线（及 describe 尚未覆盖本 entry 时）：回落 settings.get。
            try {
              return asDoc(settings.get?.(ns))
            } catch {
              return undefined
            }
          },
          update: async (ns, patch) => {
            const target = resolveHostDoc(settings)?.ns ?? ns
            if (typeof settings.update === 'function') {
              // 不传 expectedRevision：宿主在 undefined 时跳过 revision 比对，
              // 面板开着连写不会撞 SettingsConflictError。
              await settings.update(target, patch)
              return
            }
            const mutate = settings.mutate
            if (typeof mutate !== 'function') throw new Error('宿主 settings 服务没有写入口')
            const ops = Object.entries(patch).map(([field, value]) => ({ op: 'set', path: [field], value }))
            await mutate(target, ops, undefined)
          },
        }
      } catch (err) {
        console.log(`[dsh-manage-session] legacy settings bridge FAILED (cards degrade to read-only): ${String(err instanceof Error ? err.message : err)}`)
      }
    })
  } catch {
    /* ctx 无 inject（异常宿主）：保持空桥 */
  }
  return state
}

/** 单字段校验器：通过返回清洗后的值，否则返回错误文案。 */
type FieldVerdict = { ok: true; value: unknown } | { ok: false; error: string }

function asBoolean(v: unknown): FieldVerdict {
  return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: '期望布尔值' }
}

/** 列数校验：1–6 的整数（越界/非整数一律拒绝，不静默夹值）。 */
function asColumns(v: unknown): FieldVerdict {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 6) {
    return { ok: false, error: '期望 1–6 的整数' }
  }
  return { ok: true, value: v }
}

/** 各命名空间允许写入的字段与校验（未列出的字段一律拒绝——桥不是任意写缝）。 */
const FIELD_VALIDATORS: Record<string, Record<string, (v: unknown) => FieldVerdict>> = {
  [STEWARD_SETTINGS_NAMESPACE]: {
    enabled: asBoolean,
    historyFiles: asBoolean,
    healthCheck: asBoolean,
    directDelete: asBoolean,
    columns: asColumns,
  },
}

/** 两份命名空间文档（describe/mutate 响应的统一形状）。 */
export interface BridgeNamespaces {
  [STEWARD_SETTINGS_NAMESPACE]: Record<string, unknown>
}

/** 桥运行时状态（revision 随每次成功写自增，客户端据此识别权威新值）。 */
export interface BridgeState {
  bridge: LegacySettingsBridge | undefined
  revision: number
}

/** 汇总两份命名空间文档：legacy 读盘上文档合并缺省；modern 返回空投影（writable=false）。 */
export function describeNamespaces(state: BridgeState): BridgeNamespaces {
  const { bridge } = state
  if (bridge !== undefined) {
    return {
      [STEWARD_SETTINGS_NAMESPACE]: { ...DEFAULT_CONFIG, ...(bridge.get(STEWARD_SETTINGS_NAMESPACE) ?? {}) },
    }
  }
  return { [STEWARD_SETTINGS_NAMESPACE]: {} }
}

/**
 * 运行时叠加文档（≤0.1.5 专用，3085 实锤补口）：卡写路径落宿主 settings
 * 服务，而组合入口 config 是静态缺省——不叠加则开关「拨得动、不生效」。
 * 与 describe 不同：**不铺缺省**，只回两 ns 的原始已写键（盘上 settings.yaml
 * 实测只含被拨过的键，未写键缺席→自然回退组合 config）。
 */
export interface BridgeOverlayDocs {
  /** manage-session ns 原始已写文档（桥未咬合时 = {}）。 */
  steward: Record<string, unknown>
}

export function bridgeOverlay(state: BridgeState): BridgeOverlayDocs {
  const { bridge } = state
  if (bridge === undefined) return { steward: {} }
  return {
    steward: bridge.get(STEWARD_SETTINGS_NAMESPACE) ?? {},
  }
}

/** describe 响应。 */
export function settingsDescribe(state: BridgeState): {
  ok: boolean
  namespaces: BridgeNamespaces
  writable: boolean
  revision: number
} {
  return {
    ok: true,
    namespaces: describeNamespaces(state),
    writable: state.bridge !== undefined,
    revision: state.revision,
  }
}

/** mutate 请求载荷形状。 */
export interface MutatePayload {
  ns?: unknown
  fields?: unknown
}

/** 合并写一个命名空间；任何校验/宿主拒绝都显式失败，成功回权威文档。 */
export async function settingsMutate(
  state: BridgeState,
  payload: unknown,
): Promise<{ ok: boolean; error?: string; namespaces?: BridgeNamespaces; revision?: number }> {
  if (state.bridge === undefined) {
    return { ok: false, error: '本宿主没有可用的设置写入口（既无 legacy register，也无 update/mutate），桥不可写' }
  }
  const request = (payload ?? {}) as MutatePayload
  if (typeof request.ns !== 'string' || !(request.ns in FIELD_VALIDATORS)) {
    return { ok: false, error: `未知设置命名空间：${String(request.ns)}` }
  }
  if (request.fields === null || typeof request.fields !== 'object' || Array.isArray(request.fields)) {
    return { ok: false, error: 'fields 必须是对象' }
  }
  const validators = FIELD_VALIDATORS[request.ns]
  const clean: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(request.fields as Record<string, unknown>)) {
    const validate = validators[field]
    if (validate === undefined) return { ok: false, error: `命名空间 ${request.ns} 不接受字段 "${field}"` }
    const verdict = validate(value)
    if (!verdict.ok) return { ok: false, error: `${field}: ${verdict.error}` }
    clean[field] = verdict.value
  }
  if (Object.keys(clean).length === 0) return { ok: false, error: 'fields 为空' }
  try {
    await state.bridge.update(request.ns, clean)
  } catch (err) {
    return { ok: false, error: `宿主拒绝写入：${String(err instanceof Error ? err.message : err)}` }
  }
  state.revision += 1
  return { ok: true, namespaces: describeNamespaces(state), revision: state.revision }
}
