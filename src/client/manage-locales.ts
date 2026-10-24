/**
 * 会话管理（dsh-manage-sessions）client dictionaries —— 只含管理台用到的键集
 * （zh / en / ja / ko / fr / de / it / ru / es）。
 *
 * 从合并包的搜索字典里**裁出管理台专属键**（keys 不变、文案不变），搜索子域
 * 已拆回 dsh-search-index，本包不再持有搜索面板的文案。
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'dsh-manage-sessions'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'domain.all': "全部",
  'filter.favorites': "收藏",
  'group.collapse': "收拢/展开本组",
  'group.collapseAll': "全部收拢",
  'group.expandAll': "全部展开",
  'manage.batch.archive': "归档",
  'manage.batch.confirm': "确认删除",
  'manage.batch.delete': "删除",
  'manage.batch.unarchive': "取消归档",
  'manage.batch.working': "执行中…",
  'manage.done.archive': "已归档 {n} 个会话。",
  'manage.done.error': "操作失败：{error}",
  'manage.done.purge': "已清理 {n} 个会话。",
  'manage.done.restart': "需重启 DSH 后在侧栏完全生效。",
  'manage.done.unarchive': "已取消归档 {n} 个会话。",
  'manage.group.nocwd': "（未分组）",
  'manage.hint': "按工作区分组，勾选后批量操作；删除不可撤销。",
  'manage.restartHint': "优先走宿主内存 API 即时生效（0.1.7+ 归档/取消归档免重启）；不可用时直写存储文件，重启后侧栏生效。",
  'manage.search': "搜索会话…",
  'manage.selected': "已选 {n}",
  'manage.selectGroup': "全选/取消本组",
  'panel.loadingSessions': "正在读取会话列表…",
  'panel.noMatch': "没有匹配的会话。",
  'panel.noSessions': "暂无会话",
  'panel.untitled': "(未命名)",
  'tag.archived': "归档",
  'workspace.label': "工作区",
  'workspace.less': "收起",
  'workspace.more': "还有 {n} 个",
  'star.on': "已收藏",
  'star.off': "未收藏",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

/** Key union derived from the zh dictionary. */
export type LocaleKey = keyof typeof zh
/** Full dictionary shape (all locales fill it from zh). */
export type Dict = Record<LocaleKey, string>

/** English dictionary (complete). */
export const en: Dict = {
  'domain.all': "All",
  'filter.favorites': "Favorites",
  'group.collapse': "Collapse/expand group",
  'group.collapseAll': "Collapse all",
  'group.expandAll': "Expand all",
  'manage.batch.archive': "Archive",
  'manage.batch.confirm': "Confirm delete",
  'manage.batch.delete': "Delete",
  'manage.batch.unarchive': "Unarchive",
  'manage.batch.working': "Working…",
  'manage.done.archive': "Archived {n} sessions.",
  'manage.done.error': "Operation failed: {error}",
  'manage.done.purge': "Purged {n} sessions.",
  'manage.done.restart': "Restart DSH for the sidebar to fully reflect this.",
  'manage.done.unarchive': "Unarchived {n} sessions.",
  'manage.group.nocwd': "(no workspace)",
  'manage.hint': "Grouped by workspace; tick rows then batch-operate. Deletion is irreversible.",
  'manage.restartHint': "Prefers host in-memory APIs (0.1.7+ archive/unarchive apply instantly); falls back to direct storage-file edits, which need a restart.",
  'manage.search': "Search sessions…",
  'manage.selected': "{n} selected",
  'manage.selectGroup': "Toggle the whole group",
  'panel.loadingSessions': "Loading sessions…",
  'panel.noMatch': "No matching sessions.",
  'panel.noSessions': "No sessions",
  'panel.untitled': "(untitled)",
  'tag.archived': "Archived",
  'workspace.label': "Workspace",
  'workspace.less': "Collapse",
  'workspace.more': "{n} more",
  'star.on': "Favorited",
  'star.off': "Not favorited",
  'domain.active': "Active",
  'domain.archived': "Archived",
}

export const ja: Partial<Dict> = {
  'panel.loadingSessions': "セッション一覧を読み込み中…",
  'panel.noMatch': "一致するセッションがありません。",
  'panel.noSessions': "セッションなし",
  'panel.untitled': "（無題）",
  'star.on': "お気に入り済み",
  'star.off': "未お気に入り",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

export const ko: Partial<Dict> = {
  'panel.loadingSessions': "세션 목록 읽는 중…",
  'panel.noMatch': "일치하는 세션이 없습니다.",
  'panel.noSessions': "세션 없음",
  'panel.untitled': "(제목 없음)",
  'star.on': "즐겨찾기됨",
  'star.off': "즐겨찾기 안 됨",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

export const fr: Partial<Dict> = {
  'panel.loadingSessions': "Chargement des sessions…",
  'panel.noMatch': "Aucune session correspondante.",
  'panel.noSessions': "Aucune session",
  'panel.untitled': "(sans titre)",
  'star.on': "En favori",
  'star.off': "Pas en favori",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

export const de: Partial<Dict> = {
  'panel.loadingSessions': "Sitzungen werden geladen…",
  'panel.noMatch': "Keine passenden Sitzungen.",
  'panel.noSessions': "Keine Sitzungen",
  'panel.untitled': "(unbenannt)",
  'star.on': "Favorit",
  'star.off': "Kein Favorit",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

export const it: Partial<Dict> = {
  'panel.loadingSessions': "Caricamento sessioni…",
  'panel.noMatch': "Nessuna sessione corrispondente.",
  'panel.noSessions': "Nessuna sessione",
  'panel.untitled': "(senza titolo)",
  'star.on': "Nei preferiti",
  'star.off': "Non nei preferiti",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

export const ru: Partial<Dict> = {
  'panel.loadingSessions': "Загрузка сессий…",
  'panel.noMatch': "Нет подходящих сессий.",
  'panel.noSessions': "Нет сессий",
  'panel.untitled': "(без названия)",
  'star.on': "В избранном",
  'star.off': "Не в избранном",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

export const es: Partial<Dict> = {
  'panel.loadingSessions': "Cargando sesiones…",
  'panel.noMatch': "Sin sesiones coincidentes.",
  'panel.noSessions': "Sin sesiones",
  'panel.untitled': "(sin título)",
  'star.on': "En favoritos",
  'star.off': "No en favoritos",
  'domain.active': "活跃",
  'domain.archived': "归档",
}

/** All shipped dictionaries by locale id. */
export const dictionaries: Record<string, Record<string, string>> = { zh, en, ja, ko, fr, de, it, ru, es }

/** Translate with {param} interpolation; falls back to zh, then the key itself. */
export function translate(locale: ((key: LocaleKey, params?: Record<string, unknown>) => string) | undefined, key: LocaleKey, params?: Record<string, unknown>): string {
  const raw = locale?.(key, params)
  if (typeof raw === 'string' && raw !== '' && raw !== key) return raw
  const template = (dictionaries.zh[key] ?? key) as string
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (_, name: string) => String(params[name] ?? `{${name}}`))
}
