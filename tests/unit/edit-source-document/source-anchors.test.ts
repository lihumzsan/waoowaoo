import { describe, expect, it } from 'vitest'
import {
  buildEditSourceBlocks,
  formatEditSourceBlocksForPrompt,
  resolveEditSourceAnchor,
  resolveEditSourcePointAnchor,
  type EditSourceBlock,
} from '@/lib/edit-source-document'

describe('edit source anchors', () => {
  it('formats source blocks with stable ids for model anchoring', () => {
    const blocks = buildEditSourceBlocks('老李启动机器。蓝光照亮地下室。时间开始倒流。', {
      minChars: 4,
      targetChars: 14,
    })

    expect(blocks.map((block) => block.blockId)).toEqual(['p0001', 'p0002', 'p0003'])
    expect(formatEditSourceBlocksForPrompt(blocks)).toContain('[p0001]\n老李启动机器。')
    expect(formatEditSourceBlocksForPrompt(blocks)).toContain('[p0003]\n时间开始倒流。')
  })

  it('resolves block and quote anchors into deterministic source ranges', () => {
    const sourceText = '老李启动机器。蓝光照亮地下室。时间开始倒流。'
    const blocks: readonly EditSourceBlock[] = [{
      blockId: 'p0001',
      sourceStart: 0,
      sourceEnd: sourceText.length,
      text: sourceText,
    }]

    const range = resolveEditSourceAnchor({
      sourceText,
      blocks,
      anchor: {
        startBlockId: 'p0001',
        startQuote: '蓝光照亮',
        endBlockId: 'p0001',
        endQuote: '地下室。',
      },
    })

    expect(range).toEqual({
      sourceStart: sourceText.indexOf('蓝光照亮'),
      sourceEnd: sourceText.indexOf('地下室。') + '地下室。'.length,
    })
  })

  it('resolves first-evidence point anchors without asking the model for offsets', () => {
    const sourceText = '老李启动机器。蓝光照亮地下室。'
    const blocks: readonly EditSourceBlock[] = [{
      blockId: 'p0001',
      sourceStart: 0,
      sourceEnd: sourceText.length,
      text: sourceText,
    }]

    expect(resolveEditSourcePointAnchor({
      sourceText,
      blocks,
      anchor: { blockId: 'p0001', quote: '地下室' },
    })).toBe(sourceText.indexOf('地下室'))
  })

  it('fails explicitly when a quote is not present in the declared block', () => {
    const sourceText = '老李启动机器。'
    const blocks: readonly EditSourceBlock[] = [{
      blockId: 'p0001',
      sourceStart: 0,
      sourceEnd: sourceText.length,
      text: sourceText,
    }]

    expect(() => resolveEditSourceAnchor({
      sourceText,
      blocks,
      anchor: {
        startBlockId: 'p0001',
        startQuote: '不存在',
        endBlockId: 'p0001',
        endQuote: '机器。',
      },
    })).toThrow('EDIT_SOURCE_ANCHOR_QUOTE_NOT_FOUND')
  })
})
