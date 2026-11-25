/**
 * 管理台列表的文本过滤（纯函数，便于单测）。
 *
 * 支持三种输入：
 * - 空串：不过滤；
 * - `工作区:` / `workspace:` 前缀：只比 cwd（按工作区搜索，README 里承诺的那条）；
 * - 其它：标题或 cwd 子串（大小写折叠）。
 */

/** 会话行做过滤所需的最小字段。 */
export interface FilterableSession {
  sessionId: string
  title: string
  cwd: string
}

const WORKSPACE_PREFIX = /^(?:工作区|workspace)\s*[:：]\s*/iu

/**
 * 按查询串判定一行是否命中。
 * @param item - 待判定行（只读 title/cwd）。
 * @param query - 原始搜索框内容。
 * @returns 是否命中。
 */
export function matchesCatalogText(item: FilterableSession, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const prefix = WORKSPACE_PREFIX.exec(needle)
  if (prefix !== null) {
    const term = needle.slice(prefix[0].length).trim()
    return term === '' ? true : item.cwd.toLowerCase().includes(term)
  }
  return item.title.toLowerCase().includes(needle) || item.cwd.toLowerCase().includes(needle)
}