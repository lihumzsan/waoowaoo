import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyEditFirstChoiceResultSideEffects,
  buildEditFirstChoiceResult,
} from '@/lib/project-agent/edit-first-choice-result'
import { approveProjectEditScriptAssets } from '@/lib/edit-script/service'

vi.mock('@/lib/edit-script/service', () => ({
  approveProjectEditScriptAssets: vi.fn(async () => undefined),
}))

const approveProjectEditScriptAssetsMock = vi.mocked(approveProjectEditScriptAssets)

function readSyntheticToolResult(choiceResult: ReturnType<typeof buildEditFirstChoiceResult>): {
  callId: string
  name: string
  parsed: Record<string, unknown>
} {
  expect(choiceResult).not.toBeNull()
  const [callItem, resultItem] = choiceResult!.inputItems as Array<Record<string, unknown>>
  expect(callItem.type).toBe('function_call')
  expect(resultItem.type).toBe('function_call_result')
  expect(callItem.callId).toBe(resultItem.callId)
  const output = resultItem.output as { type: string; text: string }
  expect(output.type).toBe('text')
  return {
    callId: String(resultItem.callId),
    name: String(resultItem.name),
    parsed: JSON.parse(output.text) as Record<string, unknown>,
  }
}

describe('buildEditFirstChoiceResult', () => {
  beforeEach(() => {
    approveProjectEditScriptAssetsMock.mockClear()
  })

  it('serializes bible approval without selecting the next operation', () => {
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

  it('serializes style selection without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        stylePreviewId: 'style-1',
        aspectRatio: '9:16',
      },
    })

    const { callId, parsed } = readSyntheticToolResult(choiceResult)
    expect(callId).toMatch(/^edit_first_choice_/)
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

  it('serializes budget confirmation without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'budget_confirmation',
      toolCallId: 'tool-call-budget',
      latestUserText: '确认预算',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('rejects budget confirmation without approval', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'budget_confirmation',
      toolCallId: 'tool-call-budget',
      latestUserText: '等等',
      output: {
        ok: true,
        decision: 'revise',
      },
    })).toBeNull()
  })

  it('rejects a bible review without a decision', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
      },
    })).toBeNull()
  })

  it('rejects a style selection without a preview id', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        aspectRatio: '9:16',
      },
    })).toBeNull()
  })

  it('rejects asset review revision without notes', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: null,
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'revise',
      },
    })).toBeNull()
  })

  it('persists approved asset review as the user decision without selecting the next operation', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEditScriptAssetsMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('does not persist asset review when the user has not approved assets', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: true,
        decision: 'revise',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEditScriptAssetsMock).not.toHaveBeenCalled()
  })

  it('does not persist asset review from a failed choice result', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: false,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEditScriptAssetsMock).not.toHaveBeenCalled()
  })
})
