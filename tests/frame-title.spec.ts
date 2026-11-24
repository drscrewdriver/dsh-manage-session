/**
 * 首帧标题读（Tier 2）回归。
 *
 * 这组用例钉住三件容易被「顺手优化」砸掉的性质：
 * 1. 命中即停：只解压到出现 `session/title` 的帧（`frames` 远小于文件帧数）；
 * 2. 边界不误伤：无 title / 首帧即 title / 第 N 帧才 title 三条语料结果分别为
 *    `none` / 命中 / 命中；
 * 3. 退化不抛错：明文产物（`compression=none`）与撕裂尾帧都必须降级为
 *    「读到哪算哪」，不得让整批流失败。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_TITLE_WINDOW_BYTES,
  locateSessionLog,
  readTitleByFrames,
  scanZstdFrames,
} from '../src/host/catalog/frame-title.ts'

const HEADER = { type: 'session', version: 4, id: 'session-fx', createdAt: 1, cwd: 'C:/tmp' }

/** 一帧 = 若干 JSONL 行（模拟宿主「头帧 + 追加帧」的物理布局）。 */
function frame(rows: readonly unknown[]): Buffer {
  return zstdCompressSync(Buffer.from(`${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8'))
}

const title = (value: string, seq: number): unknown => ({ type: 'session/title', seq, time: seq, data: { title: value } })
const plain = (seq: number): unknown => ({ type: 'message/user', seq, time: seq, data: { text: `row ${seq}` } })

/** 确定性伪随机噪声行（保证压缩后仍显著大于首窗，用来逼出窗口扩张）。 */
function noiseRows(count: number, width: number, offset = 0): unknown[] {
  let seed = 0x2f6e2b1
  const next = (): number => {
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    return seed
  }
  const rows: unknown[] = []
  for (let index = 0; index < count; index += 1) {
    let text = ''
    while (text.length < width) text += next().toString(16).padStart(8, '0')
    rows.push({ type: 'assistant/text', seq: offset + index, time: offset + index, data: { text } })
  }
  return rows
}

/** 在临时目录里落一个会话日志文件。 */
function tempLog(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'steward-frame-title-'))
  const file = join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, bytes)
  return file
}

describe('scanZstdFrames（复用 decode.ts 的同构实现）', () => {
  it('识别拼接的完整帧，start/end 连续', () => {
    const buffer = Buffer.concat([frame([HEADER]), frame([plain(0)]), frame([plain(1)])])
    const { frames, tornStart } = scanZstdFrames(buffer)
    expect(frames).toHaveLength(3)
    expect(tornStart).toBeUndefined()
    expect(frames[0]?.start).toBe(0)
    expect(frames[1]?.start).toBe(frames[0]?.end)
    expect(frames[2]?.end).toBe(buffer.length)
  })

  it('截断的末帧返回 tornStart 而不是抛错', () => {
    const whole = frame([title('torn', 0)])
    const cut = whole.subarray(0, Math.max(8, whole.length - 5))
    const { frames, tornStart } = scanZstdFrames(cut)
    expect(frames).toHaveLength(0)
    expect(tornStart).toBe(0)
  })
})

describe('readTitleByFrames：首窗 × 命中即停', () => {
  it('首帧即 title：一帧命中，只读一个窗口', async () => {
    const file = tempLog(Buffer.concat([frame([HEADER]), frame([title('first frame', 0)]), frame([plain(1)])]))
    const hit = await readTitleByFrames(file)
    expect(hit.source).toBe('prefix')
    expect(hit.title).toBe('first frame')
    expect(hit.frames).toBe(2)
    expect(hit.windows).toEqual([hit.bytesRead])
    expect(hit.bytesRead).toBeLessThanOrEqual(CATALOG_TITLE_WINDOW_BYTES)
  })

  it('第 8 帧才出现 title：前 7 帧读完后命中，不越界扫尾', async () => {
    const frames: Buffer[] = [frame([HEADER])]
    for (let index = 0; index < 7; index += 1) frames.push(frame([plain(index)]))
    frames.push(frame([title('late-ish', 8)]))
    frames.push(frame([plain(9)]))
    const file = tempLog(Buffer.concat(frames))
    const hit = await readTitleByFrames(file)
    expect(hit.source).toBe('prefix')
    expect(hit.title).toBe('late-ish')
    // 命中在解压到第 9 帧时就返回，最后一帧不会被解压。
    expect(hit.frames).toBe(9)
  })

  it('无 title 的会话：读完允许范围后如实报 none', async () => {
    const file = tempLog(Buffer.concat([frame([HEADER]), frame([plain(0)]), frame([plain(1)])]))
    const hit = await readTitleByFrames(file)
    expect(hit.source).toBe('none')
    expect(hit.title).toBeUndefined()
    expect(hit.frames).toBe(3)
  })

  it('大文件（压缩后 > 首窗）会按 ×4 扩张窗口再命中', async () => {
    const frames: Buffer[] = [frame([HEADER])]
    for (let batch = 0; batch < 8; batch += 1) frames.push(frame(noiseRows(20, 6000, batch * 20)))
    frames.push(frame([title('after expansion', 200)]))
    const file = tempLog(Buffer.concat(frames))
    const hit = await readTitleByFrames(file)
    expect(hit.source).toBe('prefix')
    expect(hit.title).toBe('after expansion')
    expect(hit.windows.length).toBeGreaterThanOrEqual(2)
    expect(hit.windows[0]).toBe(Math.min(CATALOG_TITLE_WINDOW_BYTES, hit.bytesRead))
    expect(hit.bytesRead).toBeLessThanOrEqual(hit.windows.at(-1) ?? 0)
  })

  it('帧数上限内没命中就停（不无限读）', async () => {
    const frames: Buffer[] = [frame([HEADER])]
    for (let index = 0; index < 12; index += 1) frames.push(frame([plain(index)]))
    frames.push(frame([title('beyond cap', 99)]))
    const file = tempLog(Buffer.concat(frames))
    const hit = await readTitleByFrames(file, { maxFrames: 4 })
    expect(hit.source).toBe('none')
    expect(hit.frames).toBe(4)
  })

  it('明文产物（compression=none）走回退分支而不抛错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'steward-frame-plain-'))
    const file = join(dir, 'session.v4.jsonl')
    writeFileSync(file, `${JSON.stringify(HEADER)}\n${JSON.stringify(plain(0))}\n${JSON.stringify(title('plain text', 1))}\n`)
    const hit = await readTitleByFrames(file)
    expect(hit.source).toBe('prefix')
    expect(hit.title).toBe('plain text')
    expect(hit.frames).toBe(0)
  })

  it('撕裂尾帧（截断文件）不导致整体失败', async () => {
    const good = frame([title('survives', 0)])
    const torn = frame([plain(1)])
    const file = tempLog(Buffer.concat([frame([HEADER]), good, torn.subarray(0, torn.length - 6)]))
    const hit = await readTitleByFrames(file)
    expect(hit.source).toBe('prefix')
    expect(hit.title).toBe('survives')
  })

  it('空文件 / 不存在的文件都不抛错', async () => {
    const empty = tempLog(Buffer.alloc(0))
    expect((await readTitleByFrames(empty)).source).toBe('none')
    expect((await readTitleByFrames(join(tmpdir(), 'definitely-missing-session.log'))).source).toBe('none')
  })
})

describe('locateSessionLog：只走白名单定位，不拼路径', () => {
  it('按代次取当前代产物', () => {
    const home = mkdtempSync(join(tmpdir(), 'steward-home-'))
    const dir = join(home, 'sessions', 'ws-1', 'session-b5bc0000')
    mkdirSync(dir, { recursive: true })
    const legacy = join(dir, 'session.jsonl.zstd')
    const current = join(dir, 'session.v4.jsonl.zstd')
    writeFileSync(legacy, frame([HEADER]))
    writeFileSync(current, frame([HEADER]))
    expect(locateSessionLog('session-b5bc0000', home)).toBe(current)
  })

  it('IM 虚拟会话（磁盘上没有目录）返回 undefined，不抛错', () => {
    const home = mkdtempSync(join(tmpdir(), 'steward-home-'))
    mkdirSync(join(home, 'sessions'), { recursive: true })
    expect(locateSessionLog('im:union:weixin:dm:abc', home)).toBeUndefined()
    expect(locateSessionLog('session-unknown-id', home)).toBeUndefined()
  })

  it('目录存在但没有规范产物时返回 undefined（不猜文件名）', () => {
    const home = mkdtempSync(join(tmpdir(), 'steward-home-'))
    const dir = join(home, 'sessions', 'ws-1', 'session-nolog')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.migration.0123456789abcdef.jsonl.zstd.tmp'), frame([HEADER]))
    expect(locateSessionLog('session-nolog', home)).toBeUndefined()
  })
})
