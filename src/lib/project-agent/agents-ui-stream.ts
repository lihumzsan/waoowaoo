import type { UIMessageChunk } from 'ai'
import { createAiSdkUiMessageStream } from '@openai/agents-extensions/ai-sdk-ui'
import type { RunStreamEvent } from '@openai/agents'

export type ProjectAgentUiChunk = UIMessageChunk

export type ProjectAgentSideChannelEntry =
  | { kind: 'chunk'; chunk: ProjectAgentUiChunk }
  | {
      kind: 'public_reasoning'
      chunk: ProjectAgentUiChunk
      phase: 'start' | 'delta' | 'end'
      reasoningId: string
      completedText?: string
    }

export type ProjectAgentSideChannel = {
  write: (entry: ProjectAgentSideChannelEntry) => void
  drain: () => ProjectAgentSideChannelEntry[]
  version: () => number
  waitForChange: (observedVersion: number) => Promise<number>
}

function createDeferredVersion() {
  let resolvePromise: ((version: number) => void) | null = null
  const promise = new Promise<number>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve(version: number) {
      resolvePromise?.(version)
    },
  }
}

export function createProjectAgentSideChannel(): ProjectAgentSideChannel {
  const entries: ProjectAgentSideChannelEntry[] = []
  let currentVersion = 0
  let deferred = createDeferredVersion()
  return {
    write(entry) {
      entries.push(entry)
      currentVersion += 1
      deferred.resolve(currentVersion)
      deferred = createDeferredVersion()
    },
    drain() {
      return entries.splice(0, entries.length)
    },
    version() {
      return currentVersion
    },
    waitForChange(observedVersion) {
      return currentVersion > observedVersion
        ? Promise.resolve(currentVersion)
        : deferred.promise
    },
  }
}

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

function isStartChunk(chunk: ProjectAgentUiChunk): boolean {
  return readChunkString(chunk, 'type') === 'start'
}

