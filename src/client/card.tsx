/**
 * 设置卡（插件配置行）：一个可折叠抽屉 —— 会话历史文件 / 健康检查。
 *
 * **chrome 必须自己渲染**：宿主不为贡献卡提供任何外壳，标题、说明、
 * 展开/收起全归插件自己所有。早期版本只渲染裸行，与同分区其它插件
 * 的抽屉形态不一致，还让 `card.title` / `card.desc` 成为死文案。
 *
 * 读写走 configForms（`configForms.get(STEWARD_ENTRY_ID)`，以本插件 entry 为键；
 * 旧宿主回退 settingsScope 绑定）的显式 `set`。
 *
 * **乐观回显（2026-11-26 用户报「开关不跟手」）**：原生 configForms 的 `set` 是
 * 「发请求 → 等宿主回镜像 → 才更新快照」，一个来回期间 UI 完全不动，拨了像没拨。
 * 本卡自带一层 pending 覆盖：控件立刻按新值渲染，权威快照追上后自动撤覆盖；
 * 写失败（宿主拒收）则撤覆盖回滚并以可见文案提示。
 *
 * 0.1.7 起本卡挂在插件族共用
 * 设置节（`dsh-family.tab`，dsh-thinking-levels 顶级「起子插件设置」节声明）里，
 * 与同节其它抽屉一样默认展开。
 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { DEFAULT_CONFIG, type StewardConfig } from '../config.ts'
import { translate, type LocaleKey } from './locales.ts'
import { mountStarRow } from './star-row-copy.ts'
import { COLUMN_CHOICES, normalizeColumns } from './columns.ts'

/** 卡片字典面。 */
export type CardTranslate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** 设置 scope 面（结构化镜像，与 toggle 的 SwitchCardScope 同形状）。 */
export interface StewardCardScope {
  getSnapshot(): {
    status: 'ready' | 'loading' | 'unavailable'
    value: StewardConfig | undefined
    revision?: number
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

/** 卡片入参。 */
export interface StewardCardProps {
  t?: CardTranslate
  scope: StewardCardScope
}

/** 一行设置项。 */
function Row(props: { title: string; desc?: string; control: JSX.Element }): JSX.Element {
  return createElement('div', { className: 'dms_setRow' }, [
    createElement('div', { key: 'text', className: 'dms_setText' }, [
      createElement('span', { key: 't', className: 'dms_setTitle' }, props.title),
      props.desc !== undefined && createElement('span', { key: 'd', className: 'dms_setDesc' }, props.desc),
    ]),
    createElement('div', { key: 'ctl' }, props.control),
  ])
}

/** 一个布尔开关（原生 checkbox 语义，样式由本插件 CSS 提供）。 */
function Toggle(props: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  return createElement('label', { className: `dms_toggle${props.checked ? ' dms_toggleOn' : ''}` }, [
    createElement('input', {
      key: 'i',
      type: 'checkbox',
      checked: props.checked,
      disabled: props.disabled === true,
      onChange: (event: { target: { checked: boolean } }) => { props.onChange(event.target.checked) },
    }),
    createElement('span', { key: 's', className: 'dms_toggleTrack' }, createElement('span', { className: 'dms_toggleKnob' })),
  ])
}

/** 抽屉头：标题 + 说明 + chevron，整块可点。 */
function Header(props: { t?: CardTranslate; open: boolean; onToggle: () => void }): JSX.Element {
  return createElement('button', {
    key: 'head',
    type: 'button',
    className: 'dms_setHead',
    'aria-expanded': props.open,
    onClick: props.onToggle,
  }, [
    createElement('span', { key: 'text', className: 'dms_setHeadText' }, [
      createElement('span', { key: 't', className: 'dms_setCardTitle' }, translate(props.t, 'card.title')),
      createElement('span', { key: 'd', className: 'dms_setCardDesc' }, translate(props.t, 'card.desc')),
    ]),
    createElement('svg', {
      key: 'chev',
      className: 'dms_setChev',
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      'aria-hidden': true,
    }, createElement('path', {
      d: 'M4 6l4 4 4-4',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })),
  ])
}

/** 面板常驻 star 快车道：挂载即建行，React 只负责给容器。 */
const mountStarRef = (node: HTMLDivElement | null): void => {
  if (node && !node.firstChild) node.appendChild(mountStarRow())
}

/** 插件设置卡主体（抽屉）。默认展开，family 设置节内直接呈现完整面板。 */
export function StewardSettingsCard({ t, scope }: StewardCardProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const [open, setOpen] = useState(true)
  const value: Partial<StewardConfig> = snapshot.value ?? {}
  const writable = snapshot.writable

  // —— 乐观回显 ——
  // pending：字段 → 用户刚拨成、但宿主还没确认的值；只覆盖「显示」，不改快照。
  // failedField：最近一次写失败的字段（显示一句提示，下一次操作即清）。
  const [pending, setPending] = useState<Record<string, unknown>>({})
  const [failedField, setFailedField] = useState<string | null>(null)

  /** 显示的字段值：pending 优先，否则取快照，最后落缺省。 */
  const shown = <K extends keyof StewardConfig>(field: K): StewardConfig[K] | undefined => {
    if (field in pending) return pending[field as string] as StewardConfig[K]
    const current = value[field]
    return current ?? DEFAULT_CONFIG[field]
  }

  // 权威快照追上 pending 的那一项就撤掉覆盖（否则会盖住之后来自别处的真实改动）。
  useEffect(() => {
    setPending((current) => {
      const fields = Object.keys(current)
      if (fields.length === 0) return current
      const next: Record<string, unknown> = {}
      let changed = false
      for (const field of fields) {
        if (snapshot.value !== undefined && (snapshot.value as unknown as Record<string, unknown>)[field] === current[field]) {
          changed = true
          continue
        }
        next[field] = current[field]
      }
      return changed ? next : current
    })
  }, [snapshot.value])

  /** 写一个字段：先乐观上屏，失败则回滚并标记。 */
  const commit = (field: string, next: unknown): void => {
    setFailedField(null)
    setPending((current) => ({ ...current, [field]: next }))
    void scope.set(field, next).catch(() => {
      // 宿主拒收：撤掉覆盖 = UI 弹回权威值，用户看得见失败。
      setPending((current) => {
        const nextPending = { ...current }
        delete nextPending[field]
        return nextPending
      })
      setFailedField(field)
    })
  }

  // 滑块：拖动过程只改本地草稿（不打网络），松手/失焦/键盘松开才落盘——
  // 否则一次拖动会轰出几十个写请求。
  const draftRef = useRef<number | null>(null)
  const sliderMove = (raw: string | number): void => {
    const next = normalizeColumns(raw)
    draftRef.current = next
    setPending((current) => ({ ...current, columns: next }))
  }
  const sliderCommit = (): void => {
    const next = draftRef.current
    if (next === null) return
    draftRef.current = null
    if (next === normalizeColumns(shown('columns'))) return
    commit('columns', next)
  }

  const rows: JSX.Element[] = []
  if (snapshot.status === 'unavailable') {
    // 拿不到设置服务：抽屉仍要在（否则这个插件在分区里彻底消失），只是里面说明原因。
    rows.push(createElement('div', { key: 'unavailable', className: 'dms_setDesc' }, translate(t, 'card.unavailable')))
  } else {
    rows.push(
      createElement(Row, {
        key: 'enabled',
        title: translate(t, 'card.enabled'),
        desc: translate(t, 'card.enabled.desc'),
        control: createElement(Toggle, {
          checked: shown('enabled') === true,
          disabled: !writable,
          onChange: (checked) => { commit('enabled', checked) },
        }),
      }),
      // 2026-10-20 养老院页签退场：historyFiles 开关不再暴露（配置字段保留，
      // 宿主侧历史文件能力/路由不动）。
      createElement(Row, {
        key: 'health',
        title: translate(t, 'card.health'),
        desc: translate(t, 'card.health.desc'),
        control: createElement(Toggle, {
          checked: shown('healthCheck') !== false,
          disabled: !writable,
          onChange: (checked) => { commit('healthCheck', checked) },
        }),
      }),
      // 直接删除入口（功能①，2026-10-20 用户定标）：缺省关——破坏性入口
      // 不默认铺开；开启后搜索面板行内出删除按钮（同款两步确认）。
      createElement(Row, {
        key: 'directDelete',
        title: translate(t, 'card.directDelete'),
        desc: translate(t, 'card.directDelete.desc'),
        control: createElement(Toggle, {
          checked: shown('directDelete') === true,
          disabled: !writable,
          onChange: (checked) => { commit('directDelete', checked) },
        }),
      }),
    )
    // 每行显示几个会话（1–6）：2026-11-26 用户定标改成**滑块**——六档按钮一排太占位，
    // 而且拖动能给出连续的档位反馈。1 列在 manage 里有专门的大卡样式。
    const columnValue = normalizeColumns(shown('columns'))
    rows.push(createElement(Row, {
      key: 'columns',
      title: translate(t, 'card.columns'),
      desc: translate(t, 'card.columns.desc'),
      control: createElement('div', { className: 'dms_sliderBox' }, [
        createElement('input', {
          key: 'r',
          type: 'range',
          className: 'dms_slider',
          min: COLUMN_CHOICES[0],
          max: COLUMN_CHOICES[COLUMN_CHOICES.length - 1],
          step: 1,
          value: columnValue,
          disabled: !writable,
          'aria-label': translate(t, 'card.columns'),
          'aria-valuetext': translate(t, 'card.columns.value', { n: columnValue }),
          onChange: (event: { target: { value: string } }) => { sliderMove(event.target.value) },
          onPointerUp: () => { sliderCommit() },
          onPointerCancel: () => { sliderCommit() },
          onKeyUp: () => { sliderCommit() },
          onBlur: () => { sliderCommit() },
        }),
        createElement('span', { key: 'v', className: 'dms_sliderVal' }, String(columnValue)),
      ]),
    }))
    if (failedField !== null) {
      rows.push(createElement('div', { key: 'fail', className: 'dms_setFail' }, translate(t, 'card.saveFailed')))
    }
    if (!writable) rows.push(createElement('div', { key: 'ro', className: 'dms_setDesc' }, translate(t, 'card.readonly')))
  }

  return createElement('div', {
    className: `dms_setCard${open ? ' dms_setCardOpen' : ''}`,
  }, [
    createElement(Header, { key: 'head', t, open, onToggle: () => { setOpen(current => !current) } }),
    open && createElement('div', { key: 'body', className: 'dms_setBody' }, [
      ...rows,
      // star 快车道（_tools/star-row 生成的常量副本）：链接常驻，话术可点掉。
      createElement('div', { key: 'star', className: 'dms_setStar', ref: mountStarRef }),
    ]),
  ])
}
