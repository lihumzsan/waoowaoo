import type { LanguageModel } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wrapLanguageModelWithRetry } from '@/lib/project-agent/model-stream-retry'

type TestStreamPart = {
  type: string
  error?: unknown
  rawValue?: unknown
  id?: string
  delta?: string
}

function streamFromParts(parts: TestStreamPart[]): ReadableStream<TestStreamPart> {
  return new ReadableStream<TestStreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

async function readParts(stream: ReadableStream<TestStreamPart>): Promise<TestStreamPart[]> {
  const reader = stream.getReader()
  const parts: TestStreamPart[] = []
  for (;;) {
    const result = await reader.read()
    if (result.done) return parts
    parts.push(result.value)
  }
}

describe('Project Agent model pre-content retry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a real OpenRouter raw-envelope then normalized 429 without leaking the first attempt', async () => {
    vi.useFakeTimers()
    let calls = 0
    const model = {
      doGenerate: async () => {
        throw new Error('not used')
      },
      doStream: async () => {
        calls += 1
        return {
          stream: calls === 1
            ? streamFromParts([
                {
                  type: 'raw',
                  rawValue: {
                    error: {
                      code: 429,
                      message: 'Provider rate limit exceeded',
                    },
                  },
                },
                {
                  type: 'error',
                  error: {
                    status: 429,
                    message: 'Provider rate limit exceeded',
                  },
                },
              ])
            : streamFromParts([
                { type: 'stream-start' },
                { type: 'text-start', id: 'answer' },
                { type: 'text-delta', id: 'answer', delta: 'ok' },
              ]),
        }
      },
    } as unknown as LanguageModel
    const wrapped = wrapLanguageModelWithRetry(model)
    if (typeof wrapped === 'string') throw new Error('Expected a LanguageModel object')
    const result = await wrapped.doStream({} as never)
    const partsPromise = readParts(result.stream as ReadableStream<TestStreamPart>)

    await vi.runAllTimersAsync()

    await expect(partsPromise).resolves.toEqual([
      { type: 'stream-start' },
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: 'ok' },
    ])
    expect(calls).toBe(2)
  })
})
