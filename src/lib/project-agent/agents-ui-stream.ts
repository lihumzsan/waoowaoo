import type { UIMessageChunk } from 'ai'
import { createAiSdkUiMessageStream } from '@openai/agents-extensions/ai-sdk-ui'

export type ProjectAgentUiChunk = UIMessageChunk

export const PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT_ERROR_CODE = 'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT'

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

function normalizeReadIdleTimeoutMs(value: number | undefined): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<ProjectAgentUiChunk>,
  readIdleTimeoutMs: number | null,
): Promise<ReadableStreamReadResult<ProjectAgentUiChunk>> {
  if (!readIdleTimeoutMs) return await reader.read()
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<ProjectAgentUiChunk>>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT_ERROR_CODE))
        }, readIdleTimeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
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
  readIdleTimeoutMs?: number
  beforeFinish: () => Promise<ProjectAgentUiChunk[]>
  onStreamError?: (error: unknown) => Promise<void>
  onCancel?: () => Promise<void>
  onSettled: () => Promise<void>
}): ReadableStream<ProjectAgentUiChunk> {
  const converted = createAiSdkUiMessageStream(params.source) as ReadableStream<ProjectAgentUiChunk>
  const readIdleTimeoutMs = normalizeReadIdleTimeoutMs(params.readIdleTimeoutMs)
  let reader: ReadableStreamDefaultReader<ProjectAgentUiChunk> | null = null
  let cancelled = false
  let settled = false
  const settleOnce = async () => {
    if (settled) return
    settled = true
    await params.onSettled()
  }

  return new ReadableStream<ProjectAgentUiChunk>({
    async start(controller) {
      reader = converted.getReader()
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
          const read = await readWithIdleTimeout(reader, readIdleTimeoutMs)
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

        for (const chunk of params.drainChunks?.() ?? []) {
          enqueueChunk(chunk)
        }
        if (cancelled) return
        const trailingChunks = await params.beforeFinish()
        for (const chunk of trailingChunks) {
          enqueueChunk(chunk)
        }
        if (finishChunk) {
          enqueueChunk(finishChunk)
        }
        controller.close()
      } catch (error) {
        await reader.cancel().catch(() => undefined)
        await params.onStreamError?.(error)
        controller.error(error)
      } finally {
        await settleOnce()
      }
    },
    async cancel() {
      cancelled = true
      let cancelError: unknown = null
      try {
        await params.onCancel?.()
      } catch (error) {
        cancelError = error
      }
      if (reader) {
        await reader.cancel().catch(() => undefined)
      } else {
        await converted.cancel().catch(() => undefined)
      }
      await settleOnce()
      if (cancelError) throw cancelError
    },
  })
}
