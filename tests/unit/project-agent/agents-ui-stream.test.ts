import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'

const streamState = vi.hoisted(() => ({
  chunks: [] as UIMessageChunk[],
  keepOpen: false,
  error: null as Error | null,
  cancel: vi.fn(),
}))

vi.mock('@openai/agents-extensions/ai-sdk-ui', () => ({
  createAiSdkUiMessageStream: vi.fn(() => new ReadableStream<UIMessageChunk>({
    start(controller) {
      if (streamState.error) {
        controller.error(streamState.error)
        return
      }
      for (const chunk of streamState.chunks) {
        controller.enqueue(chunk)
      }
      if (!streamState.keepOpen) controller.close()
    },
    cancel() {
      streamState.cancel()
    },
  })),
}))

import { createProjectAgentUiMessageStream } from '@/lib/project-agent/agents-ui-stream'

async function readChunks(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader()
  const chunks: UIMessageChunk[] = []
  while (true) {
    const read = await reader.read()
    if (read.done) return chunks
    chunks.push(read.value)
  }
}

describe('createProjectAgentUiMessageStream', () => {
  beforeEach(() => {
    streamState.chunks = []
    streamState.keepOpen = false
    streamState.error = null
    streamState.cancel.mockClear()
  })

  it('synthesizes a dynamic tool invocation before an approval request when the adapter omits it', async () => {
    streamState.chunks = [
      {
        type: 'tool-approval-request',
        toolCallId: 'tool_ingest_script_call-1',
        approvalId: 'approval-1',
      } as UIMessageChunk,
      { type: 'finish' } as UIMessageChunk,
    ]

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      toolNames: ['ingest_script'],
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }))

    expect(chunks.slice(0, 3)).toEqual([
      expect.objectContaining({
        type: 'tool-input-start',
        toolCallId: 'tool_ingest_script_call-1',
        toolName: 'ingest_script',
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'tool_ingest_script_call-1',
        toolName: 'ingest_script',
        input: {},
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-approval-request',
        toolCallId: 'tool_ingest_script_call-1',
        approvalId: 'approval-1',
      }),
    ])
  })

  it('does not duplicate an existing tool invocation before approval', async () => {
    streamState.chunks = [
      {
        type: 'tool-input-start',
        toolCallId: 'tool_ingest_script_call-1',
        toolName: 'ingest_script',
        dynamic: true,
      } as UIMessageChunk,
      {
        type: 'tool-approval-request',
        toolCallId: 'tool_ingest_script_call-1',
        approvalId: 'approval-1',
      } as UIMessageChunk,
    ]

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      toolNames: ['ingest_script'],
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }))

    expect(chunks.filter((chunk) => chunk.type === 'tool-input-start')).toHaveLength(1)
  })

  it('synthesizes a dynamic tool invocation before a resumed tool output when the adapter omits it', async () => {
    streamState.chunks = [
      {
        type: 'tool-output-available',
        toolCallId: 'tool_ingest_script_call-1',
        output: { ok: true },
      } as UIMessageChunk,
      { type: 'finish' } as UIMessageChunk,
    ]

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      toolNames: ['ingest_script'],
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }))

    expect(chunks.slice(0, 3)).toEqual([
      expect.objectContaining({
        type: 'tool-input-start',
        toolCallId: 'tool_ingest_script_call-1',
        toolName: 'ingest_script',
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'tool_ingest_script_call-1',
        toolName: 'ingest_script',
        input: {},
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-output-available',
        toolCallId: 'tool_ingest_script_call-1',
        output: { ok: true },
      }),
    ])
  })

  it('records every emitted chunk through the onChunk hook', async () => {
    streamState.chunks = [
      { type: 'text-start', id: 'text-1' } as UIMessageChunk,
      { type: 'text-delta', id: 'text-1', delta: 'hello' } as UIMessageChunk,
      { type: 'finish' } as UIMessageChunk,
    ]
    const recordedChunks: UIMessageChunk[] = []

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [{ type: 'data-agent-run', data: { status: 'running' } } as unknown as UIMessageChunk],
      beforeFinish: async () => [
        { type: 'data-agent-run', data: { status: 'completed' } } as unknown as UIMessageChunk,
      ],
      onChunk: (chunk) => {
        recordedChunks.push(chunk)
      },
      onSettled: async () => undefined,
    }))

    expect(recordedChunks).toEqual(chunks)
    expect(recordedChunks).toEqual([
      { type: 'data-agent-run', data: { status: 'running' } },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'hello' },
      { type: 'data-agent-run', data: { status: 'completed' } },
      { type: 'finish' },
    ])
  })

  it('marks the stream cancelled and settles once when the reader disconnects before finish', async () => {
    streamState.keepOpen = true
    const beforeFinish = vi.fn(async () => [])
    const onCancel = vi.fn(async () => undefined)
    const onSettled = vi.fn(async () => undefined)
    const stream = createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      beforeFinish,
      onCancel,
      onSettled,
    })

    const reader = stream.getReader()
    await reader.cancel()

    expect(streamState.cancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(beforeFinish).not.toHaveBeenCalled()
  })

  it('reports source stream errors and settles once', async () => {
    const sourceError = new Error('STREAM_SOURCE_FAILED')
    streamState.error = sourceError
    const beforeFinish = vi.fn(async () => [])
    const onError = vi.fn(async () => undefined)
    const onSettled = vi.fn(async () => undefined)

    const stream = createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      beforeFinish,
      onError,
      onSettled,
    })

    await expect(readChunks(stream)).rejects.toThrow('STREAM_SOURCE_FAILED')
    expect(onError).toHaveBeenCalledWith(sourceError)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(beforeFinish).not.toHaveBeenCalled()
  })
})
