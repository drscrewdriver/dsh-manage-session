/**
 * T7.4 定位臂纯函数断言：归一化/needle 选择（shadowed 放弃、compressed 走
 * surface_text、短文本放弃、markdown 噪声两侧同抹）。DOM 轮询臂不在本套
 * 件覆盖（依赖真浏览器渲染面，真机 GUI 验证；此处锁数据面决策语义）。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { normalizeForMatch, resolveNeedle, type LocateRowFace } from '../src/client/search/locate.ts'

describe('normalizeForMatch', () => {
  it('抹空白与 markdown 结构符，保留正文', () => {
    assert.equal(normalizeForMatch('**加粗** 与 `code` 混排'), '加粗与code混排')
    assert.equal(normalizeForMatch(''), '')
  })
})

describe('resolveNeedle', () => {
  const base: LocateRowFace = { seq: 1, on_surface: 1, compressed: 0 }

  it('on_surface=0（被替换原文行）放弃定位', () => {
    assert.equal(resolveNeedle({ ...base, on_surface: 0, text: '足够长的原文本内容用于定位匹配' }), null)
  })

  it('无行/全空文本/短文本（歧义面大）放弃定位', () => {
    assert.equal(resolveNeedle(undefined), null)
    assert.equal(resolveNeedle({ ...base, text: '', search_text: '' }), null)
    assert.equal(resolveNeedle({ ...base, text: '好的', search_text: '好的' }), null)
  })

  it('普通行优先 search_text（注入已剥=可见文本面），首行取段', () => {
    const row: LocateRowFace = {
      ...base,
      search_text: '投影同步器的装机链怎么走完的',
      text: '投影同步器的装机链怎么走完的',
    }
    assert.equal(resolveNeedle(row), '投影同步器的装机链怎么走完的')
  })

  it('compressed=1 优先 surface_text（GUI 渲染的是替身文本）', () => {
    const row: LocateRowFace = {
      ...base,
      compressed: 1,
      text: '被压缩的原始长输出内容块',
      surface_text: '替身摘要文本内容也够长呢',
    }
    assert.equal(resolveNeedle(row), '替身摘要文本内容也够长呢')
  })

  it('needle 截前 80 归一化字符（防超长行整串匹配脆）', () => {
    const row: LocateRowFace = { ...base, search_text: 'x'.repeat(200) }
    assert.equal(resolveNeedle(row)?.length, 80)
  })

  it('首行短但整段够长时退整段拼接', () => {
    const row: LocateRowFace = { ...base, search_text: `短\n后面这一大段足够长可以当作定位 needle 的正文` }
    const needle = resolveNeedle(row)
    assert.ok(needle !== null && needle.includes('后面这一大段'))
  })
})
