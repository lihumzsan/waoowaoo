import type OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const executeAiTextStepMock = vi.hoisted(() => vi.fn())
const executeAiVisionStepMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: executeAiTextStepMock,
  executeAiVisionStep: executeAiVisionStepMock,
}))

import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { withLogContext } from '@/lib/logging/context'

function completion(text: string) {
  return {
    text,
    reasoning: '',
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    },
    completion: {
      id: 'chatcmpl-structured-step',
      object: 'chat.completion',
      created: 0,
      model: 'test-model',
      choices: [],
    } as unknown as OpenAI.Chat.Completions.ChatCompletion,
  }
}

const baseInput = {
  userId: 'user-1',
  model: 'llm::test',
  messages: [{ role: 'user' as const, content: 'return json' }],
  projectId: 'project-1',
  action: 'unit.structured',
  meta: {
    stepId: 'step-1',
    stepTitle: 'Structured Step',
    stepIndex: 1,
    stepTotal: 1,
  },
}

describe('executeAiStructuredTextStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries invalid JSON with the original clean prompt at most three times', async () => {
    executeAiTextStepMock.mockResolvedValue(completion('not json'))

    await expect(executeAiStructuredTextStep({
      ...baseInput,
      parse: { kind: 'object' },
      schema: z.object({ name: z.string() }),
    })).rejects.toMatchObject({
      code: 'PARSE_ERROR',
      retryable: true,
    })
    expect(executeAiTextStepMock).toHaveBeenCalledTimes(3)
    for (const [retryInput] of executeAiTextStepMock.mock.calls) {
      expect(retryInput.messages).toEqual(baseInput.messages)
    }
  })

  it('rejects business validation failures without adding a repair message', async () => {
    executeAiTextStepMock.mockResolvedValue(completion('{"segments":[{"duration":17}]}'))

    await expect(executeAiStructuredTextStep({
      ...baseInput,
      parse: { kind: 'object' },
      schema: z.object({
        segments: z.array(z.object({
          duration: z.number(),
        })),
      }),
      validate: (parsed) => {
        for (const segment of parsed.segments) {
          if (segment.duration > 10) {
            throw new Error(`generation segment duration exceeds provider limit: ${String(segment.duration)}`)
          }
        }
        return parsed
      },
    })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_SCHEMA_INVALID', retryable: true })
    expect(executeAiTextStepMock).toHaveBeenCalledTimes(3)
    for (const [retryInput] of executeAiTextStepMock.mock.calls) {
      expect(retryInput.messages).toEqual(baseInput.messages)
    }
  })

  it('classifies an empty body before JSON parsing', async () => {
    executeAiTextStepMock.mockResolvedValue(completion('   '))

    await expect(executeAiStructuredTextStep({
      ...baseInput,
      parse: { kind: 'object' },
      schema: z.object({ name: z.string() }),
    })).rejects.toMatchObject({
      code: 'EMPTY_RESPONSE',
      retryable: true,
    })
    expect(executeAiTextStepMock).toHaveBeenCalledTimes(3)
  })

  it('uses one model request per async Task attempt so the queue owns retries', async () => {
    executeAiTextStepMock.mockResolvedValue(completion('not json'))

    await expect(withLogContext({ taskId: 'task-1', taskAttempt: 1 }, async () => (
      await executeAiStructuredTextStep({
        ...baseInput,
        parse: { kind: 'object' },
        schema: z.object({ name: z.string() }),
      })
    ))).rejects.toMatchObject({ code: 'PARSE_ERROR', retryable: true })

    expect(executeAiTextStepMock).toHaveBeenCalledTimes(1)
  })
})
