import { describe, expect, it } from 'vitest'
import { resolveEditFirstChoiceContinuation } from '@/lib/project-agent/edit-first-choice-continuation'

function readSyntheticToolResult(continuation: ReturnType<typeof resolveEditFirstChoiceContinuation>): {
  callId: string
  name: string
  parsed: Record<string, unknown>
} {
  expect(continuation).not.toBeNull()
  const [callItem, resultItem] = continuation!.inputItems as Array<Record<string, unknown>>
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

describe('resolveEditFirstChoiceContinuation', () => {
  it('continues to screenplay generation after duration and aspect ratio are selected', () => {
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-call-1',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        durationTier: 'medium',
        aspectRatio: '16:9',
        selections: {
          durationTier: 'medium',
          aspectRatio: '16:9',
        },
      },
    })

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_screenplay',
    }))
    const { callId, name, parsed } = readSyntheticToolResult(continuation)
    expect(callId).toBe('tool-call-1')
    expect(name).toBe('request_edit_first_choice')
    expect(parsed.choiceType).toBe('duration_and_aspect_ratio')
    expect(parsed.prompt).toBe('民俗恐怖片')
    expect(parsed.durationTier).toBe('medium')
    expect(parsed.aspectRatio).toBe('16:9')
    expect(parsed.nextOperationId).toBe('generate_edit_screenplay')
  })

  it('continues to style preview generation after screenplay approval', () => {
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: 'screenplay_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_style_previews',
    }))
    const { parsed } = readSyntheticToolResult(continuation)
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBe('generate_edit_style_previews')
  })

  it('continues to screenplay revision after screenplay notes are submitted', () => {
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: 'screenplay_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '更克苏鲁一些',
      },
    })

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'revise_edit_screenplay',
    }))
    const { parsed } = readSyntheticToolResult(continuation)
    expect(parsed.nextOperationId).toBe('revise_edit_screenplay')
    expect(parsed.revisionNotes).toBe('更克苏鲁一些')
  })

  it('continues to director decoupage after style selection is saved', () => {
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        stylePreviewId: 'style-1',
        aspectRatio: '9:16',
      },
    })

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_director_decoupage',
    }))
    const { callId, parsed } = readSyntheticToolResult(continuation)
    expect(callId).toMatch(/^edit_first_choice_/)
    expect(parsed.stylePreviewId).toBe('style-1')
    expect(parsed.nextOperationId).toBe('generate_edit_director_decoupage')
  })

  it('continues to cinematography shot plan after asset review approval', () => {
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_cinematography_shot_plan',
    }))
    const { parsed } = readSyntheticToolResult(continuation)
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBe('generate_edit_cinematography_shot_plan')
  })

  it('rejects an incomplete duration/aspect-ratio selection', () => {
    expect(resolveEditFirstChoiceContinuation({
      choiceType: 'duration_and_aspect_ratio',
      toolCallId: 'tool-call-1',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        durationTier: 'medium',
      },
    })).toBeNull()
  })

  it('rejects a screenplay review without a decision', () => {
    expect(resolveEditFirstChoiceContinuation({
      choiceType: 'screenplay_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
      },
    })).toBeNull()
  })

  it('rejects a style selection without a preview id', () => {
    expect(resolveEditFirstChoiceContinuation({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        aspectRatio: '9:16',
      },
    })).toBeNull()
  })

  it('rejects asset review without approval', () => {
    expect(resolveEditFirstChoiceContinuation({
      choiceType: 'asset_review',
      toolCallId: null,
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'revise',
      },
    })).toBeNull()
  })
})
