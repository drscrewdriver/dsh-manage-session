import { readFileSync, writeFileSync } from 'node:fs'
import { zh as oldZh, en as oldEn, ja as oldJa, ko as oldKo, fr as oldFr, de as oldDe, it as oldIt, ru as oldRu, es as oldEs } from '../dsh-session-steward/src/client/search/locales.ts'
import { zh as curZh } from './src/client/manage-locales.ts'

const OLD = { zh: oldZh, en: oldEn, ja: oldJa, ko: oldKo, fr: oldFr, de: oldDe, it: oldIt, ru: oldRu, es: oldEs }

// 1. 收集 manage.tsx 真正用到的 key（字面量 + 动态 domain.*）
const src = readFileSync('src/client/manage.tsx', 'utf8')
const used = new Set()
for (const m of src.matchAll(/translate\(t, '([a-zA-Z0-9_.]+)'/g)) used.add(m[1])
for (const m of src.matchAll(/translate\(t, `([^`]+)`/g)) {
  const tpl = m[1]
  if (tpl.startsWith('domain.')) for (const d of ['all', 'active', 'archived']) used.add(`domain.${d}`)
  else used.add(tpl)
}
const missing = [...used].filter(k => !(k in curZh))
console.log('used keys:', used.size, '| missing:', missing.join(',') || '(none)')

if (missing.length > 0) {
  const FILE = 'src/client/manage-locales.ts'
  let text = readFileSync(FILE, 'utf8')
  for (const lang of ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'it', 'ru', 'es']) {
    const rows = missing.map((k) => {
      const value = OLD[lang]?.[k] ?? OLD.zh[k] ?? k
      return `  '${k}': ${JSON.stringify(value)},`
    }).join('\n')
    const re = new RegExp('(export const ' + lang + '(?:: Partial<Dict>|: Dict)? = \\{\\n[\\s\\S]*?)(\\n\\})')
    if (!re.test(text)) throw new Error('block missing: ' + lang)
    text = text.replace(re, `$1\n${rows}$2`)
  }
  writeFileSync(FILE, text, 'utf8')
  console.log('added missing keys to manage-locales.ts')
}
