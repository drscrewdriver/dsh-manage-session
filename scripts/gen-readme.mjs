#!/usr/bin/env node
/**
 * README 单一源生成器：`docs/readme/i18n.mjs`（10 语言文案）× 固定骨架 → 10 个 README。
 *
 * 为什么要有它
 * ------------
 * 手维护 10 份 README 必然漂移（历史上 zh 有 TUI 段、en 没有）。改成「骨架只在生成器
 * 里写一次，文案只写在 i18n.mjs」后：命令块/路径/方法名/徽章永远一致，改一句话只需
 * 改一条文案再 `npm run readme:gen`。
 *
 * 用法
 * ----
 * ```
 * npm run readme:gen      # 生成 README.md / README.<lang>.md
 * npm run readme:check    # 结构门禁（版本、H2 对齐、关键词、链接）
 * ```
 * 生成物请勿手改（check 会把它当作漂移报出来）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGS, STRINGS } from '../docs/readme/i18n.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version
const DSH_RANGE = pkg.engines?.dsh ?? ''
const REPO = String(pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')

/** 安装命令（PowerShell；编码两行防中文路径乱码）。 */
const INSTALL_COMMANDS = [
  '```powershell',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '',
  'dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/',
  '```',
].join('\n')

/** 确定性清理脚本的五个动作（宿主关闭后运行）。 */
const CLEANUP_COMMANDS = [
  '```bash',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs list',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]',
  'node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger',
  '```',
].join('\n')

/** 源码安装（折叠块）。 */
const SOURCE_INSTALL = [
  '<details>',
  '<summary>Build from source</summary>',
  '',
  '```powershell',
  'git clone https://github.com/drscrewdriver/dsh-manage-session.git',
  'Set-Location .\\dsh-manage-session',
  'pnpm install --frozen-lockfile',
  'npm run build',
  'dsh plugin --profile web add .',
  '```',
  '',
  '</details>',
].join('\n')

/** fenced 路由方法清单（与 src/index.ts 的 HISTORY_METHODS / HEALTH_METHODS 对齐）。 */
const METHODS = [
  '```text',
  'session-catalog            session-catalog-stream',
  'session-history-list       session-history-archive',
  'session-history-prune      session-history-purge',
  'session-history-favorites-list / session-history-favorite-set',
  '',
  'session-health-status      session-health-scan',
  'session-health-session     session-health-repair',
  'session-health-source-migrate',
  '',
  'settings-describe          settings-mutate',
  '```',
].join('\n')

/** 配置项（字段名与默认值不翻译，只翻作用）。 */
const CONFIG_FIELDS = [
  ['enabled', 'true'],
  ['historyFiles', 'true'],
  ['healthCheck', 'true'],
  ['directDelete', 'false'],
]

/** 受审计的存储路径（路径不翻译，只翻一句话）。 */
const PATHS = [
  '`~/.dsh/storages/workspace.json`',
  '`~/.dsh/storages/manage-session/purge-ledger.jsonl`',
  '`~/.dsh/trash/manage-session/`',
]

const SHOTS = [
  ['assets/new-manager.png', 0],
  ['assets/old-archive.png', 1],
  ['assets/left-sidebar-old.png', 2],
]

const badge = (alt, url, href) => `[![${alt}](${url})](${href})`

function languageLine(current) {
  return LANGS.map((lang) => (lang.code === current ? `**${lang.label}**` : `[${lang.label}](${lang.file})`)).join(' · ')
}

function badges() {
  const rangeLabel = encodeURIComponent(DSH_RANGE).replace(/-/g, '--')
  return [
    badge('npm', `https://img.shields.io/npm/v/${pkg.name}.svg?label=npm`, `https://www.npmjs.com/package/${pkg.name}`),
    badge('downloads', `https://img.shields.io/npm/dt/${pkg.name}.svg?label=downloads`, `https://www.npmjs.com/package/${pkg.name}`),
    badge('license', 'https://img.shields.io/badge/license-MIT-blue.svg', 'LICENSE'),
    badge('DSH Web plugin', 'https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg', REPO),
    badge(`DSH ${DSH_RANGE}`, `https://img.shields.io/badge/DSH-${rangeLabel}-2563eb.svg`, REPO),
  ].join('\n')
}

/**
 * 生成一个语种的 README。
 * @param {string} code - 语言 code（与 i18n.mjs 的 LANGS 对齐）。
 * @returns {string} markdown 文本（末尾带换行）。
 */
export function renderReadme(code) {
  const s = STRINGS[code]
  if (s === undefined) throw new Error(`没有 ${code} 的文案（docs/readme/i18n.mjs）`)
  const lines = []

  lines.push('<div align="center">', '', '# dsh-manage-session', '', `**${s.tagline}**`, '', languageLine(code), '', badges(), '', '</div>', '')
  lines.push(`> ${s.disclaimer}`, '')
  lines.push(s.versionLine.replace('{v}', VERSION), '')

  // 功能概览
  lines.push(`## ${s.hOverview}`, '', s.overviewLead, '')
  for (const item of s.overview) lines.push(`- ${item}`)
  lines.push('')

  // 界面预览
  lines.push(`## ${s.hShots}`, '')
  for (const [file, index] of SHOTS) {
    lines.push(`![${s.shots[index]}](${file})`, '')
  }

  // 安装
  lines.push(`## ${s.hInstall}`, '', s.range, '')
  lines.push(`### ${s.agentLead}`, '', '```text', s.agentPrompt, '```', '')
  lines.push(`### ${s.manualLead}`, '', INSTALL_COMMANDS, '')
  lines.push(s.restart, '')

  // 配置
  lines.push(`## ${s.hConfig}`, '', s.configLead, '')
  CONFIG_FIELDS.forEach(([field, def], index) => {
    lines.push(`- \`${field}\` (\`${def}\`) — ${s.configFields[index]}`)
  })
  lines.push('', s.entryNote, '')

  // 使用指南
  lines.push(`## ${s.hUsage}`, '')
  for (const [op, desc] of s.usage) lines.push(`- **${op}** — ${desc}`)
  lines.push('')

  // 归档 / 删除 / 清理
  lines.push(`## ${s.hCleanup}`, '', s.cleanupLead, '', CLEANUP_COMMANDS, '')
  for (const item of s.cleanup) lines.push(`- ${item}`)
  lines.push('')

  // 存储与路由
  lines.push(`## ${s.hStorage}`, '', s.storageNote, '')
  PATHS.forEach((path, index) => lines.push(`- ${path} — ${s.paths[index]}`))
  lines.push('', METHODS, '')

  // 注意事项
  lines.push(`## ${s.hNotes}`, '')
  for (const item of s.notes) lines.push(`- ${item}`)
  lines.push('')

  // FAQ
  lines.push(`## ${s.hFaq}`, '')
  for (const [q, a] of s.faq) lines.push(`### ${q}`, '', a, '')

  // 许可 + 源码安装
  lines.push(`## ${s.hLicense}`, '', s.licenseText, '', SOURCE_INSTALL, '')

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function main() {
  const written = []
  for (const lang of LANGS) {
    const output = renderReadme(lang.code)
    const target = join(ROOT, lang.file)
    writeFileSync(target, output)
    written.push(`${lang.file} (${output.split('\n').length} lines)`)
  }
  console.log(`readme:gen — ${written.length} 个语言版本（v${VERSION}）`)
  for (const line of written) console.log(`  ${line}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}

export { LANGS, STRINGS, VERSION, DSH_RANGE }