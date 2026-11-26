#!/usr/bin/env node
/**
 * 把本地构建产物装进桌面 profile（本地替换，不改版本号、不发 npm）。
 *
 * 为什么不 bump 版本：profile 的 package.json 钉的是 npm 上的版本号，一改版本号
 * pnpm 就判「不符」去重装，把本地替换盖回 npm 版。所以只换文件、不动 version。
 *
 * 用法：
 *   node scripts/install-local.mjs            # 备份 + 替换 + 校验
 *   node scripts/install-local.mjs --check    # 只校验当前装的是不是本地构建
 *   node scripts/install-local.mjs --restore  # 从最近一次备份回滚
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = dirname(HERE)
const PROFILE = join(homedir(), '.dsh', 'profiles', 'desktop')
const INST = join(PROFILE, 'node_modules', 'dsh-manage-session')

/** 需要同步的条目（构建产物 + 运行期资源；文档/CHANGELOG 不必换）。 */
const ITEMS = ['lib', 'src', 'locale', 'scripts', 'package.json', 'cordis.patch.yml', 'dsh.plugin.json', 'screenshots.json']

/** 产物点名：改动必须能在真的产物里 grep 到，否则等于没装。 */
const PROBES = [
  { file: 'lib/index.js', needle: 'typeof field === "function"', why: 'withVolatile 放行 callable' },
  { file: 'lib/index.js', needle: '没有可用的设置写入口', why: '桥无写入口的显式失败' },
  { file: 'lib/client.js', needle: 'v2.dismissed', why: 'star dismissed 换键' },
  { file: 'lib/client.js', needle: 'openSection', why: 'bundle 设置页捷径' },
  { file: 'lib/client.js', needle: 'panel.settings', why: '设置按钮文案' },
  { file: 'lib/client.js', needle: 'dms_slider', why: '列数滑块' },
  { file: 'lib/client.js', needle: 'card.saveFailed', why: '写入失败的可见提示（乐观回滚）' },
]

const args = new Set(process.argv.slice(2))
const mode = args.has('--check') ? 'check' : args.has('--restore') ? 'restore' : 'install'

/** 最近一次备份目录（按名字里的时间戳排序）。 */
function latestBackup() {
  if (!existsSync(PROFILE)) return undefined
  const all = readdirSync(PROFILE)
    .filter(name => name.startsWith('.backup-ms-'))
    .sort()
  return all.length === 0 ? undefined : join(PROFILE, all[all.length - 1])
}

function verify() {
  let bad = 0
  for (const probe of PROBES) {
    const path = join(INST, probe.file)
    if (!existsSync(path)) { console.log(`  ✗ 缺文件 ${probe.file}`); bad += 1; continue }
    const text = readFileSync(path, 'utf8')
    const ok = text.includes(probe.needle)
    console.log(`  ${ok ? '✓' : '✗'} ${probe.why}  (${probe.file} → ${probe.needle})`)
    if (!ok) bad += 1
  }
  return bad
}

if (mode === 'check') {
  console.log(`目标：${INST}`)
  const bad = verify()
  console.log(bad === 0 ? '全部命中 = 装的是本地构建' : `${bad} 项缺失 = 装的是旧包`)
  process.exit(bad === 0 ? 0 : 1)
}

if (mode === 'restore') {
  const backup = latestBackup()
  if (backup === undefined) { console.error('没有可用的备份目录（.backup-ms-*）'); process.exit(1) }
  rmSync(INST, { recursive: true, force: true })
  cpSync(backup, INST, { recursive: true })
  console.log(`已回滚自 ${backup}`)
  process.exit(0)
}

// ---- install ----
if (!existsSync(join(SRC, 'lib', 'index.js'))) {
  console.error('本地 lib/ 不存在：先跑 npm run build')
  process.exit(1)
}
if (!existsSync(INST)) {
  console.error(`profile 里没装 dsh-manage-session：${INST}`)
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
const backup = join(PROFILE, `.backup-ms-${stamp}`)
cpSync(INST, backup, { recursive: true })
console.log(`备份 → ${backup}`)

for (const item of ITEMS) {
  const from = join(SRC, item)
  if (!existsSync(from)) continue
  const to = join(INST, item)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}
console.log(`替换 → ${INST}`)
console.log('产物校验：')
const bad = verify()
if (bad > 0) {
  console.error('校验未过，用 --restore 回滚')
  process.exit(1)
}
console.log('')
console.log('⚠️  文件已换，但宿主进程里跑的还是旧内存副本。')
console.log('    完全退出 DeepSeek Harness 再启动，才会加载新插件。')
