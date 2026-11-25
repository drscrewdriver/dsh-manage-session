#!/usr/bin/env node
/**
 * `session-filter.ts` 契约：README 里承诺的「按工作区搜索」必须真的成立。
 *
 * Usage: node --import tsx tests/client-filter.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { matchesCatalogText } = await import('../src/client/session-filter.ts')

const row = { sessionId: 's1', title: '归档清理', cwd: 'E:\\test\\doresearch' }

test('空串不过滤', () => {
  assert.equal(matchesCatalogText(row, ''), true)
  assert.equal(matchesCatalogText(row, '   '), true)
})

test('普通子串比标题与 cwd（大小写折叠）', () => {
  assert.equal(matchesCatalogText(row, '归档'), true)
  assert.equal(matchesCatalogText(row, 'DORESEARCH'), true)
  assert.equal(matchesCatalogText(row, '不存在'), false)
})

test('`工作区:` 前缀只比 cwd', () => {
  assert.equal(matchesCatalogText(row, '工作区:research'), true)
  assert.equal(matchesCatalogText(row, '工作区:e:\\test'), true)
  // 标题里有「归档」，但工作区前缀只比 cwd → 不命中
  assert.equal(matchesCatalogText(row, '工作区:归档'), false)
})

test('`workspace:` 英文前缀等价，全角冒号也认', () => {
  assert.equal(matchesCatalogText(row, 'workspace: research'), true)
  assert.equal(matchesCatalogText(row, 'workspace：research'), true)
  assert.equal(matchesCatalogText(row, '工作区：'), true)
})

test('前缀后为空 = 不过滤', () => {
  assert.equal(matchesCatalogText(row, '工作区:'), true)
  assert.equal(matchesCatalogText(row, 'workspace:   '), true)
})