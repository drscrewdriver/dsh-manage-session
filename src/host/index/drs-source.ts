/**
 * DRS 语料源:dsh-reference-session 投影库的 HTTP 只读客户端(T7.1)。
 *
 * 语料契约 = DRS 单条 fenced 路由 `GET /api/dsh-reference-session`:
 * - `op=sessions&offset=&limit=` → `{ok, total, rows:[sessions 行]}`(分页);
 * - `op=session&session=<id>&fields=search` → `{ok, session, rows:[检索臂]}`。
 *
 * 字段对照(T7.0,DRS wire snake → steward 引擎列):
 *   sessions.version ← artifact_mtime_ms(水位代理:日志重写必 bump mtime);
 *   sessions.updated_at ← last_time_ms;title/cwd/archived ← 同名列;
 *   docs.type ← kind;docs.surface ← on_surface(1='current'/0='shadowed');
 *   docs.time ← time;docs.text ← search_text;index_text 由本引擎
 *   segmentForIndex 重算(自有切分面不动)。
 *
 * 自调用信任面:DRS 的 Host 门是精确匹配(trustedHosts 全小写比对),本客户
 * 端可带 hostHeader 显式回显首个 trustedHosts 条目,规避「条目省略端口而
 * URL 带端口」的精确匹配失配;loopback + 无 trustedHosts 的老宿主天然放行。
 */
/** DRS API 路径(与 dsh-reference-session 的 DRS_API_PATH 字面一致;不跨包 import)。 */
export const DRS_API_PATH = '/api/dsh-reference-session'

/** 语料列表分页大小(百会话级一轮 1-2 页;DRS 侧 offset/limit 透传)。 */
export const DRS_CORPUS_PAGE = 500

/** 一个 DRS 会话头(watermark 代理 + 检索排序字段)。 */
export interface DrsCorpusHead {
  sessionId: string
  version: number
  title: string
  cwd: string
  updatedAt: number
  archived: boolean
}

/** 一个 DRS 检索臂文档(surface 已折算成引擎列的字符串域)。 */
export interface DrsCorpusDoc {
  seq: number
  type: string
  surface: 'current' | 'shadowed'
  time: number
  text: string
}

/** 一个 DRS 会话的完整语料(头 + docs)。 */
export interface DrsCorpusSession {
  head: DrsCorpusHead
  docs: DrsCorpusDoc[]
}

export interface DrsCorpusSourceOptions {
  /** DRS API 基址(http://host[:port];解析序见 resolveDrsBaseUrl)。 */
  baseUrl: string
  /** 注入面(单测);缺省全局 fetch。 */
  fetchImpl?: typeof fetch
  /** 显式 Host 头(trustedHosts 首条回显;缺省不覆盖)。 */
  hostHeader?: string
  log?: (message: string) => void
}

/**
 * 基址解析:显式配置 > 首个 trustedHosts 条目(补 http:// 前缀)>
 * `http://127.0.0.1:8080`(宿主默认口;trustedHosts 缺席的老线 DRS 门本就放行)。
 */
export function resolveDrsBaseUrl(explicit: string | undefined, trustedHosts?: readonly string[]): string {
  const trimmed = explicit?.trim() ?? ''
  const pick = trimmed !== '' ? trimmed : trustedHosts?.find(entry => entry.trim() !== '')?.trim()
  if (pick === undefined || pick === '') return 'http://127.0.0.1:8080'
  return /^https?:\/\//u.test(pick) ? pick : `http://${pick}`
}

export class DrsCorpusSource {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: DrsCorpusSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** 一个 GET 的 JSON 包络(ok!==true 或非 2xx 一律抛,由调用方回退 native)。 */
  private async getJson(query: string): Promise<Record<string, unknown>> {
    const base = this.options.baseUrl.replace(/\/+$/u, '')
    const url = `${base}${DRS_API_PATH}${query}`
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          ...(this.options.hostHeader === undefined ? {} : { host: this.options.hostHeader }),
        },
      })
    } catch (err) {
      throw new Error(`DRS ${query}: ${String(err instanceof Error ? err.message : err)}`)
    }
    if (!response.ok) throw new Error(`DRS ${query} → HTTP ${String(response.status)}`)
    const body = await response.json() as unknown
    if (typeof body !== 'object' || body === null) throw new Error(`DRS ${query}: 响应非 JSON 对象`)
    const record = body as Record<string, unknown>
    if (record['ok'] !== true) {
      throw new Error(`DRS ${query}: ok=false(${String(record['error'] ?? 'unknown')})`)
    }
    return record
  }

  private static headOf(row: Record<string, unknown>, fallbackId: string): DrsCorpusHead {
    return {
      sessionId: String(row['session_id'] ?? fallbackId),
      version: Number(row['artifact_mtime_ms'] ?? 0),
      title: String(row['title'] ?? ''),
      cwd: String(row['cwd'] ?? ''),
      updatedAt: Number(row['last_time_ms'] ?? 0),
      archived: Number(row['archived'] ?? 0) === 1,
    }
  }

  /** 全量语料头(内部翻页;rows 空或凑满 total 即止)。 */
  async listSessions(): Promise<DrsCorpusHead[]> {
    const heads: DrsCorpusHead[] = []
    let offset = 0
    for (;;) {
      const page = await this.getJson(`?op=sessions&offset=${String(offset)}&limit=${String(DRS_CORPUS_PAGE)}`)
      const rows = Array.isArray(page['rows']) ? page['rows'] as Record<string, unknown>[] : []
      for (const row of rows) {
        const head = DrsCorpusSource.headOf(row, '')
        if (head.sessionId !== '') heads.push(head)
      }
      offset += rows.length
      const total = Number(page['total'] ?? heads.length)
      if (rows.length === 0 || offset >= total) break
    }
    return heads
  }

  /** 一个会话的检索臂 docs;DRS 无此会话(session:null)返回 undefined。 */
  async readSession(sessionId: string): Promise<DrsCorpusSession | undefined> {
    const body = await this.getJson(`?op=session&session=${encodeURIComponent(sessionId)}&fields=search`)
    if (body['session'] === null || body['session'] === undefined) return undefined
    const head = DrsCorpusSource.headOf(body['session'] as Record<string, unknown>, sessionId)
    const docs = (Array.isArray(body['rows']) ? body['rows'] as Record<string, unknown>[] : []).map(row => ({
      seq: Number(row['seq'] ?? 0),
      type: String(row['kind'] ?? ''),
      surface: Number(row['on_surface'] ?? 1) === 1 ? 'current' as const : 'shadowed' as const,
      time: Number(row['time'] ?? 0),
      text: String(row['search_text'] ?? ''),
    }))
    return { head, docs }
  }
}
