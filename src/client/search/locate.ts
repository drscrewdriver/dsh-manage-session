/**
 * 命中定位臂（B 路线 v3，T7.4）：内容搜索点击打开会话后，把宿主会话视图 DOM
 * 里对应的那一行滚进视口并瞬时高亮。
 *
 * 前提实证（0.2.1 宿主前端包扫描）：会话列表**无虚拟化**（无 virtuoso/
 * react-window 指纹，IntersectionObserver 仅做 sticky 标题与入视口激活），
 * 打开会话后历史行全量在 DOM。宿主导航接口面无消息锚点
 * （uiWorkspace.openSession(SessionTarget) 全签名），DOM 文本匹配是唯一通路；
 * 一切失败静默退化为「仅打开」（绝不抛、绝不遮主流程）。
 *
 * v2 教训（真机「还停在底部」）：一次性 scrollIntoView 会被宿主会话打开后
 * 的贴底/滚动恢复覆盖——v3 改「巡逻-驻留」模型：每 TICK 重定位+补滚，
 * 目标行稳定驻留视口 STICK_MS 后才打高亮；用户手动滚动立即让位。
 *
 * 数据面：同源 GET /api/dsh-reference-session?op=session&session=<id>
 * ——行含 seq/text/search_text/surface_text/on_surface/compressed：
 * - on_surface=0（被替换原文行）：GUI 不渲染该文本 → 放弃定位（不是失败）；
 * - compressed=1：GUI 渲染的是链解析后的 surface_text（替身文本）；
 * - 其余行优先 search_text（已剥宿主注入样板段=用户可见文本），退化 text。
 */
import type { HostContentHit } from './host-api.ts'

/** DRS fenced 路由（同源相对路径，与 dsh-reference-session DRS_API_PATH 字面一致）。 */
const DRS_ROUTE = '/api/dsh-reference-session'

/** 定位总超时（打开会话后 DOM 渲染窗口）。 */
const LOCATE_TIMEOUT_MS = 8_000

/** 高亮驻留时长后自动摘除。 */
const FLASH_MS = 6_000

/** needle 下限——短于此值的行（"好的"）歧义面太大，不值得定位。 */
const MIN_NEEDLE_CHARS = 12

/** needle 上限——取前缀足够唯一，过长整串匹配反而更易被渲染差异打断。 */
const MAX_NEEDLE_CHARS = 80

/** 驻留确认窗口：目标行在视口内稳定停留这么久才算跳转成功。 */
const STICK_MS = 900

/** 巡逻间隔：会话重渲染会换 DOM 节点，每轮重新定位。 */
const TICK_MS = 350

/** 定位行在视口内的判定余量（顶部允许略出屏，代码块开头行高度不定）。 */
const VISIBILITY_SLACK = 40

/** 归一化/取 needle 用的一个 DRS 段行（wire 蛇形，只声明消费字段）。 */
export interface LocateRowFace {
  seq: number
  text?: string
  search_text?: string
  on_surface?: number
  compressed?: number
  surface_text?: string | null
}

