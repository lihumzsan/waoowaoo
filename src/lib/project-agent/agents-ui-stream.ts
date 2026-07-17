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

function readTextChunkDelta(chunk: ProjectAgentUiChunk): string | null {
  if (!isRecord(chunk)) return null
  const type = readChunkString(chunk, 'type')
  if (type !== 'text-delta') return null
  const record = chunk as unknown as Record<string, unknown>
  const delta = record.delta
  return typeof delta === 'string' ? delta : null
}

const PROJECT_STATE_SNAPSHOT_PROTOCOL_MARKERS = [
  '[project_state_snapshot]',
  '[/project_state_snapshot]',
] as const
const AGENT_PLAN_PROTOCOL_MARKERS = [
  '[agent_plan]',
  '[/agent_plan]',
] as const
const RAW_TOOL_CALL_PROTOCOL_MARKERS = [
  '<call:',
] as const

const TEXT_PROTOCOL_MARKERS = [
  ...PROJECT_STATE_SNAPSHOT_PROTOCOL_MARKERS,
  ...AGENT_PLAN_PROTOCOL_MARKERS,
  ...RAW_TOOL_CALL_PROTOCOL_MARKERS,
] as const

const TEXT_PROTOCOL_TAIL_LENGTH = Math.max(
  ...TEXT_PROTOCOL_MARKERS.map((marker) => marker.length),
) - 1

function resolveTextProtocolLeakCode(candidate: string): string | null {
  if (PROJECT_STATE_SNAPSHOT_PROTOCOL_MARKERS.some((marker) => candidate.includes(marker))) {
    return 'PROJECT_AGENT_OUTPUT_PROTOCOL_FRAME_LEAK'
  }
  if (AGENT_PLAN_PROTOCOL_MARKERS.some((marker) => candidate.includes(marker))) {
    return 'PROJECT_AGENT_OUTPUT_PLAN_FRAME_LEAK'
  }
  if (RAW_TOOL_CALL_PROTOCOL_MARKERS.some((marker) => candidate.includes(marker))) {
    return 'PROJECT_AGENT_OUTPUT_TOOL_CALL_PROTOCOL_LEAK'
  }
  return null
}

function createTextProtocolGuard(): (chunk: ProjectAgentUiChunk) => void {
  let textTail = ''
  return (chunk: ProjectAgentUiChunk) => {
    const delta = readTextChunkDelta(chunk)
    if (!delta) return
    const candidate = `${textTail}${delta}`
    const leakCode = resolveTextProtocolLeakCode(candidate)
    if (leakCode) {
      throw new Error(leakCode)
    }
    textTail = candidate.slice(-TEXT_PROTOCOL_TAIL_LENGTH)
  }
}

function isGenericToolName(toolName: string | null): boolean {
  return toolName === 'call' || toolName === 'tool'
}

function replaceChunkToolName(chunk: ProjectAgentUiChunk, toolName: string): ProjectAgentUiChunk {
  if (!isRecord(chunk)) return chunk
  return { ...chunk, toolName } as unknown as ProjectAgentUiChunk
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
  resolveToolName: (toolCallId: string) => string | null
  drainChunks?: () => ProjectAgentUiChunk[]
  beforeFinish: () => Promise<ProjectAgentUiChunk[]>
  onChunk?: (chunk: ProjectAgentUiChunk) => void
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
      const assertNoTextProtocolLeak = createTextProtocolGuard()
      const emitChunk = (chunk: ProjectAgentUiChunk) => {
        params.onChunk?.(chunk)
        controller.enqueue(chunk)
      }
      const enqueueChunk = (rawChunk: ProjectAgentUiChunk) => {
        let chunk = rawChunk
        assertNoTextProtocolLeak(chunk)
        const toolCallId = readChunkString(chunk, 'toolCallId')
        if (toolCallId && isToolInputChunk(chunk)) {
          const incomingToolName = readChunkString(chunk, 'toolName')
          const mappedToolName = params.resolveToolName(toolCallId)?.trim() || null
          if (mappedToolName && incomingToolName && !isGenericToolName(incomingToolName) && mappedToolName !== incomingToolName) {
            throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_CONFLICT:${toolCallId}:${mappedToolName}:${incomingToolName}`)
          }
          const toolName = mappedToolName ?? (isGenericToolName(incomingToolName) ? null : incomingToolName)
          if (!toolName) throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_MISSING:${toolCallId}`)
          if (incomingToolName !== toolName) chunk = replaceChunkToolName(chunk, toolName)
          startedToolCallIds.add(toolCallId)
        }
        if (toolCallId && (isToolApprovalRequestChunk(chunk) || isToolOutputChunk(chunk)) && !startedToolCallIds.has(toolCallId)) {
          const toolName = params.resolveToolName(toolCallId)?.trim() || null
          if (!toolName) throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_MISSING:${toolCallId}`)
          for (const syntheticChunk of createSyntheticToolInputChunks({ toolCallId, toolName })) {
            startedToolCallIds.add(toolCallId)
            emitChunk(syntheticChunk)
          }
        }
        emitChunk(chunk)
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
        try {
          await params.onCancel?.()
        } finally {
          await settleOnce()
        }
      }
    },
  })
}