function readReasoningChunk(chunk: ProjectAgentUiChunk): {
  type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end'
  delta: string | null
} | null {
  const type = readChunkString(chunk, 'type')
  if (type !== 'reasoning-start' && type !== 'reasoning-delta' && type !== 'reasoning-end') {
    return null
  }
  if (!isRecord(chunk)) return null
  const record = chunk as unknown as Record<string, unknown>
  const delta = typeof record.delta === 'string' ? record.delta : null
  return { type, delta }
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

function isToolChunk(chunk: ProjectAgentUiChunk): boolean {
  return readChunkString(chunk, 'type')?.startsWith('tool-') ?? false
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

function isGenericToolName(
  toolName: string | null,
  aliasedToolNames: ReadonlySet<string>,
): boolean {
  return toolName === 'call' || toolName === 'tool' || (toolName ? aliasedToolNames.has(toolName) : false)
}

function replaceChunkToolName(chunk: ProjectAgentUiChunk, toolName: string): ProjectAgentUiChunk {
  if (!isRecord(chunk)) return chunk
  return { ...chunk, toolName } as unknown as ProjectAgentUiChunk
}

function readFunctionToolCall(event: RunStreamEvent): {
  toolCallId: string
  toolName: string
} | null {
  if (
    event.type !== 'run_item_stream_event'
    || event.name !== 'tool_called'
    || event.item.type !== 'tool_call_item'
    || event.item.rawItem.type !== 'function_call'
  ) {
    return null
  }
  const toolCallId = event.item.rawItem.callId.trim()
  const toolName = event.item.rawItem.name.trim()
  return toolCallId && toolName ? { toolCallId, toolName } : null
}

function replaceChunkWithToolNotFoundFailure(
  chunk: ProjectAgentUiChunk,
  toolName: string,
): ProjectAgentUiChunk {
  if (!isRecord(chunk)) return chunk
  return {
    ...chunk,
    toolName,
    output: {
      ok: false,
      error: {
        code: 'OPERATION_NOT_FOUND',
        message: 'PROJECT_AGENT_TOOL_NOT_FOUND',
        details: { toolName },
      },
    },
  } as unknown as ProjectAgentUiChunk
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
  source: AsyncIterable<RunStreamEvent>
  initialChunks: ProjectAgentUiChunk[]
  resolveToolName: (toolCallId: string) => string | null
  availableToolNames: readonly string[]
  hiddenToolNames?: readonly string[]
  aliasedToolNames?: readonly string[]
  sideChannel: ProjectAgentSideChannel
  beforeFinish: () => Promise<ProjectAgentUiChunk[]>
  onChunk?: (chunk: ProjectAgentUiChunk) => void
  onError?: (error: unknown) => Promise<void>
  onCancel?: () => Promise<void>
  onSettled: () => Promise<void>
}): ReadableStream<ProjectAgentUiChunk> {
  const availableToolNames = new Set(
    params.availableToolNames.map((toolName) => toolName.trim()).filter(Boolean),
  )
  const missingToolNameByCallId = new Map<string, string>()
  const observedSource = (async function* (): AsyncGenerator<RunStreamEvent> {
    for await (const event of params.source) {
      const toolCall = readFunctionToolCall(event)
      if (toolCall && !availableToolNames.has(toolCall.toolName)) {
        missingToolNameByCallId.set(toolCall.toolCallId, toolCall.toolName)
      }
      yield event
    }
  })()
  const converted = createAiSdkUiMessageStream(observedSource) as ReadableStream<ProjectAgentUiChunk>
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
      const hiddenToolNames = new Set(
        (params.hiddenToolNames ?? []).map((toolName) => toolName.trim()).filter(Boolean),
      )
      const aliasedToolNames = new Set(
        (params.aliasedToolNames ?? []).map((toolName) => toolName.trim()).filter(Boolean),
      )
      const hiddenToolCallIds = new Set<string>()
      const completedLiveReasoning: Array<{ reasoningId: string; text: string }> = []
      let suppressedReasoning: { reasoningId: string; expected: string; actual: string } | null = null
      const readSuppressedReasoning = (): {
        reasoningId: string
        expected: string
        actual: string
      } | null => suppressedReasoning
      let messageStarted = false
      let initialChunksEmitted = false
      const bufferedSideEntries: ProjectAgentSideChannelEntry[] = []
      const assertNoTextProtocolLeak = createTextProtocolGuard()
      const emitChunk = (chunk: ProjectAgentUiChunk) => {
        params.onChunk?.(chunk)
        controller.enqueue(chunk)
      }
      const enqueueChunk = (rawChunk: ProjectAgentUiChunk) => {
        let chunk = rawChunk
        assertNoTextProtocolLeak(chunk)
        const toolCallId = readChunkString(chunk, 'toolCallId')
        const missingToolName = toolCallId && isToolOutputChunk(chunk)
          ? missingToolNameByCallId.get(toolCallId) ?? null
          : null
        if (missingToolName) {
          chunk = replaceChunkWithToolNotFoundFailure(chunk, missingToolName)
        }
        if (toolCallId && isToolChunk(chunk)) {
          const incomingToolName = readChunkString(chunk, 'toolName')
          if (incomingToolName && hiddenToolNames.has(incomingToolName)) {
            hiddenToolCallIds.add(toolCallId)
          }
          if (hiddenToolCallIds.has(toolCallId)) return
        }
        if (toolCallId && isToolInputChunk(chunk)) {
          const incomingToolName = readChunkString(chunk, 'toolName')
          const mappedToolName = params.resolveToolName(toolCallId)?.trim() || null
          if (
            mappedToolName
            && incomingToolName
            && !isGenericToolName(incomingToolName, aliasedToolNames)
            && mappedToolName !== incomingToolName
          ) {
            throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_CONFLICT:${toolCallId}:${mappedToolName}:${incomingToolName}`)
          }
          const toolName = mappedToolName
            ?? (isGenericToolName(incomingToolName, aliasedToolNames) ? null : incomingToolName)
          if (!toolName) throw new Error(`PROJECT_AGENT_TOOL_IDENTITY_MISSING:${toolCallId}`)
          if (incomingToolName !== toolName) chunk = replaceChunkToolName(chunk, toolName)
          startedToolCallIds.add(toolCallId)
        }
        if (toolCallId && isToolChunk(chunk) && !isToolInputChunk(chunk)) {
          const incomingToolName = readChunkString(chunk, 'toolName')
          const mappedToolName = params.resolveToolName(toolCallId)?.trim() || null
          if (
            mappedToolName
            && incomingToolName
            && isGenericToolName(incomingToolName, aliasedToolNames)
          ) {
            chunk = replaceChunkToolName(chunk, mappedToolName)
          }
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
      const enqueueInitialChunks = () => {
        if (initialChunksEmitted) return
        initialChunksEmitted = true
        for (const chunk of params.initialChunks) enqueueChunk(chunk)
      }
      const enqueueSideEntry = (entry: ProjectAgentSideChannelEntry) => {
        if (entry.kind === 'public_reasoning' && entry.phase === 'end') {
          completedLiveReasoning.push({
            reasoningId: entry.reasoningId,
            text: entry.completedText ?? '',
          })
        }
        enqueueChunk(entry.chunk)
      }
      const flushBufferedSideEntries = () => {
        if (!messageStarted) return
        for (const entry of bufferedSideEntries.splice(0, bufferedSideEntries.length)) {
          enqueueSideEntry(entry)
        }
      }
      const drainSideChannel = () => {
        const entries = params.sideChannel.drain()
        if (!messageStarted) {
          bufferedSideEntries.push(...entries)
          return
        }
        for (const entry of entries) enqueueSideEntry(entry)
      }
      const enqueueConvertedChunk = (chunk: ProjectAgentUiChunk) => {
        if (isStartChunk(chunk)) {
          enqueueChunk(chunk)
          messageStarted = true
          enqueueInitialChunks()
          flushBufferedSideEntries()
          return
        }
        const reasoning = readReasoningChunk(chunk)
        if (!reasoning) {
          enqueueChunk(chunk)
          return
        }
        if (reasoning.type === 'reasoning-start') {
          const live = completedLiveReasoning.shift()
          if (!live) {
            enqueueChunk(chunk)
            return
          }
          suppressedReasoning = {
            reasoningId: live.reasoningId,
            expected: live.text,
            actual: '',
          }
          return
        }
        if (!suppressedReasoning) {
          enqueueChunk(chunk)
          return
        }
        if (reasoning.type === 'reasoning-delta') {
          suppressedReasoning.actual += reasoning.delta ?? ''
          return
        }
        if (suppressedReasoning.actual !== suppressedReasoning.expected) {
          throw new Error(`PROJECT_AGENT_REASONING_STREAM_MISMATCH:${suppressedReasoning.reasoningId}`)
        }
        suppressedReasoning = null
      }
      try {
        let observedSideChannelVersion = params.sideChannel.version()
        let pendingConvertedOutcome = reader.read()
          .then((read) => ({ kind: 'converted' as const, read }))
        let pendingSideOutcome = params.sideChannel.waitForChange(observedSideChannelVersion)
          .then((version) => ({ kind: 'side' as const, version }))
        while (true) {
          if (cancelled) break
          const outcome = await Promise.race([pendingConvertedOutcome, pendingSideOutcome])
          if (outcome.kind === 'side') {
            observedSideChannelVersion = outcome.version
            drainSideChannel()
            pendingSideOutcome = params.sideChannel.waitForChange(observedSideChannelVersion)
              .then((version) => ({ kind: 'side' as const, version }))
            continue
          }
          const { read } = outcome
          if (read.done) break
          pendingConvertedOutcome = reader.read()
            .then((nextRead) => ({ kind: 'converted' as const, read: nextRead }))
          // The source observer may have published live reasoning while this
          // converter read was pending. Give those canonical deltas priority
          // before reconciling the converter's terminal aggregate block.
          observedSideChannelVersion = params.sideChannel.version()
          drainSideChannel()
          if (isFinishChunk(read.value)) {
            finishChunk = read.value
            continue
          }
          enqueueConvertedChunk(read.value)
          observedSideChannelVersion = params.sideChannel.version()
          drainSideChannel()
          pendingSideOutcome = params.sideChannel.waitForChange(observedSideChannelVersion)
            .then((version) => ({ kind: 'side' as const, version }))
        }
        if (cancelled) return

        drainSideChannel()
        if (!messageStarted) {
          enqueueInitialChunks()
          messageStarted = true
        }
        flushBufferedSideEntries()
        const incompleteReasoning = readSuppressedReasoning()
        if (incompleteReasoning) {
          throw new Error(`PROJECT_AGENT_REASONING_STREAM_INCOMPLETE:${incompleteReasoning.reasoningId}`)
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
        // Consumer cancellation owns terminal ordering: onCancel must persist
        // the cancelled Run before shared settlement releases its lock.
        if (!cancelled) await settleOnce()
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
