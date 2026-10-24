/**
 * 会话管理客户端半身：样式、字典、侧栏入口（顶栏工具槽 / 底栏回落）与设置卡。
 *
 * 入口只有一个（会话管理）：点开是「管理 / 体检」双页签。搜索子域已拆回
 * dsh-search-index —— 本文件不再注册搜索入口、搜索面板或搜索设置卡。
 *
 * 入口位次由宿主能力决定（inject 探测两席位）：
 * - 顶栏工具行（`sidebar.panellist` 面板行 + `main` 整页槽）→ 面板行落在「插件」
 *   之后、「更多」之前，点击在主栏整页打开；
 * - 无该槽位（老线）→ 回落底栏 `sidebar.footer.action`，点击开对话框。
 *
 * 开关读取：configForms（0.1.7，entry id 键）/ legacy 宿主走自家 webServer 设置桥
 * （settingsScope.bind 是数据死路，见 bridge-scope.ts）；配置写入同链路。
 */
import type { Context } from 'cordis'
import { createElement, useState, useSyncExternalStore, type ReactElement } from 'react'
import {
  DEFAULT_CONFIG,
  STEWARD_ENTRY_ID,
  STEWARD_SETTINGS_NAMESPACE,
  type StewardConfig,
} from '../config.ts'
import { StewardCardScope, StewardSettingsCard, type CardTranslate } from './card.tsx'
import { stewardBridgeScope, withBridgeFallback, type BridgeScope } from './bridge-scope.ts'
import { dictionaries, translate, type LocaleKey } from './locales.ts'
import { StewardFooter, StewardPanel, TAB_HEALTH } from './panel.tsx'
import { openSessionThrough } from './host-api.ts'
import {
  SESSION_MENU_DELETE_ID, SESSION_MENU_DELETE_ORDER, SESSION_MENU_SEAT, StewardDeleteMenuItem,
} from './session-menu.tsx'
import {
  installLegacySessionMenuDelete, makeDirectDeleteProbe, purgeSessionById,
} from './session-menu-legacy.ts'

export { STEWARD_ENTRY_ID, STEWARD_SETTINGS_NAMESPACE, TAB_HEALTH }
export { translate } from './locales.ts'

/** 字典命名空间（locale.register 用）。 */
export const NS = 'dsh-manage-sessions'

/** 槽位服务面（结构化镜像）。 */
interface StewardSlotsService {
  inject(name: string, callback: () => unknown, label?: string): () => void
  register(config: Record<string, unknown>, component: unknown): unknown
  entries(name: string): Array<{ options: { id?: string; key?: string; order?: number; label?: unknown } }>
  getVersion(name: string): number
  subscribe(name: string, listener: () => void): () => void
  /** 槽位声明探测（部分宿主暴露；仅诊断用）。 */
  specDynamic?(name: string): unknown
}

/** locale 服务面。 */
interface StewardLocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
}

/** configForms 服务面（0.1.7：以 profile entry id 取句柄）。 */
interface StewardConfigForms {
  get<U>(entryId: string): StewardCardScope & { getSnapshot(): { value: U | undefined } }
}

/** 客户端插件声明的注入面。 */
export const inject = ['slots', 'locale']

/** 侧边栏入口的 props（结构子集）。 */
export interface StewardFooterProps {
  /** 侧边栏是否渲染宽栏内容（false = 56px 收起轨道）。 */
  wide?: boolean
  onClick?: () => void
  title?: string
}

/** 注入样式（幂等）。 */
function injectStyles(): () => void {
  const id = 'dsh-manage-sessions-styles'
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(id) !== null) return () => {}
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
/* 侧栏 footer 槽位公约（2026-09-26；2026-10-01 收紧行距并强制居中）：一行多
   入口（第三方 dsh-context 等）会互相挤占 —— 宿主 .footerActions 是 nowrap
   flex 行。这里允许容器换行，并把本插件入口钉成独占一整行（flex-basis:100%）；
   其余入口（含第三方）自然落到后续行，各行内部自行布局，谁也不挤谁。
   justify-content:center 让行内所有入口（含不占满行的）统一居中；row-gap:0
   配合入口自身 32px 高度压缩纵向占位。类名用 [class*=] 中段匹配：宿主是 CSS
   Module 哈希类名（实测形如 hHd-Xa_footerActions —— <hash>_<name>，哈希在前），
   中段跨版本稳定。 */
