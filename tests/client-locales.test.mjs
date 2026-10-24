#!/usr/bin/env node
/**
 * manage-locales.ts（会话管理字典）契约：[zh/en 键集对齐、无空值、回退 zh、活 locale 优先]。
 *
 * 参数插值不再走本字典（管理台没有带占位符的文案），所以这里不测插值。
 *
 * Usage: node --import tsx tests/client-locales.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { NS, zh, en, ja, dictionaries, translate } = await import('../src/client/manage-locales.ts')

test('namespace is the plugin id', () => {
  assert.equal(NS, 'dsh-manage-session')
})

test('en covers every zh key (no invented keys)', () => {
  for (const key of Object.keys(en)) assert.ok(key in zh, `en invents key ${key}`)
  for (const key of Object.keys(zh)) assert.ok(key in en, `en misses key ${key}`)
})

test('no dictionary value is empty', () => {
  for (const [locale, dict] of Object.entries(dictionaries)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale}.${key} is not a string`)
      assert.ok(value.length > 0, `${locale}.${key} is empty`)
    }
  }
})

test('partial locales only carry zh keys', () => {
  for (const key of Object.keys(ja)) assert.ok(key in zh, `ja invents key ${key}`)
})

test('translate falls back to zh, then the key', () => {
  const anyKey = 'panel.untitled'
  assert.equal(translate(undefined, anyKey), zh[anyKey])
  assert.equal(translate(() => '', anyKey), zh[anyKey])
})

test('a live locale callback wins over the dictionary', () => {
  assert.equal(translate((key) => (key === 'card.title' ? 'Suchen' : ''), 'card.title'), 'Suchen')
  assert.equal(translate((key) => (key === 'panel.untitled' ? 'Suchen' : ''), 'panel.untitled'), 'Suchen')
})