/** markdown 结构符与空白——DOM 渲染后不含这些，两侧同抹才能对上。 */
const MATCH_NOISE_RE = /[\s`*_~#>|[\]()!，。：；、"'\\{}-]+/gu

/** 归一化比对文本：去空白与 markdown 噪声字符。 */
export function normalizeForMatch(text: string): string {
  return text.replace(MATCH_NOISE_RE, '')
}

/**
 * 从段行选一条可定位 needle（按纯函数导出，供单测）。
 * @returns 归一化 needle；null=该行不可定位（被替换原文/无有效文本/过短歧义）。
 */
export function resolveNeedle(row: LocateRowFace | undefined): string | null {
  if (row === undefined) return null
  if (Number(row.on_surface ?? 1) === 0) return null
  const sources: (string | null | undefined)[] = Number(row.compressed ?? 0) === 1
    ? [row.surface_text, row.search_text, row.text]
    : [row.search_text, row.text]
  for (const source of sources) {
    if (typeof source !== 'string' || source === '') continue
    // 行首段优先：渲染可能截断长行/拆段，首行完整命中概率最高。
    const firstLine = source.split('\n').find(line => line.trim() !== '') ?? source
    const needle = normalizeForMatch(firstLine).slice(0, MAX_NEEDLE_CHARS)
    if (needle.length >= MIN_NEEDLE_CHARS) return needle
    // 首行太短（"好的"）时退整段拼接再试一次，仍短则换下一来源。
    const whole = normalizeForMatch(source).slice(0, MAX_NEEDLE_CHARS)
    if (whole.length >= MIN_NEEDLE_CHARS) return whole
  }
  return null
}

/** 正文候选标签：只取消息渲染会用的块级/内联代码标签——不含 div/span，
 * 否则搜索面板自己的结果行（dsws_snippet 的 span，文本就含 needle 前缀）会抢先命中。 */
const MESSAGE_TAGS = 'p, li, pre, blockquote, h1, h2, h3, h4, td, code'

/**
 * 找正文行：多义时取 DOM 最深者（段落本体而非包裹层）；**排除插件自家
 * 子树**（dsws_ 前缀类与任何 role=dialog 弹层）——面板行/管理台行都是
 * 目标文本的镜像，绝不允许当作跳转目的地。
 */
function findMessageElement(root: ParentNode, needle: string): Element | null {
  let best: Element | null = null
  let bestDepth = -1
  for (const el of Array.from(root.querySelectorAll(MESSAGE_TAGS))) {
    const text = el.textContent
    if (text === null) continue
    if (el.closest('[class*="dsws_"], [role="dialog"]') !== null) continue
    if (!normalizeForMatch(text).includes(needle)) continue
    let depth = 0
    for (let n: Node | null = el.parentElement; n !== null; n = n.parentElement) depth += 1
    if (depth > bestDepth) {
      best = el
      bestDepth = depth
    }
  }
  return best
}

/** 瞬时高亮：outline 描边，FLASH_MS 后恢复原 inline 样式。 */
function flashElement(el: Element): void {
  const html = el as HTMLElement
  const before = { outline: html.style.outline, outlineOffset: html.style.outlineOffset, transition: html.style.transition }
  html.setAttribute('data-dss-located', '1')
  html.style.transition = 'outline 120ms ease'
  html.style.outline = '2px solid var(--dsw-alias-accent, #4a9eff)'
  html.style.outlineOffset = '2px'
  setTimeout(() => {
    html.style.outline = before.outline
    html.style.outlineOffset = before.outlineOffset
    html.style.transition = before.transition
    html.removeAttribute('data-dss-located')
  }, FLASH_MS)
}

/** 定位执行面（测试可注入假环境；缺省走真浏览器）。 */
export interface LocateEnv {
  fetchImpl?: typeof fetch
  doc?: Document
  win?: Window
  timeoutMs?: number
  log?: (message: string) => void
}

/** 目标行是否基本完整落在视口内（巡逻驻留判定）。 */
function inViewport(el: Element, win: Window): boolean {
  const rect = el.getBoundingClientRect()
  const vh = win.innerHeight || (el.ownerDocument.documentElement.clientHeight || 0)
  return rect.top >= -VISIBILITY_SLACK && rect.bottom <= vh + VISIBILITY_SLACK
}

/**
 * 主管线：拉 DRS 段行 → 选 needle → 巡逻宿主 DOM 补滚 → 驻留后高亮。
 * fire-and-forget 语义：任何一步不满足都 resolve(false)，从不抛。
 */
export async function locateSearchHit(hit: HostContentHit, env: LocateEnv = {}): Promise<boolean> {
  const fetchImpl = env.fetchImpl ?? globalThis.fetch
  const doc = env.doc ?? (typeof document === 'undefined' ? undefined : document)
  if (doc === undefined) return false
  const win = env.win ?? doc.defaultView ?? (typeof window === 'undefined' ? undefined : window)
  if (win === undefined) return false
  const log = env.log ?? ((message: string): void => { console.debug(`[dsh-session-steward] ${message}`) })
  try {
    const response = await fetchImpl(`${DRS_ROUTE}?op=session&session=${encodeURIComponent(hit.sessionId)}`)
    if (!response.ok) { log(`locate: drs http ${String(response.status)}`); return false }
    const body = await response.json() as { ok?: boolean; rows?: LocateRowFace[] }
    if (body.ok !== true || !Array.isArray(body.rows)) { log('locate: drs envelope shape'); return false }
    const row = body.rows.find(r => Number(r.seq) === Number(hit.seq))
    const needle = resolveNeedle(row)
    if (needle === null) { log(`locate: skip row seq=${String(hit.seq)} (shadowed/短文本/无行)`); return false }

    const startedAt = Date.now()
    const deadline = startedAt + (env.timeoutMs ?? LOCATE_TIMEOUT_MS)
    let lastScrollAt = 0
    let userTookOver = false
    const USER_EVENTS = ['wheel', 'touchstart', 'keydown'] as const
    const onUser = (): void => { userTookOver = true }

    return await new Promise<boolean>((resolve) => {
      const finish = (ok: boolean, why: string): void => {
        clearInterval(ticker)
        for (const ev of USER_EVENTS) win.removeEventListener(ev, onUser)
        log(`${why}: seq=${String(hit.seq)} ${hit.sessionId.slice(0, 12)} +${String(Date.now() - startedAt)}ms`)
        resolve(ok)
      }
      for (const ev of USER_EVENTS) win.addEventListener(ev, onUser, { passive: true, once: true })
      const ticker = setInterval(() => {
        if (userTookOver) { finish(false, 'yield user'); return }
        if (Date.now() >= deadline) { finish(false, 'locate timeout'); return }
        const el = findMessageElement(doc.body ?? doc, needle)
        if (el === null) return // DOM 未就绪/会话还在切换：下一轮再找
        if (inViewport(el, win)) {
          // 从未滚过且本来就可见（同会话当前视口）=直达；否则须驻留过 STICK 窗。
          if (lastScrollAt === 0 || Date.now() - lastScrollAt >= STICK_MS) {
            flashElement(el)
            finish(true, 'located')
          }
          return
        }
        // 目标不在视口：若距上次补滚超一个 tick，重新滚（behavior=auto——smooth
        // 动画会被宿主随后的贴底/恢复打断且互相取消）。会话重渲染换节点也走这条。
        if (Date.now() - lastScrollAt >= TICK_MS) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' })
          lastScrollAt = Date.now()
        }
      }, TICK_MS)
    })
  } catch (err) {
    log(`locate error(silent): ${String(err instanceof Error ? err.message : err)}`)
    return false
  }
}
