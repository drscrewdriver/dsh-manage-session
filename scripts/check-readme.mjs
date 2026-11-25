#!/usr/bin/env node
/**
 * README 结构门禁：10 个语言版本必须同构、同版本、含 archive 关键词、链接可达。
 *
 * 为什么需要：README 由 `scripts/gen-readme.mjs` 生成，手改或漏加语言会让结构漂移；
 * 而 npm / dshmarket 的搜索命中取决于 description、keywords 与 README 首屏是否覆盖
 * `archive`/归档 —— 把这件事做成断言，而不是靠人记。
 *
 * 用法：`npm run readme:check`（已挂进 prepublishOnly）
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGS } from '../docs/readme/i18n.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const failures = []
const fail = (message) => failures.push(message)

/** 结构指纹：只数「骨架层」的行，忽略各语言的正文。 */
function fingerprint(text) {
  const lines = text.split('\n')
  return {
    h2: lines.filter(line => line.startsWith('## ')).length,
    h3: lines.filter(line => line.startsWith('### ')).length,
    bullets: lines.filter(line => line.startsWith('- ')).length,
    images: (text.match(/!\[[^\]]*\]\(/g) ?? []).length,
    fences: (text.match(/^```/gm) ?? []).length,
    switcher: (text.match(/\]\(README/g) ?? []).length,
  }
}

const files = LANGS.map(lang => lang.file)
const texts = new Map()

for (const lang of LANGS) {
  const path = join(ROOT, lang.file)
  if (!existsSync(path)) {
    fail(`缺少 ${lang.file}（先跑 npm run readme:gen）`)
    continue
  }
  const text = readFileSync(path, 'utf8')
  texts.set(lang.code, text)

  if (!text.includes('# dsh-manage-session')) fail(`${lang.file} 首屏缺少一级标题 dsh-manage-session`)
  if (!text.includes(pkg.version)) fail(`${lang.file} 未写当前版本 ${pkg.version}`)
  if (!text.includes('session-purge.mjs')) fail(`${lang.file} 未提确定性清理脚本`)
  if (!text.includes('dsh plugin --profile web add dsh-manage-session')) fail(`${lang.file} 缺少安装命令`)

  // asset 链接可达
  for (const asset of ['LICENSE', 'CHANGELOG.md', 'assets/new-manager.png', 'assets/old-archive.png', 'assets/left-sidebar-old.png']) {
    if (!text.includes(asset)) fail(`${lang.file} 缺少链接 ${asset}`)
    else if (!existsSync(join(ROOT, asset))) fail(`${asset} 文件不存在（被 README 引用）`)
  }

  // 语言切换行：10 个版本都挂上
  const switcher = fingerprint(text).switcher
  if (switcher < LANGS.length - 1) fail(`${lang.file} 语言切换行缺项（${switcher}/${LANGS.length - 1}）`)

  // 关键词兜底：中文必须出现「归档」，其它语言必须出现 archive
  if (lang.code === 'zh') {
    if (!text.includes('归档')) fail('README.md 未出现「归档」关键词')
  } else if (!/archive/i.test(text)) {
    fail(`${lang.file} 未出现 archive 关键词`)
  }
}

// 结构同构：以 zh 为基准
const base = texts.get('zh')
if (base !== undefined) {
  const expected = fingerprint(base)
  for (const [code, text] of texts) {
    const actual = fingerprint(text)
    for (const key of Object.keys(expected)) {
      if (actual[key] !== expected[key]) {
        fail(`结构漂移：${code}.${key} = ${actual[key]}，基准 zh = ${expected[key]}`)
      }
    }
  }
}

// 文案源与语言表必须一一对应
for (const lang of LANGS) if (!texts.has(lang.code)) fail(`未生成 ${lang.code}`)

// 发布白名单必须收全 10 个 README
const shipped = new Set(pkg.files ?? [])
for (const file of files) if (!shipped.has(file)) fail(`package.json files 未收录 ${file}`)

// description / keywords 的 archive 兜底（npm 与 dshmarket 都读这两个字段）
const description = String(pkg.description ?? '')
if (!/归档/.test(description) || !/archive/i.test(description)) {
  fail('package.json description 必须同时含「归档」与 archive')
}
const keywords = new Set((pkg.keywords ?? []).map(String))
for (const keyword of ['archive', 'archived-sessions', 'recycle-bin', 'restore', 'session-management']) {
  if (!keywords.has(keyword)) fail(`package.json keywords 缺少 ${keyword}`)
}

if (failures.length > 0) {
  console.error(`readme:check — ${failures.length} 处阻断`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`readme:check — ${LANGS.length} 个语言版本同构、版本一致、archive 关键词与链接全部通过`)