[class*="footerActions"]{flex-wrap:wrap;justify-content:center;row-gap:0;height:auto;min-height:0}
/* —— 第三方矫正：dsh-context「上下文洞察」入口（2026-10-01）——
   .lc-ov-entry 按"独占整行"设计（width:calc(100% + 4px)、无 justify-content、
   42px 高、不对称 padding），与本槽位公约（每个入口独占一行、行内居中、32px）
   冲突，表现为文字靠左、纵向松散。这里按公约强制矫正；:not() 排除收起轨道的
   36px 圆钮形态。lc-ov-* 是 dsh-context 源码硬编码类名（非构建哈希），跨版本
   稳定（实测 0.56.1 / 0.60.0 规则一致）。两个自有插件各自携带同一矫正块：
   任一被禁用时矫正仍生效。 */
.lc-ov-entry:not(.lc-ov-entry-rail){width:auto!important;flex:0 0 100%!important;min-width:0!important;justify-content:center!important;height:32px!important;margin:0!important;padding:0 10px!important}
.lc-ov-entry-label{flex:0 1 auto!important}
/* 宽栏：独占一整行、放弃主动收缩（flex-shrink:0），行内居中；收起轨道回落自然宽度。 */
.dms_entryWrap{flex:0 1 auto;display:inline-flex;align-items:center;min-width:0}
.dms_entryWrapWide{flex:0 0 100%;width:100%;justify-content:center;margin-left:0}
/* 高度 32px（内容 22px 行高 + 上下各 5px）：宿主默认 42px 的上下裕度在多行
   堆叠后过于松散；左右内边距对称（10px/10px），否则整行居中时按钮内容会因
   不对称 padding 向左偏 1px。 */
