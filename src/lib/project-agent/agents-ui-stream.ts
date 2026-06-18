import type { UIMessageChunk } from 'ai'
import { createAiSdkUiMessageStream } from '@openai/agents-extensions/ai-sdk-ui'

export type ProjectAgentUiChunk = UIMessageChunk

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readChunkString(chunk: ProjectAgentUiChunk, key: string): string | null {
  if (!isRecord(chunk)) return null
  const record = chunk as unknown as Record<string, unknown>
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isFinishChunk(chunk: ProjectAgentUiChunk): boolean {
  const candidate = chunk as { type?: unknown }
  return candidate.type === 'finish'
}

function isToolInputChunk(chunk: ProjectAgentUiChunk): boolean {
  const type = readChunkString(chunk, 'type')
  return type === 'tool-input-start' || type === 'tool-input-available'
}

function isToolApprovalRequestChunk(chunk: ProjectAgentUiChunk): boolean {
  return readChunkString(chunk, 'type') === 'tool-approval-request'
}

function isToolOutputChunk(chunk: ProjectAgentUiChunk): boolean {
  const type = readChunkString(chunk, 'type')
  return type === 'tool-output-available'
    || type === 'tool-output-error'
    || type === 'tool-output-denied'
}

function inferToolNameFromCallId(toolCallId: string, toolNames: readonly string[]): string {
  const normalized = toolCallId.startsWith('tool_') ? toolCallId.slice('tool_'.length) : toolCallId
  const match = [...toolNames]
    .sort((left, right) => right.length - left.length)
    .find((toolName) => normalized === toolName || normalized.startsWith(`${toolName}_`))
  return match ?? (normalized.split('_').slice(0, -1).join('_') || 'tool')
}

function createSyntheticToolInputChunks(params: {
  toolCallId: string
  toolName: string
}): ProjectAgentUiChunk[] {
  return [
    {
      type: 'tool-input-start',
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      dynamic: true,
    },
    {
      type: 'tool-input-available',
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      input: {},
      dynamic: true,
    },
  ] as unknown as ProjectAgentUiChunk[]
}

export function createDataChunk(type: string, data: unknown): ProjectAgentUiChunk {
  return {
    type,
    data,
  } as unknown as ProjectAgentUiChunk
}

export function createProjectAgentUiMessageStream(params: {
  source: Parameters<typeof createAiSdkUiMessageStream>[0]
  initialChunks: ProjectAgentUiChunk[]
  toolNames?: readonly string[]
  drainChunks?: () => ProjectAgentUiChunk[]
  beforeFinish: () => Promise<ProjectAgentUiChunk[]>
  onError?: (error: unknown) => Promise<void>
  onCancel?: () => Promise<void>
  onSettled: () => Promise<void>
}): ReadableStream<ProjectAgentUiChunk> {
  const converted = createAiSdkUiMessageStream(params.source) as ReadableStream<ProjectAgentUiChunk>
  let cancelled = false
  let settled = false
  let convertedReader: ReadableStreamDefaultReader<ProjectAgentUiChunk> | null = null

  const settleOnce = async () => {
    if (settled) return
    settled = true
    await params.onSettled()
  }

  return new ReadableStream<ProjectAgentUiChunk>({
    async start(controller) {
      const reader = converted.getReader()
      convertedReader = reader
      let finishChunk: ProjectAgentUiChunk | null = null
      const startedToolCallIds = new Set<string>()
      const enqueueChunk = (chunk: ProjectAgentUiChunk) => {
        const toolCallId = readChunkString(chunk, 'toolCallId')
        if (toolCallId && isToolInputChunk(chunk)) {
          startedToolCallIds.add(toolCallId)
        }
        if (toolCallId && (isToolApprovalRequestChunk(chunk) || isToolOutputChunk(chunk)) && !startedToolCallIds.has(toolCallId)) {
          const toolName = inferToolNameFromCallId(toolCallId, params.toolNames ?? [])
          for (const syntheticChunk of createSyntheticToolInputChunks({ toolCallId, toolName })) {
            startedToolCallIds.add(toolCallId)
            controller.enqueue(syntheticChunk)
          }
        }
        controller.enqueue(chunk)
      }
      try {
        for (const chunk of params.initialChunks) {
          enqueueChunk(chunk)
        }

        while (true) {
          for (const chunk of params.drainChunks?.() ?? []) {
            enqueueChunk(chunk)
          }
          if (cancelled) break
          const read = await reader.read()
          if (read.done) break
          if (isFinishChunk(read.value)) {
            finishChunk = read.value
            continue
          }
          enqueueChunk(read.value)
          for (const chunk of params.drainChunks?.() ?? []) {
            enqueueChunk(chunk)
          }
        }
        if (cancelled) return

        for (const chunk of params.drainChunks?.() ?? []) {
          enqueueChunk(chunk)
        }
        const trailingChunks = await params.beforeFinish()
        for (const chunk of trailingChunks) {
          enqueueChunk(chunk)
        }
        if (finishChunk) {
          enqueueChunk(finishChunk)
        }
        controller.close()
      } catch (error) {
        if (!cancelled) {
          try {
            await params.onError?.(error)
          } finally {
            controller.error(error)
          }
        }
      } finally {
        await settleOnce()
      }
    },
    async cancel() {
      cancelled = true
      try {
        if (convertedReader) {
          await convertedReader.cancel()
        } else {
          await converted.cancel()
        }
      } finally {
        await params.onCancel?.()
        await settleOnce()
      }
    },
  })
}
