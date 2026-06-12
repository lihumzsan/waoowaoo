import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'

const streamState = vi.hoisted(() => ({
  chunks: [] as UIMessageChunk[],
}))

vi.mock('@openai/agents-extensions/ai-sdk-ui', () => ({
  createAiSdkUiMessageStream: vi.fn(() => new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of streamState.chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
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
  it('synthesizes a dynamic tool invocation before an approval request when the adapter omits it', async () => {
    streamState.chunks = [
      {
        type: 'tool-approval-request',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        approvalId: 'approval-1',
      } as UIMessageChunk,
      { type: 'finish' } as UIMessageChunk,
    ]

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      toolNames: ['generate_edit_screenplay'],
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }))

    expect(chunks.slice(0, 3)).toEqual([
      expect.objectContaining({
        type: 'tool-input-start',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        toolName: 'generate_edit_screenplay',
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        toolName: 'generate_edit_screenplay',
        input: {},
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-approval-request',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        approvalId: 'approval-1',
      }),
    ])
  })

  it('does not duplicate an existing tool invocation before approval', async () => {
    streamState.chunks = [
      {
        type: 'tool-input-start',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        toolName: 'generate_edit_screenplay',
        dynamic: true,
      } as UIMessageChunk,
      {
        type: 'tool-approval-request',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        approvalId: 'approval-1',
      } as UIMessageChunk,
    ]

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      toolNames: ['generate_edit_screenplay'],
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }))

    expect(chunks.filter((chunk) => chunk.type === 'tool-input-start')).toHaveLength(1)
  })

  it('synthesizes a dynamic tool invocation before a resumed tool output when the adapter omits it', async () => {
    streamState.chunks = [
      {
        type: 'tool-output-available',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        output: { ok: true },
      } as UIMessageChunk,
      { type: 'finish' } as UIMessageChunk,
    ]

    const chunks = await readChunks(createProjectAgentUiMessageStream({
      source: {} as Parameters<typeof createProjectAgentUiMessageStream>[0]['source'],
      initialChunks: [],
      toolNames: ['generate_edit_screenplay'],
      beforeFinish: async () => [],
      onSettled: async () => undefined,
    }))

    expect(chunks.slice(0, 3)).toEqual([
      expect.objectContaining({
        type: 'tool-input-start',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        toolName: 'generate_edit_screenplay',
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        toolName: 'generate_edit_screenplay',
        input: {},
        dynamic: true,
      }),
      expect.objectContaining({
        type: 'tool-output-available',
        toolCallId: 'tool_generate_edit_screenplay_call-1',
        output: { ok: true },
      }),
    ])
  })
})
