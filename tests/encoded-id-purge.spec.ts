import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  decodeSegment,
  dirNameCandidates,
  encodeSegment,
  indexSessionDirs,
  locateSessionUsage,
  purgeHistory,
  sessionsRootFor,
} from '../src/host/history/purge.ts'

/**
 * 编码名会话（`im:` / `imu:`）的定位与删除契约。
 *
 * 宿主把会话 id 里的非法字符编码成 `~XXXX` 当目录名；只剥 `session-` 前缀的实现
 * 会“记账清了、目录还在”——墓碑区就会留下 `deleted` 但实体仍在的条目。
 */

const cleanups: string[] = []
afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ms-encoded-'))
  cleanups.push(home)
  return home
}

const IM_ID = 'im:weixin_demo:dm:1792662849907:o9cq803c@im.wechat'
const ENCODED = 'im~003Aweixin_demo~003Adm~003A1792662849907~003Ao9cq803c~0040im.wechat'

describe('encode/decode', () => {
  it('编码与宿主同构，且可逆', () => {
    expect(encodeSegment(IM_ID)).toBe(ENCODED)
    expect(decodeSegment(ENCODED)).toBe(IM_ID)
    expect(dirNameCandidates(IM_ID)).toContain(ENCODED)
  })
})

describe('编码名目录：索引 / 定位 / 真删', () => {
  it('索引能按解码后的 id 命中，locateSessionUsage 能拿到目录与缓存', () => {
    const home = tempHome()
    const dir = join(sessionsRootFor(home), '--w--', ENCODED)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(32))
    mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', `${ENCODED}.json`), '{}')

    const index = indexSessionDirs(sessionsRootFor(home))
    expect(index.get(IM_ID)).toBe(dir)

    const usage = locateSessionUsage([IM_ID], home).get(IM_ID)
    expect(usage?.dir).toBe(dir)
    expect(usage?.bytes).toBeGreaterThan(0)
    expect(usage?.cacheFile).toContain(`${ENCODED}.json`)
  })

  it('purgeHistory 能删掉编码名目录与缓存，并摘除归档集合', () => {
    const home = tempHome()
    const dir = join(sessionsRootFor(home), '--w--', ENCODED)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(32))
    const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, `${ENCODED}.json`), '{}')
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      global: { archivedSessionIds: [IM_ID] },
      tables: { workspaces: { w1: { path: 'E:\\test\\doresearch', sessionIds: [IM_ID] } } },
    }, null, 2)}\n`)

    const result = purgeHistory({ sessionIds: [IM_ID] }, undefined, { dshHome: home })
    expect(result.ok).toBe(true)
    expect(result.purged).toBe(1)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(join(cacheDir, `${ENCODED}.json`))).toBe(false)
  })
})