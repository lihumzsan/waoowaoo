import { RunRawModelStreamEvent, type RunStreamEvent } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import {
  createDataChunk,
  createProjectAgentSideChannel,
  createProjectAgentUiMessageStream,
  type ProjectAgentUiChunk,
} from '@/lib/project-agent/agents-ui-stream'

describe('Project Agent UI stream arbiter', () => {
  it('wakes for reasoning while the upstream UI converter is waiting for answer text', async () => {
    let releaseSource!: () => void
    const sourceGate = new Promise<void>((resolve) => {
      releaseSource = resolve
    })
    const source = (async function* (): AsyncGenerator<RunStreamEvent> {
      yield new RunRawModelStreamEvent({ type: 'response_started' })
      await sourceGate
      yield new RunRawModelStreamEvent({
        type: 'response_done',
        response: {
          id: 'response-1',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          output: [],
        },
      })
    })()
    const sideChannel = createProjectAgentSideChannel()
    const stream = createProjectAgentUiMessageStream({
      source,
      initialChunks: [createDataChunk('data-agent-run', { status: 'running' })],
      resolveToolName: () => null,
      sideChannel,
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    })
    const reader = stream.getReader()
    const observed: ProjectAgentUiChunk[] = []
    while (!observed.some((chunk) => (chunk as { type?: unknown }).type === 'start-step')) {
      const read = await reader.read()
      expect(read.done).toBe(false)
      if (read.value) observed.push(read.value)
    }

    sideChannel.write({
      kind: 'public_reasoning',
      phase: 'start',
      reasoningId: 'reasoning:1:test',
      chunk: { type: 'reasoning-start', id: 'reasoning:1:test' } as ProjectAgentUiChunk,
    })
    sideChannel.write({
      kind: 'public_reasoning',
      phase: 'delta',
      reasoningId: 'reasoning:1:test',
      chunk: {
        type: 'reasoning-delta',
        id: 'reasoning:1:test',
        delta: 'live',
      } as ProjectAgentUiChunk,
    })

    const liveRead = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('REASONING_WAKE_TIMEOUT')), 1_000)
      }),
    ])
    expect(liveRead.done).toBe(false)
    expect(liveRead.value).toMatchObject({ type: 'reasoning-start' })
    const deltaRead = await reader.read()
    expect(deltaRead.value).toMatchObject({ type: 'reasoning-delta', delta: 'live' })

    releaseSource()
    while (!(await reader.read()).done) {
      // Drain the terminal converter chunks so settlement completes.
    }
  })

  it('emits one live reasoning block and suppresses the converter aggregate', async () => {
    const sideChannel = createProjectAgentSideChannel()
    const reasoningId = 'reasoning:1:block-1'
    const source = (async function* (): AsyncGenerator<RunStreamEvent> {
      yield new RunRawModelStreamEvent({ type: 'response_started' })
      sideChannel.write({
        kind: 'public_reasoning',
        phase: 'start',
        reasoningId,
        chunk: { type: 'reasoning-start', id: reasoningId } as ProjectAgentUiChunk,
      })
      yield new RunRawModelStreamEvent({
        type: 'model',
        event: { type: 'reasoning-start', id: 'block-1' },
      })
      sideChannel.write({
        kind: 'public_reasoning',
        phase: 'delta',
        reasoningId,
        chunk: { type: 'reasoning-delta', id: reasoningId, delta: 'live' } as ProjectAgentUiChunk,
      })
      yield new RunRawModelStreamEvent({
        type: 'model',
        event: { type: 'reasoning-delta', id: 'block-1', delta: 'live' },
      })
      sideChannel.write({
        kind: 'public_reasoning',
        phase: 'end',
        reasoningId,
        completedText: 'live',
        chunk: { type: 'reasoning-end', id: reasoningId } as ProjectAgentUiChunk,
      })
      yield new RunRawModelStreamEvent({
        type: 'model',
        event: { type: 'reasoning-end', id: 'block-1' },
      })
      yield new RunRawModelStreamEvent({
        type: 'response_done',
        response: {
          id: 'response-1',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          output: [],
        },
      })
    })()
    const reader = createProjectAgentUiMessageStream({
      source,
      initialChunks: [createDataChunk('data-agent-run', { status: 'running' })],
      resolveToolName: () => null,
      sideChannel,
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }).getReader()
    const chunks: ProjectAgentUiChunk[] = []
    while (true) {
      const read = await reader.read()
      if (read.done) break
      chunks.push(read.value)
    }
    expect(chunks.filter((chunk) => (
      ['reasoning-start', 'reasoning-delta', 'reasoning-end'].includes(
        String((chunk as { type?: unknown }).type),
      )
    ))).toEqual([
      { type: 'reasoning-start', id: reasoningId },
      { type: 'reasoning-delta', id: reasoningId, delta: 'live' },
      { type: 'reasoning-end', id: reasoningId },
    ])
  })
})
