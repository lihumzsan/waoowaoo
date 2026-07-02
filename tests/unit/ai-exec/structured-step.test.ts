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

  it('repairs invalid JSON by appending the previous output and validation error', async () => {
    executeAiTextStepMock
      .mockResolvedValueOnce(completion('not json'))
      .mockResolvedValueOnce(completion('{"name":"fixed"}'))

    const result = await executeAiStructuredTextStep({
      ...baseInput,
      parse: { kind: 'object' },
      schema: z.object({ name: z.string() }),
    })

    expect(result.data).toEqual({ name: 'fixed' })
    expect(result.repairRounds).toBe(1)
    expect(executeAiTextStepMock).toHaveBeenCalledTimes(2)

    const retryInput = executeAiTextStepMock.mock.calls[1]?.[0] as {
      messages?: Array<{ role: string; content: unknown }>
    } | undefined
    expect(retryInput?.messages?.at(-2)).toEqual({
      role: 'assistant',
      content: 'not json',
    })
    expect(String(retryInput?.messages?.at(-1)?.content)).toContain('PARSE_ERROR')
  })

  it('repairs business validation failures in the same structured step boundary', async () => {
    executeAiTextStepMock
      .mockResolvedValueOnce(completion('{"segments":[{"duration":17}]}'))
      .mockResolvedValueOnce(completion('{"segments":[{"duration":5}]}'))

    const result = await executeAiStructuredTextStep({
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
    })

    expect(result.data).toEqual({ segments: [{ duration: 5 }] })
    expect(result.repairRounds).toBe(1)
    const retryInput = executeAiTextStepMock.mock.calls[1]?.[0] as {
      messages?: Array<{ role: string; content: unknown }>
    } | undefined
    expect(String(retryInput?.messages?.at(-1)?.content)).toContain('generation segment duration exceeds provider limit: 17')
  })

  it('throws non-retryable schema errors after repair rounds are exhausted', async () => {
    executeAiTextStepMock
      .mockResolvedValueOnce(completion('{"name":123}'))
      .mockResolvedValueOnce(completion('{"name":456}'))

    await expect(executeAiStructuredTextStep({
      ...baseInput,
      parse: { kind: 'object' },
      schema: z.object({ name: z.string() }),
      maxRepairRounds: 1,
    })).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_SCHEMA_INVALID',
      retryable: false,
    })

    expect(executeAiTextStepMock).toHaveBeenCalledTimes(2)
  })
})