.dms_footerEntry{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:32px;padding:0 10px;border:none;border-radius:12px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;white-space:nowrap;overflow:hidden;transition:background-color 160ms ease-out,color 160ms ease-out}
.dms_footerEntry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dms_footerEntryRail{width:28px;height:28px;padding:0;gap:0;border-radius:50%}
.dms_footerIcon{flex:none;font-size:15px;line-height:1}
.dms_footerLabel{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dms_backdrop{position:fixed;inset:0;background:rgba(15,20,30,.42);z-index:1000}
.dms_panel{position:fixed;z-index:1001;left:50%;top:6vh;transform:translateX(-50%);width:min(860px,94vw);max-height:86vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.18);padding:10px 14px 14px}
/* 整页形态（顶栏工具行入口）：取消浮动定位与遮罩观感，填满主栏。 */
.dms_panel.dms_panelPage{position:relative;left:auto;top:auto;transform:none;z-index:auto;width:100%;max-width:none;height:100%;max-height:none;box-sizing:border-box;border:none;border-radius:0;box-shadow:none;background:transparent;padding:14px 18px 16px}
.dms_dialogHead{display:flex;align-items:center;gap:10px;min-height:34px}
.dms_dialogTitle{font-weight:600;color:var(--dsw-alias-label-primary,#111827);flex:1 1 auto;min-width:0}
.dms_tabRow{display:inline-flex;gap:4px}
.dms_tab{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;border-radius:8px;padding:3px 10px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dms_tabActive{background:var(--dsw-alias-interactive-bg-active,rgba(63,99,216,.12));color:var(--dsw-alias-label-primary,#111827)}
.dms_tabBody{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.dms_actBtn{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary,#111827)}
.dms_actBtn:disabled{opacity:.5;cursor:default}
.dms_btnRow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dms_list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.dms_row{display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:8px;border:1px solid transparent}
.dms_row:hover{border-color:var(--dsw-alias-border-l2,#e5e7eb)}
.dms_meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dms_uuid{font-family:var(--ds-font-family-code,monospace)}
/* 按行的磁盘占用：右对齐、不参与标题压缩，方便纵向比对「哪条最占地方」。 */
.dms_status{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.dms_error{font-size:12px;color:var(--dsw-alias-state-error-primary,#dc2626)}
.dms_empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#9ca3af);padding:10px 2px}
.dms_gateList{display:flex;flex-direction:column;gap:6px}
.dms_gate{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;padding:6px 10px}
.dms_gateName{font-weight:600;font-size:12px}
.dms_gateEvidence{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);flex:1 1 100%}
.dms_levelPill{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid transparent}
.dms_level_ok{background:rgba(22,163,74,.12);color:#15803d}
.dms_level_warn{background:rgba(217,119,6,.14);color:#b45309}
.dms_level_fail{background:rgba(220,38,38,.14);color:#b91c1c}
.dms_level_skipped{background:rgba(107,114,128,.14);color:#4b5563}
.dms_progressRow{display:flex;align-items:center;gap:8px;margin-top:2px}
.dms_progressTrack{flex:1;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#eef0f3);overflow:hidden}
.dms_progressFill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,#3d5be0);transition:width .2s ease}
.dms_progressIndeterminate{width:35%;animation:dssSlide 1.1s ease-in-out infinite}
.dms_why{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);flex:1;min-width:0}
.dms_cacheRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.dms_spinner{width:11px;height:11px;margin-right:6px;border-radius:50%;display:inline-block;vertical-align:-1px;border:2px solid currentColor;border-top-color:transparent;animation:dssSpin .7s linear infinite}
@keyframes dssSpin{to{transform:rotate(360deg)}}
@keyframes dssSlide{0%{margin-left:-35%}100%{margin-left:100%}}
@media (prefers-reduced-motion:reduce){.dms_spinner{animation:none}.dms_progressIndeterminate{animation:none;width:100%;opacity:.5}.dms_setChev{transition:none}.dms_setCard{transition:none}}
.dms_verdict{font-size:12px;line-height:18px;border-radius:8px;padding:6px 10px;margin-top:6px;border:1px solid transparent}
.dms_verdict_repaired{background:rgba(22,163,74,.10);color:#15803d;border-color:rgba(22,163,74,.28)}
.dms_verdict_repaired-with-residual{background:rgba(217,119,6,.10);color:#b45309;border-color:rgba(217,119,6,.28)}
.dms_verdict_nothing-to-do{background:rgba(107,114,128,.10);color:#4b5563;border-color:rgba(107,114,128,.28)}
.dms_verdict_not-applicable{background:rgba(107,114,128,.10);color:#4b5563;border-color:rgba(107,114,128,.28)}
.dms_verdict_failed{background:rgba(220,38,38,.10);color:#b91c1c;border-color:rgba(220,38,38,.28)}
.dms_phaseRow{display:flex;gap:8px;align-items:center}
.dms_phase{font-weight:600;font-size:12px}
.dms_cmdBlock{display:flex;flex-direction:column;gap:4px;border:1px dashed var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;padding:6px 8px}
.dms_cmdLine{display:flex;gap:6px;align-items:center}
.dms_cmd{flex:1 1 auto;font-family:var(--ds-font-family-code,monospace);font-size:11px;white-space:pre-wrap;word-break:break-all}
.dms_setCard{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.05));border-radius:12px;transition:border-color .16s,background .16s}
.dms_setHead{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}
.dms_setHeadText{display:flex;flex-direction:column;gap:2px;flex:1 1 0%;min-width:0}
.dms_setCardTitle{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#111827)}
.dms_setCardDesc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dms_setChev{color:var(--dsw-alias-label-tertiary,#9ca3af);flex:0 0 auto;transition:transform .16s}
.dms_setCardOpen .dms_setChev{transform:rotate(180deg)}
.dms_setBody{display:flex;flex-direction:column;gap:2px;padding:0 16px 12px}
.dms_setRow{display:flex;align-items:center;gap:10px;padding:6px 0}
.dms_setText{display:flex;flex-direction:column;flex:1 1 auto;min-width:0}
.dms_setTitle{font-size:13px;color:var(--dsw-alias-label-primary,#111827)}
.dms_setDesc{font-size:12px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dms_toggle{display:inline-flex;align-items:center;cursor:pointer;position:relative}
.dms_toggle input{position:absolute;opacity:0;width:0;height:0}
.dms_toggleTrack{width:34px;height:18px;border-radius:999px;background:var(--dsw-alias-border-l2,#d1d5db);position:relative;transition:background .15s ease}
.dms_toggleKnob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s ease}
.dms_toggleOn .dms_toggleTrack{background:var(--dsw-alias-button-primary-fill,#3f63d8)}
.dms_toggleOn .dms_toggleKnob{left:18px}
`
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * 客户端插件主体。
 * @param ctx - 客户端上下文（slots、可选 locale / configForms）。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => injectStyles(), 'dsh-manage-sessions: stylesheet')

  const locale = ctx.get('locale') as StewardLocaleService | undefined
  if (locale !== undefined && typeof locale.register === 'function') {
    ctx.effect(() => locale.register(NS, dictionaries), 'dsh-manage-sessions: dictionaries')
  }

  // 数据面回退链（台账 A2 定案 + 0.1.7 实测补丁）：首选 configForms 原生句柄
  // （entry id 键），**渲染期**观测到 unavailable（出生死或 loading→死，A2 死
  // 路签名）就地落桥——自家 webServer 设置桥（settings-describe/mutate）。
  const configForms = ctx.get('configForms') as StewardConfigForms | undefined
  const bound = withBridgeFallback(
    configForms?.get<StewardConfig>(STEWARD_ENTRY_ID) as BridgeScope<StewardConfig> | undefined,
    stewardBridgeScope(),
  )

  const slots = ctx.get('slots') as StewardSlotsService | undefined
  if (slots === undefined) return

  // 管理台行点击打开会话：click 时经 openSessionThrough 解析（uiWorkspace.openSession
  // 0.1.7+ 优先，旧宿主回退 sessions.open）—— 应用序早于导航模块，必须惰性取。
  const openSession = (sessionId: string): void => {
    openSessionThrough((name) => ctx.get(name), sessionId)
  }

  // 顶栏页的关闭动作：回退到会话（layout 服务惰性取——装载序不保证）。
  const closeToolPanel = (): void => {
    try {
      const layout = ctx.get('layout') as { selectPanel?: (id: string | null) => void } | undefined
      layout?.selectPanel?.(null)
    } catch {
      /* 布局服务缺席：页面保留，用户可点「会话」行返回 */
    }
  }

  // 侧栏入口（一枚）——**位次由宿主能力决定**：顶栏工具行 or 底栏回落。
  // 席位能力用 inject 探测（席位被声明时才回调），不依赖 spec 查询。
  ctx.effect(() => {
    let rowSeat = false
    let mainSeat = false
    let footerOff: (() => void) | undefined
    let topOff: (() => void) | undefined

    const sync = (): void => {
      const topReady = rowSeat && mainSeat
      if (topReady && topOff === undefined) {
        if (footerOff !== undefined) { const off = footerOff; footerOff = undefined; off() }
        topOff = mountTopToolEntries(slots, bound, openSession, closeToolPanel)
        return
      }
      if (!topReady && footerOff === undefined && topOff === undefined) {
        footerOff = mountFooterEntries(slots, bound, openSession)
      }
    }

    // 接线期不让 probe 回调触发 sync：两席位先后落位时先到的会误判「顶栏不齐」。
    let wired = false
    const onSeat = (): void => { if (wired) sync() }

    const offRowProbe = slots.inject(TOP_TOOL_SEAT, () => {
      rowSeat = true
      onSeat()
      return () => { rowSeat = false }
    }, 'dsh-manage-sessions: probe top tool seat')

    const offMainProbe = slots.inject(MAIN_SEAT, () => {
      mainSeat = true
      onSeat()
      return () => { mainSeat = false }
    }, 'dsh-manage-sessions: probe main page seat')

    wired = true
    sync()

    return () => {
      offRowProbe()
      offMainProbe()
      if (footerOff !== undefined) { const off = footerOff; footerOff = undefined; off() }
      if (topOff !== undefined) { const off = topOff; topOff = undefined; off() }
    }
  }, 'dsh-manage-sessions: sidebar entry')

  // 插件族共用设置 tab（dsh-thinking-levels 的顶级「起子插件设置」节声明该子席位）。
  // thinking-levels 缺席时本 inject 静默等待，不阻塞客户端半。
  slots.inject('dsh-family.tab', () => slots.register(
    {
      name: 'dsh-family.tab',
      id: STEWARD_ENTRY_ID,
      order: 40,
      // 账本 label：读期求值，跟随当前 locale（translate 内建 zh/en 兜底）。
      label: () => translate((locale as { bind?: (n: string) => CardTranslate } | undefined)?.bind?.(NS), 'card.title'),
      locale: NS,
    },
    (props: { t?: CardTranslate }) => createElement(StewardSettingsCard, {
      scope: bound as StewardCardScope,
      t: props.t,
    }),
  ), 'dsh-manage-sessions: family settings tab')

  // Plugins 页配置卡（`plugins.bundle.config`，key = 包名）：0.1.7 宿主的 Plugins
  // 页只渲染 key 与包名相等的条目。
  slots.inject('plugins.bundle.config', () => slots.register(
    { name: 'plugins.bundle.config', key: STEWARD_ENTRY_ID },
    (props: { t?: CardTranslate }) => createElement(StewardSettingsCard, {
      scope: bound as StewardCardScope,
      t: props.t,
    }),
  ), 'dsh-manage-sessions: plugins page config card')

  // 侧栏会话菜单删除臂（按左侧边栏换代识别）：席位自 0.1.7 存在，本行 order=500
  // 落末位；≤0.1.5 菜单写死无席位 → inject 静默等待，删除入口由 DOM 注入臂承担。
  // 行可见性由组件自探针 directDelete（缺省关），非 true 不渲染。
  slots.inject(SESSION_MENU_SEAT, () => slots.register(
    { name: SESSION_MENU_SEAT, id: SESSION_MENU_DELETE_ID, order: SESSION_MENU_DELETE_ORDER, locale: NS },
    StewardDeleteMenuItem,
  ), 'dsh-manage-sessions: session menu delete row')

  // 老线（≤0.1.5）菜单无席位——DOM 注入臂补上删除行。
  if (typeof document !== 'undefined') {
    const probe = makeDirectDeleteProbe()
    ctx.effect(() => installLegacySessionMenuDelete({
      doc: document,
      purge: purgeSessionById,
      isEnabled: probe,
      lang: () => (typeof navigator !== 'undefined' ? navigator.language : undefined),
    }), 'dsh-manage-sessions: legacy session menu delete injector')
  }

  // 家族节宿主选举（次优先级）：宿主 dsh-thinking-levels 缺席时顶上「起子插件
  // 设置」节。下载量排名低于 session-guard → 宽限期更长，guard 先尝试接管；
  // guard 也缺席时本插件按同一 id `dsh-family` 接管。
  const familyTabsHooks = makeFamilyTabsHooks(slots)
  ctx.effect(() => {
    let claimed: unknown
    const timer = setTimeout(() => {
      if (slots.entries('settings.section').some(e => e.options.id === FAMILY_SECTION_ID)) return
      try {
        claimed = slots.register({
          name: 'settings.section',
          id: FAMILY_SECTION_ID,
          order: 40,
          label: () => translate((locale as { bind?: (n: string) => CardTranslate } | undefined)?.bind?.(NS), 'family.title'),
          locale: NS,
          inject: () => ({ hooks: { tabs: familyTabsHooks } }),
          children: { [FAMILY_CHILD_KEY]: { kind: 'list', scope: 'root' } },
        }, StewardFamilySection)
      } catch {
        // 并发接管竞争落败（或设置壳未声明席位）：胜出方的节服务整个家族。
      }
    }, FAMILY_HOST_GRACE_MS)
    return () => { clearTimeout(timer); if (typeof claimed === 'function') (claimed as () => void)() }
  }, 'dsh-manage-sessions: family fallback host')
}

/** 家族节固定 id（与 thinking-levels / guard 的注册严格一致）。 */
const FAMILY_SECTION_ID = 'dsh-family'
/** 家族子席位 key（与 thinking-levels 的声明严格一致）。 */
const FAMILY_CHILD_KEY = 'dsh-family.tab'
/** 家族容器接管分级——唯一真源 `mine-dsh-plugins/_tools/family-rank.mjs`（离线实测
 * GitHub star + npm 周下载量加权）。延迟 = BASE + RANK * STEP。 */
const FAMILY_CLAIM_RANK = 3
const FAMILY_CLAIM_BASE_MS = 200
const FAMILY_CLAIM_STEP_MS = 900
/** 接管宽限期（由分级派生）。 */
const FAMILY_HOST_GRACE_MS = FAMILY_CLAIM_BASE_MS + FAMILY_CLAIM_RANK * FAMILY_CLAIM_STEP_MS

/** 接管节的账本投影 hooks（与 thinking-levels 的 FamilySectionInjected 同形）。 */
function makeFamilyTabsHooks(slots: StewardSlotsService): {
  getSnapshot: () => readonly FamilyTabEntry[]
  subscribe: (listener: () => void) => () => void
} {
  let version = -1
  let tabs: readonly FamilyTabEntry[] = []
  return {
    getSnapshot: () => {
      const next = slots.getVersion(FAMILY_CHILD_KEY)
      if (next !== version) {
        version = next
        tabs = slots.entries(FAMILY_CHILD_KEY)
          .map(entry => ({
            id: entry.options.id ?? '',
            order: entry.options.order ?? 0,
            label: typeof entry.options.label === 'function'
              ? (() => { try { return String((entry.options.label as () => unknown)() ?? entry.options.id ?? '') } catch { return String(entry.options.id ?? '') } })()
              : String(entry.options.label ?? entry.options.id ?? ''),
          }))
          .sort((a, b) => a.order - b.order)
      }
      return tabs
    },
    subscribe: (listener: () => void) => slots.subscribe(FAMILY_CHILD_KEY, listener),
  }
}

/** 账本条目（id/order/label，label 已解析为字符串）。 */
interface FamilyTabEntry {
  id: string
  order: number
  label: string
}

/** 家族节接管组件：纯通用渲染——把 `dsh-family.tab` 账本里的每张贡献卡按 order 渲染。 */
function StewardFamilySection(props: {
  renderSlot: (key: string, owner?: object, opts?: { only?: string; fallback?: unknown }) => unknown
  hooks: { tabs: { getSnapshot: () => readonly FamilyTabEntry[]; subscribe: (listener: () => void) => () => void } }
}): ReactElement {
  const tabs = useSyncExternalStore(props.hooks.tabs.subscribe, props.hooks.tabs.getSnapshot)
  return createElement('div', { style: { display: 'grid', gap: '12px' } },
    ...tabs.map(row => createElement('div', { key: row.id },
      props.renderSlot(FAMILY_CHILD_KEY, {}, { only: row.id, fallback: null }) as ReactElement,
    )),
  )
}

/** 入口按钮：持有面板开关；两个页签的可见性来自配置快照。 */
export function StewardEntry(
  props: StewardFooterProps & {
    scope?: (StewardCardScope & { getSnapshot(): { value: StewardConfig | undefined } }) | undefined
    openSession?: (sessionId: string) => void
  },
): ReactElement {
  const [open, setOpen] = useState(false)
  const snapshot = useSyncExternalStore(
    (listener) => (props.scope !== undefined ? props.scope.subscribe(listener) : () => {}),
    () => (props.scope !== undefined ? props.scope.getSnapshot() : { value: DEFAULT_CONFIG }),
  )
  const config: StewardConfig = { ...DEFAULT_CONFIG, ...(snapshot.value ?? {}) }
  const healthCheck = config.healthCheck !== false
  const visible = config.enabled !== false && healthCheck
  const wide = props.wide === true
  // 入口文案与面板标题同源：字典是唯一出处，组件不再持有兜底中文。
  const label = translate(undefined, 'panel.title')

  if (!visible) return createElement('span', { className: 'dms_entryWrap' })
  return createElement('span', { className: wide ? 'dms_entryWrap dms_entryWrapWide' : 'dms_entryWrap' }, [
    createElement(StewardFooter, {
      key: 'btn',
      title: label,
      label,
      wide,
      onClick: () => { setOpen(!open) },
    }),
    open
      ? createElement(StewardPanel, {
        key: 'panel',
        healthCheck,
        openSession: props.openSession,
        onClose: () => { setOpen(false) },
      })
      : null,
  ])
}

/* ------------------------------------------------ 侧栏入口位次（顶栏工具槽 / 底栏） */

/**
 * 顶栏工具槽位：面板行列表。宿主在「插件」（order 0）与「更多」启动器之间渲染
 * 这些行，行内 icon + label 默认左对齐；点击切换主栏面板。
 */
const TOP_TOOL_SEAT = 'sidebar.panellist'
/** 主栏整页槽位（keyed）：面板行点击后在此渲染整页内容。 */
const MAIN_SEAT = 'main'
/** 管理台页 id（同时作为 `sidebar.panellist` 行的 id 与 `main` 的 key）。 */
const MANAGER_PANEL_ID = 'manage-sessions'

/**
 * 宿主是否提供顶栏工具槽位（诊断用）：面板行席位 + 主栏整页席位同时被声明才算。
 * 实际位次判定走 apply 内的 inject 探测（服务面不保证暴露 specDynamic）。
 * @param slots - 槽位服务面。
 * @returns 两席都已声明时 `true`。
 */
function hasPanelToolSeat(slots: StewardSlotsService): boolean {
  if (typeof slots.specDynamic !== 'function') return false
  try {
    return slots.specDynamic(TOP_TOOL_SEAT) !== undefined && slots.specDynamic(MAIN_SEAT) !== undefined
  } catch {
    return false
  }
}

export { hasPanelToolSeat }

/** 组合注销函数（逆序执行，幂等）。 */
function composeDisposers(offs: Array<() => void>): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    for (const off of offs.reverse()) {
      try { off() } catch { /* 单个席位解装失败不阻断其余回收 */ }
    }
  }
}

/**
 * 按开关状态维持一对注册（主栏页 + 面板行）。快照缺字段一律按「可见」处理。
 * @param scope - 设置 scope（缺失时视为缺省值）。
 * @param visible - 可见性判定。
 * @param mount - 可见时注册并返回注销函数。
 * @returns 解装函数。
 */
function gatedMount<V extends object>(
  scope: BridgeScope<V> | undefined,
  visible: (value: Partial<V>) => boolean,
  mount: () => () => void,
): () => void {
  let dispose: (() => void) | undefined
  const apply = (): void => {
    const value = (scope?.getSnapshot?.().value ?? {}) as Partial<V>
    const want = visible(value)
    if (want && dispose === undefined) dispose = mount()
    else if (!want && dispose !== undefined) {
      const off = dispose
      dispose = undefined
      off()
    }
  }
  apply()
  const unsubscribe = scope?.subscribe(apply)
  return () => {
    unsubscribe?.()
    if (dispose !== undefined) {
      const off = dispose
      dispose = undefined
      off()
    }
  }
}

/** 底栏回落形态（老宿主 / 无顶栏工具行）：一枚入口开对话框。 */
function mountFooterEntries(
  slots: StewardSlotsService,
  bound: BridgeScope<StewardConfig>,
  openSession: (sessionId: string) => void,
): () => void {
  const off = slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: STEWARD_ENTRY_ID, order: 6 },
    (props: StewardFooterProps) => createElement(StewardEntry, {
      ...props,
      scope: bound as unknown as StewardCardScope,
      openSession,
    }),
  ), 'dsh-manage-sessions: sidebar footer entry')
  return composeDisposers([off])
}

/**
 * 顶栏工具行形态：面板行（order 6，落在「插件」行之后、「更多」之前）加主栏整页。
 * 点击行 → 宿主 `selectPanel(id)` 在主栏渲染整页；页内关闭动作回退到会话。
 * @param closePanel - 关闭页回退动作（`layout.selectPanel(null)`）。
 */
function mountTopToolEntries(
  slots: StewardSlotsService,
  bound: BridgeScope<StewardConfig>,
  openSession: (sessionId: string) => void,
  closePanel: () => void,
): () => void {
  /** 管理页：管理台 / 体检 双页签，页签可见性与底栏入口同源。 */
  const ManagerPage = (): ReactElement => {
    const snapshot = useSyncExternalStore(
      (listener) => bound.subscribe(listener),
      () => bound.getSnapshot(),
    )
    const config: StewardConfig = { ...DEFAULT_CONFIG, ...(snapshot.value ?? {}) }
    return createElement(StewardPanel, {
      variant: 'page',
      healthCheck: config.healthCheck !== false,
      openSession,
      onClose: closePanel,
    })
  }

  const off = gatedMount(bound, value => value.enabled !== false && value.healthCheck !== false, () =>
    composeDisposers([
      slots.inject(MAIN_SEAT, () => slots.register(
        { name: MAIN_SEAT, key: MANAGER_PANEL_ID, locale: NS },
        ManagerPage,
      ), `dsh-manage-sessions: main page ${MANAGER_PANEL_ID}`),
      slots.inject(TOP_TOOL_SEAT, () => slots.register(
        {
          name: TOP_TOOL_SEAT,
          id: MANAGER_PANEL_ID,
          order: 6,
          label: () => translate(undefined, 'card.title'),
          locale: NS,
        },
        ManagerToolIcon,
      ), `dsh-manage-sessions: top tool row ${MANAGER_PANEL_ID}`),
    ]))

  return off
}

/** 顶栏行图标：会话管理（列表行 + 勾选，随行字色）。 */
function ManagerToolIcon({ size }: { size?: number }): ReactElement {
  const edge = size ?? 16
  return createElement('svg', {
    width: edge, height: edge, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
  },
  createElement('path', { d: 'M2 4h12M2 8h12M2 12h7', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' }),
  createElement('path', { d: 'M11.2 11.2l1.5 1.5 2.6-3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

/** 导出字典查找 type 供消费者复用。 */
export type { LocaleKey }
