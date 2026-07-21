import {
  beforeEach,
  buildEditFirstChoiceResult,
  describe,
  expect,
  it,
  prismaMock,
  readSyntheticToolResult,
} from './edit-first-choice-result.fixture'

describe('buildEditFirstChoiceResult', () => {
  beforeEach(() => {
    prismaMock.project.updateMany.mockClear()
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
  })

  it('serializes script intake answers as a normalized brief without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'script_intake',
      toolCallId: 'tool-call-1',
      latestUserText: '恐怖故事',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          subgenre: 'folk_horror',
          setting: 'old_village',
        },
        labels: {
          subgenreLabel: '民俗恐怖',
          settingLabel: '偏远旧村',
        },
        freeText: '主角是返乡参加葬礼的姐姐。',
      },
    })

    const { name, parsed } = readSyntheticToolResult(choiceResult)
    expect(name).toBe('request_script_intake_choice')
    expect(parsed.decision).toBe('submit')
    expect(parsed.normalizedBrief).toBe([
      '恐怖故事',
      '- 民俗恐怖',
      '- 偏远旧村',
      '主角是返乡参加葬礼的姐姐。',
    ].join('\n'))
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes bible approval without owning project aspect-ratio confirmation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('approve')
    expect(parsed.aspectRatio).toBeUndefined()
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes bible revision notes without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '更克苏鲁一些',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.nextOperationId).toBeUndefined()
    expect(parsed.revisionNotes).toBe('更克苏鲁一些')
  })

  it('serializes script approval without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
      latestUserText: '确认剧本',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    const { name, parsed } = readSyntheticToolResult(choiceResult)
    expect(name).toBe('request_edit_script_review_choice')
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes script revision notes without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
      latestUserText: '结尾太暖',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '结尾更冷峻，不要解释因果悖论',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('revise')
    expect(parsed.revisionNotes).toBe('结尾更冷峻，不要解释因果悖论')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes style selection without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'style',
      toolCallId: 'tool-style-1',
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        stylePreviewId: 'style-1',
        aspectRatio: '9:16',
      },
    })

    const { callId, parsed } = readSyntheticToolResult(choiceResult)
    expect(callId).toBe('tool-style-1')
    expect(parsed.stylePreviewId).toBe('style-1')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes asset review approval without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes asset review revision notes without approving assets', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
      latestUserText: '场景太现代',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('revise')
    expect(parsed.revisionNotes).toBe('把祠堂场景调得更旧，空间关系更压迫')
    expect(parsed.nextOperationId).toBeUndefined()
  })
})
