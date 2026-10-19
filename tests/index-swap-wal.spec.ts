// @ts-nocheck — issue #1 评论（swap 遗留 WAL sidecar 损坏索引）的回归用例
/**
 * - swap 必须处理主文件旁的 -wal/-shm 残留：同名顶替的新库若继承旧库 WAL,
 *   帧页号错配 → database disk image is malformed。两个残留场景（有主文件的
 *   随迁 archive、无主文件的孤儿清理）在 Windows 上可确定性复现;多连接实时
 *   WAL 场景因 SQLite 不开 DELETE 共享位在本平台连旧主文件都 rename 不动,
 *   不属于本次修复引入的边界,不在此复现。
 * - swap 后 integrity_check 非 ok → 损坏库改名 .corrupt、从最新 archive 自动
 *   回滚,rebuild state 置 error（把「索引损坏」降级为「回到上次快照」）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { SwitchIndexEngine, importIntoIndex, swapShadowIntoActive, DEFAULT_INDEX_LAYOUT } from '../src/index.ts'

function tempDir(label) {
  return mkdtempSync(join(tmpdir(), `switch-swap-${label}-`))
}

function userMessage(seq, text) {
  return { seq, type: 'user/message', time: 1000 + seq, data: { content: [{ type: 'text', text }] } }
}

/** 备好一个内容真实的影子库（swap 的 building 侧）。 */
async function seedShadow(dir, layout, text) {
  const shadow = new SwitchIndexEngine({ path: join(dir, layout.building) })
  await shadow.open()
  shadow.upsertSession({ sessionId: 'n', version: 1, events: [userMessage(0, text)] })
  shadow.close()
}

test('swap 把残留的 -wal/-shm 随主文件一并迁 archive', async () => {
  const dir = tempDir('carry')
  const layout = { ...DEFAULT_INDEX_LAYOUT, dir }
  const activePath = join(dir, layout.active)
  const engineA = new SwitchIndexEngine({ path: activePath })
  await engineA.open()
  engineA.upsertSession({ sessionId: 'a', version: 1, events: [userMessage(0, '旧库的琥珀正文')] })
  engineA.close() // 干净关闭自删 sidecar,手动造出「异常关闭残留」
  writeFileSync(activePath + '-wal', 'stale-wal-bytes')
  writeFileSync(activePath + '-shm', 'stale-shm-bytes')
  await seedShadow(dir, layout, '新库的海棠正文')

  const engine = new SwitchIndexEngine({ path: activePath })
  await swapShadowIntoActive(engine, layout)
  try {
    assert.equal(engine.integrityCheck(), 'ok', 'swapped-in db is not poisoned by the stale wal')
    assert.equal(engine.search({ query: '海棠正文' }).length, 1)
    assert.equal(engine.search({ query: '琥珀正文' }).length, 0, 'fresh shadow, not the old db')
    // active 路径不再有旧残留内容:
    if (existsSync(activePath + '-wal')) {
      assert.notEqual(readFileSync(activePath + '-wal', 'utf8'), 'stale-wal-bytes', 'stale wal must not survive at active path')
    }
    // 残留随 archive 迁走（可追溯,不进新库）:
    const names = readdirSync(dir)
    const archived = names.filter(n => n.startsWith(layout.archivePrefix) && n.endsWith('.sqlite'))
    assert.equal(archived.length, 1, 'archive created')
    assert.equal(readFileSync(join(dir, archived[0] + '-wal'), 'utf8'), 'stale-wal-bytes', 'sidecar travelled with the archive')
  } finally {
    engine.close()
  }
})

test('swap 清理孤儿 sidecar（主文件已不在,-wal/-shm 残留）', async () => {
  const dir = tempDir('orphan')
  const layout = { ...DEFAULT_INDEX_LAYOUT, dir }
  const activePath = join(dir, layout.active)
  // 崩溃窗口现场：active 主文件缺失,孤儿 sidecar 滞留。
  writeFileSync(activePath + '-wal', 'orphan-wal')
  writeFileSync(activePath + '-shm', 'orphan-shm')
  await seedShadow(dir, layout, '影子库的补齐正文')

  const engine = new SwitchIndexEngine({ path: activePath })
  await swapShadowIntoActive(engine, layout)
  try {
    assert.equal(engine.integrityCheck(), 'ok')
    assert.equal(engine.search({ query: '补齐正文' }).length, 1)
    if (existsSync(activePath + '-wal')) {
      assert.notEqual(readFileSync(activePath + '-wal', 'utf8'), 'orphan-wal', 'orphan wal cleared before the new db opens')
    }
  } finally {
    engine.close()
  }
})

test('swap 后完整性失败:损坏库改名 .corrupt 并从 archive 自动回滚', async () => {
  const dir = tempDir('rollback')
  const layout = { ...DEFAULT_INDEX_LAYOUT, dir }
  const engine = new SwitchIndexEngine({ path: join(dir, layout.active) })
  await engine.open()
  engine.upsertSession({ sessionId: 'a', version: 1, events: [userMessage(0, '可回滚的琥珀正文')] })
  // 模拟 swap 后新库已损坏(不真构造物理损坏,打桩判定面)。
  engine.integrityCheck = () => 'fake damage report'
  const state = await importIntoIndex(engine, layout, [{
    sessionId: 'x', version: 1, title: 'x',
    docs: [{ seq: 0, type: 'user/message', surface: 'current', time: 1, text: '导入的新正文' }],
  }], 2)
  engine.integrityCheck = SwitchIndexEngine.prototype.integrityCheck
  assert.equal(state.state, 'error', 'failed integrity gate surfaces as rebuild error')
  assert.match(String(state.error), /integrity check failed/)
  const names = readdirSync(dir)
  assert.ok(names.some(n => n.includes('corrupt')), 'damaged swap result renamed aside')
  assert.equal(engine.isOpen, true, 'rolled-back handle reopened')
  assert.equal(engine.integrityCheck(), 'ok', 'restored archive db is healthy')
  assert.equal(engine.search({ query: '琥珀正文' }).length, 1, 'rolled back to the pre-swap snapshot')
  assert.equal(engine.search({ query: '导入的新正文' }).length, 0, 'the corrupt swap-in is not serving')
  engine.close()
})
