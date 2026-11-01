/**
 * 家族节接管 own 卡内联直挂的源码结构钉（2026-11-02 own-tab 批量修复）。
 *
 * StewardFamilySection 与接管注册同在 client/index.ts，且随 JSX 传递依赖不便单独
 * import 渲染；沿用源码结构钉把「接管时本卡内联直挂 + 账本去重」钉死，
 * 谁把「只靠账本 renderSlot 渲染 own 卡」（= 空白缺陷）接回来这里立刻红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

describe('manage-session 家族接管 own 卡内联直挂', () => {
  it('StewardFamilySection 为 ownId 行内联直挂 renderOwn、并把同 id 账本条目去重', () => {
    expect(SRC).toMatch(/props\.renderOwn && row\.id === ownId/)
    expect(SRC).toMatch(/tabs\.filter\(tab => tab\.id !== ownId\)/)
  })

  it('接管 inject 面提供 ownId + renderOwn(StewardSettingsCard, bound)', () => {
    expect(SRC).toMatch(/ownId: STEWARD_ENTRY_ID/)
    expect(SRC).toMatch(/renderOwn: \(\) => createElement\(StewardSettingsCard, \{ scope: bound as StewardCardScope \}\)/)
  })
})
