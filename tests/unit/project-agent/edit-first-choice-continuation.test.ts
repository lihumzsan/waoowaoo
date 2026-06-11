import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { resolveEditFirstChoiceContinuation } from '@/lib/project-agent/edit-first-choice-continuation'

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function assistantChoiceOutputMessage(id: string, output: Record<string, unknown>): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{
      type: 'tool-request_edit_first_choice',
      toolCallId: 'tool-call-1',
      state: 'output-available',
      output,
    } as unknown as UIMessage['parts'][number]],
  }
}

describe('resolveEditFirstChoiceContinuation', () => {
  it('continues to screenplay generation after duration and aspect ratio are selected', () => {
    const continuation = resolveEditFirstChoiceContinuation([
      userMessage('user-1', '民俗恐怖片'),
      assistantChoiceOutputMessage('assistant-1', {
        ok: true,
        choiceType: 'duration_and_aspect_ratio',
        durationSeconds: 60,
        aspectRatio: '16:9',
        selections: {
          durationSeconds: '60',
          aspectRatio: '16:9',
        },
      }),
    ])

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_screenplay',
    }))
    expect(continuation?.instruction).toContain('用户原始创意需求："民俗恐怖片"')
    expect(continuation?.instruction).toContain('durationSeconds=60')
    expect(continuation?.instruction).toContain('aspectRatio=16:9')
    expect(continuation?.instruction).toContain('必须直接调用 generate_edit_screenplay')
  })

  it('continues to style preview generation after screenplay approval', () => {
    const continuation = resolveEditFirstChoiceContinuation([
      userMessage('user-1', '生成一部科幻短片'),
      assistantChoiceOutputMessage('assistant-1', {
        ok: true,
        choiceType: 'screenplay_review',
        decision: 'approve',
      }),
    ])

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_style_previews',
    }))
    expect(continuation?.instruction).toContain('剧本审核卡已经返回用户确认')
    expect(continuation?.instruction).toContain('必须直接调用 generate_edit_style_previews')
  })

  it('continues to screenplay revision after screenplay notes are submitted', () => {
    const continuation = resolveEditFirstChoiceContinuation([
      userMessage('user-1', '生成一部科幻短片'),
      assistantChoiceOutputMessage('assistant-1', {
        ok: true,
        choiceType: 'screenplay_review',
        decision: 'revise',
        revisionNotes: '更克苏鲁一些',
      }),
    ])

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'revise_edit_screenplay',
    }))
    expect(continuation?.instruction).toContain('用户修改意见："更克苏鲁一些"')
    expect(continuation?.instruction).toContain('必须直接调用 revise_edit_screenplay')
  })

  it('continues to director decoupage after style selection is saved', () => {
    const continuation = resolveEditFirstChoiceContinuation([
      userMessage('user-1', '生成一部民俗恐怖短片'),
      assistantChoiceOutputMessage('assistant-1', {
        ok: true,
        choiceType: 'style',
        stylePreviewId: 'style-1',
        aspectRatio: '9:16',
      }),
    ])

    expect(continuation).toEqual(expect.objectContaining({
      operationId: 'generate_edit_director_decoupage',
    }))
    expect(continuation?.instruction).toContain('stylePreviewId=style-1')
    expect(continuation?.instruction).toContain('必须直接调用 generate_edit_director_decoupage')
  })

  it('ignores stale choice output once a later user message exists', () => {
    const continuation = resolveEditFirstChoiceContinuation([
      userMessage('user-1', '民俗恐怖片'),
      assistantChoiceOutputMessage('assistant-1', {
        ok: true,
        choiceType: 'duration_and_aspect_ratio',
        durationSeconds: 60,
        aspectRatio: '16:9',
      }),
      userMessage('user-2', '等一下，先不要生成'),
    ])

    expect(continuation).toBeNull()
  })
})
