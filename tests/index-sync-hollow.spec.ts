// @ts-nocheck — issue #1 hollow 补录的回归用例
/**
 * issue #1 的回归锁（0.5.4 前的行为是三轮 poll 全部 updated=0）：
 * - hollow 行（有表头无正文）不再被 version 对齐豁免,下一轮即补录。
 * - 无可索引文本的真空会话重读一次后落 confirmedEmpty,不热循环。
 * - header-only 的 legacy 归档行（upsertArchivedHeader/旧快照产物）同样补正文。
 * - listHollowSessions 体检面精确性。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { SwitchIndexEngine, SwitchWatermarkSync } from '../src/index.ts'

function makeEngine() {
  const engine = new SwitchIndexEngine({ path: join(mkdtempSync(join(tmpdir(), 'switch-hollow-')), 'index.sqlite') })
  return engine
}

function userMessage(seq, text) {
  return { seq, type: 'user/message', time: 1000 + seq, data: { content: [{ type: 'text', text }] } }
}

const INDEXABLE_EVENTS = [userMessage(0, '装谷歌浏览器 Chrome')]

test('hollow 行（importSessionDocs 空 docs + 宿主同版本）下一轮即补录', async () => {
  const engine = makeEngine()
  await engine.open()
  // 造 hollow 态:表头行带 version=4,零正文。
  engine.importSessionDocs({ sessionId: 's-1', version: 4, title: 't', docs: [] })
  const sync = new SwitchWatermarkSync(engine, {
    listSessions: async () => [{ header: { id: 's-1', version: 4, createdAt: 1, cwd: '/x' } }],
    readSession: async (id) => ({ session: { id, version: 4, createdAt: 1, cwd: '/x' }, events: INDEXABLE_EVENTS }),
  }, () => ({ archivedSessionIds: [] }), () => {})

  const round1 = await sync.poll()
  assert.equal(round1.updated, 1, '轮1:hollow 行必须被重读')
  assert.equal(engine.exportSessionDocs('s-1').length, 1)
  assert.equal(engine.search({ query: '谷歌浏览器' }).length, 1, '正文入 FTS')

  const round2 = await sync.poll()
  assert.equal(round2.updated, 0, '轮2:版本对齐且有正文 → 正常跳过')
  engine.close()
})

test('真空会话（重读后产出 0 docs）不热循环:第二轮不再调用 readSession', async () => {
  const engine = makeEngine()
  await engine.open()
  engine.importSessionDocs({ sessionId: 'empty-1', version: 2, title: 't', docs: [] })
  let reads = 0
  const sync = new SwitchWatermarkSync(engine, {
    listSessions: async () => [{ header: { id: 'empty-1', version: 2, createdAt: 1, cwd: '/x' } }],
    readSession: async (id) => {
      reads += 1
      // 没有任何可索引文本的事件 → buildIndexDocuments 产出 0 docs。
      return { session: { id, version: 2, createdAt: 1, cwd: '/x' }, events: [{ seq: 0, type: 'session/title', data: { title: '空' } }] }
    },
  }, () => ({ archivedSessionIds: [] }), () => {})

  await sync.poll()
  assert.equal(reads, 1, '轮1:hollow 行重读一次')
  await sync.poll()
  assert.equal(reads, 1, '轮2:confirmedEmpty 命中,不再重读')
  engine.close()
})

test('header-only 的 legacy 归档行在覆盖循环里补正文', async () => {
  const engine = makeEngine()
  await engine.open()
  // 旧快照兼容路径落下的 header-only 归档行。
  engine.upsertArchivedHeader({ sessionId: 'arch-hollow', version: 9, title: '旧归档', cwd: '/x' })
  const sync = new SwitchWatermarkSync(engine, {
    listSessions: async () => [], // 归档被 listSessions 过滤,只走覆盖循环。
    readSession: async (id) => ({ session: { id, version: 9, createdAt: 5, cwd: '/x' }, events: [userMessage(0, '归档里的琥珀正文')] }),
  }, () => ({ archivedSessionIds: ['arch-hollow'] }), () => {})

  const state = await sync.poll()
  assert.equal(state.failures.length, 0)
  assert.equal(state.updated, 1, 'hollow 归档行被覆盖循环重读')
  assert.ok(engine.hasSessionDocs('arch-hollow'), '正文入索引')
  assert.equal(engine.search({ query: '琥珀正文', archived: 'archived' }).length, 1)
  const round2 = await sync.poll()
  assert.equal(round2.updated, 0, '补录后不再重复重读')
  engine.close()
})

test('listHollowSessions 精确返回有表头无正文的行', async () => {
  const engine = makeEngine()
  await engine.open()
  engine.importSessionDocs({ sessionId: 'ok-1', version: 1, docs: [{ seq: 0, type: 'user/message', surface: 'current', time: 1, text: '有正文' }] })
  engine.importSessionDocs({ sessionId: 'hollow-1', version: 1, docs: [] })
  engine.importSessionDocs({ sessionId: 'hollow-2', version: 1, docs: [] })
  engine.upsertArchivedHeader({ sessionId: 'hollow-3', version: 1 })
  assert.deepEqual(engine.listHollowSessions(), ['hollow-1', 'hollow-2', 'hollow-3'])
  engine.removeSession('hollow-2')
  assert.deepEqual(engine.listHollowSessions(), ['hollow-1', 'hollow-3'], '整行删除后不再计入(行都没了不算 hollow)')
  engine.close()
})
