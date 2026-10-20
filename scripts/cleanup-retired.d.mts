/**
 * cleanup-retired.mjs 的声明侧车（tsconfig 不开 allowJs，测试经此取型）。
 * 形状变更必须与脚本同步——脚本是纯标准库 JS，本文件只描述导出面。
 */

/** 台账一行（畸形字段在读侧已过滤）。 */
export interface RetiredLedgerEntry {
  sessionId: string
  retiredAt?: string
  source?: string
}

/** 单会话残骸计划（probeId 产物；apply 阶段回填 moved/removed 计数）。 */
export interface ResiduePlan {
  sessionId: string
  sessionDirs: { workspace: string; dir: string }[]
  cacheFile?: string
  workspaceHits: string[]
  stewardRows: number
  collectorRows: number
  movedDirs?: string[]
  movedCache?: string
  stewardRemoved?: number
  collectorRemoved?: number
}

/** 一次运行的汇总。 */
export interface CleanupReport {
  mode: 'apply' | 'dry-run'
  ledger: string
  entries: number
  invalid: string[]
  clean: ResiduePlan[]
  withResidue?: number
  workspaceBackedUp: boolean
  archiveRoot: string
}

export interface CleanupOptions {
  apply: boolean
  forceLive: boolean
  ledger: string
  dshHome: string
  indexDir: string
  collectorDb: string
}

export declare const SESSION_ID_RE: RegExp
export declare function defaultLedgerPath(): string
export declare function readLedger(file: string): RetiredLedgerEntry[]
export declare function isUnder(root: string, target: string): boolean
export declare function detectLiveHosts(): string[]
export declare function parseArgs(argv: string[]): CleanupOptions
export declare function stripIdFromWorkspace(
  doc: Record<string, any>,
  id: string,
): { doc: Record<string, any>; changed: boolean }
export declare function runCleanup(opts: CleanupOptions): CleanupReport
