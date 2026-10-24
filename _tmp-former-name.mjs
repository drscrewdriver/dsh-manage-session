import { readFileSync, writeFileSync } from 'node:fs'

// 1. README（四语）：标题下补「原名」
const notes = {
  'README.md': '> **原名**：`dsh-session-steward`（会话管家）。本仓库自 2.0.0 起改名为 `dsh-manage-sessions`，\n> 并把搜索/索引能力拆回 [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index)。\n',
  'README.en.md': '> **Former name**: `dsh-session-steward` (Session Steward). Renamed to `dsh-manage-sessions` at 2.0.0;\n> search/indexing moved back to [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index).\n',
  'README.ja.md': '> **旧名**：`dsh-session-steward`（セッション・スチュワード）。2.0.0 で `dsh-manage-sessions` に改名し、\n> 検索／索引は [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index) に戻しました。\n',
  'README.ko.md': '> **이전 이름**: `dsh-session-steward`(세션 스튜어드). 2.0.0에서 `dsh-manage-sessions`로 개명했고,\n> 검색/색인은 [`dsh-search-index`](https://github.com/drscrewdriver/dsh-search-index)로 되돌렸습니다.\n',
}
for (const [file, note] of Object.entries(notes)) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('**Former name**') || text.includes('**原名**') || text.includes('**旧名**') || text.includes('**이전 이름**')) {
    console.log('skip (already noted)', file)
    continue
  }
  const lines = text.split('\n')
  const insertAt = lines.findIndex((l) => l.startsWith('# ')) + 1
  lines.splice(insertAt, 0, '', note.trimEnd())
  writeFileSync(file, lines.join('\n'), 'utf8')
  console.log('noted original name in', file)
}

// 2. 清单描述带上原名
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
pkg.version = '2.0.3'
if (!pkg.description.includes('原名')) {
  pkg.description += '（原名 dsh-session-steward，2.0.0 起搜索能力拆回 dsh-search-index）'
}
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8')

const manifest = JSON.parse(readFileSync('dsh.plugin.json', 'utf8'))
manifest.version = '2.0.3'
manifest.description.zh += '（原名 dsh-session-steward）'
manifest.description.en += ' (formerly dsh-session-steward)'
writeFileSync('dsh.plugin.json', JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log('manifests bumped to 2.0.3 with former name')
