import { getToolName, isToolUIPart, type UIMessage } from 'ai'

export const WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY = 'workspace-assistant-run-trace'

export const WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES = [
  'update_plan',
] as const

const HIDDEN_TRACE_TOOL_NAMES = new Set<string>(
  WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES,
)

const VISIBLE_DATA_PART_NAMES = new Set([
  'agent-operation-plan-preview',
  'agent-stop',
  'assistant-choice-card',
  'assistant-resource-links',
  'project-context',
])

type MessagePartRecord = {
  readonly type?: unknown
  readonly text?: unknown
  readonly name?: unknown
  readonly data?: unknown
  readonly status?: unknown
  readonly toolCallId?: unknown
  readonly toolName?: unknown
  readonly result?: unknown
  readonly isError?: unknown
  readonly ok?: unknown
  readonly async?: unknown
  readonly taskId?: unknown
  readonly taskIds?: unknown
}

export type WorkspaceAssistantMessagePartGroup = {
  readonly groupKey: string | undefined
  readonly indices: number[]
}

export type WorkspaceAssistantRunTraceView = {
  readonly hasPublicReasoning: boolean
  readonly hasVisibleContent: boolean
  readonly visibleToolCallCount: number
  readonly runStatus: 'running' | 'awaiting_approval' | 'awaiting_choice' | 'awaiting_task' | 'completed' | 'failed' | 'cancelled' | null
  readonly traceAnchorIndex: number | null
  readonly traceIndices: readonly number[]
}

export type WorkspaceAssistantRepeatedToolCallGroup = {
  readonly leaderToolCallId: string
  readonly toolCallIds: readonly string[]
  readonly toolName: string
}

export type WorkspaceAssistantToolCallDisplayState =
  | 'success'
  | 'submitted'
  | 'failed'
  | 'interrupted'
  | 'running'
  | 'needsAction'

export type WorkspaceAssistantToolCallGroupView = {
  readonly leaderToolCallId: string
  readonly total: number
  readonly success: number
  readonly submitted: number
  readonly failed: number
  readonly interrupted: number
  readonly running: number
  readonly needsAction: number
}

function readPart(value: unknown): MessagePartRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as MessagePartRecord
    : null
}

function isSubmittedToolResult(result: unknown): boolean {
  const record = readPart(result)
  if (record?.ok !== true) return false
  const data = readPart(record.data)
  if (data?.async !== true) return false
  if (typeof data.taskId === 'string' && data.taskId.trim()) return true
  return Array.isArray(data.taskIds)
    && data.taskIds.some((taskId) => typeof taskId === 'string' && taskId.trim())
}

function isFailedToolResult(result: unknown): boolean {
  return readPart(result)?.ok === false
}

export function resolveWorkspaceAssistantToolCallDisplayState(
  value: unknown,
): WorkspaceAssistantToolCallDisplayState {
  const part = readPart(value)
  const status = readPart(part?.status)?.type
  if (status === 'incomplete') return 'interrupted'
  if (status === 'requires-action') return 'needsAction'
  if (status !== 'complete') return 'running'
  if (part?.isError === true || isFailedToolResult(part?.result)) return 'failed'
  return isSubmittedToolResult(part?.result) ? 'submitted' : 'success'
}

/**
 * UIMessage keeps the protocol's `step-start` boundary even though the
 * assistant-ui converter intentionally removes it. Use that authoritative
 * boundary to aggregate presentation only: opaque call identities and actual
 * executions remain independent.
 */
export function resolveWorkspaceAssistantRepeatedToolCallGroups(
  messages: readonly UIMessage[],
): WorkspaceAssistantRepeatedToolCallGroup[] {
  const groups: WorkspaceAssistantRepeatedToolCallGroup[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    let callsByToolName = new Map<string, string[]>()
    const flushStep = (): void => {
      for (const [toolName, toolCallIds] of callsByToolName) {
        if (toolCallIds.length < 2) continue
        groups.push({
          leaderToolCallId: toolCallIds[0],
          toolCallIds,
          toolName,
        })
      }
      callsByToolName = new Map()
    }

    for (const part of message.parts) {
      if (part.type === 'step-start') {
        flushStep()
        continue
      }
      if (!isToolUIPart(part) || !part.toolCallId) continue
      const toolName = getToolName(part)
      const toolCallIds = callsByToolName.get(toolName) ?? []
      toolCallIds.push(part.toolCallId)
      callsByToolName.set(toolName, toolCallIds)
    }
    flushStep()
  }

  return groups
}

export function resolveWorkspaceAssistantToolCallGroupView(
  parts: readonly unknown[],
  group: WorkspaceAssistantRepeatedToolCallGroup,
): WorkspaceAssistantToolCallGroupView {
  const partByToolCallId = new Map<string, MessagePartRecord>()
  for (const partValue of parts) {
    const part = readPart(partValue)
    if (part?.type !== 'tool-call' || typeof part.toolCallId !== 'string') continue
    partByToolCallId.set(part.toolCallId, part)
  }
  const counts: Record<WorkspaceAssistantToolCallDisplayState, number> = {
    success: 0,
    submitted: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    needsAction: 0,
  }
  for (const toolCallId of group.toolCallIds) {
    const part = partByToolCallId.get(toolCallId)
    counts[part ? resolveWorkspaceAssistantToolCallDisplayState(part) : 'running'] += 1
  }
  return {
    leaderToolCallId: group.leaderToolCallId,
    total: group.toolCallIds.length,
    ...counts,
  }
}

function readPartType(value: unknown): string | null {
  const part = readPart(value)
  return typeof part?.type === 'string' ? part.type : null
}

function hasNonEmptyText(value: unknown): boolean {
  const part = readPart(value)
  return typeof part?.text === 'string' && part.text.trim().length > 0
}

function isRunAnchorPart(value: unknown): boolean {
  const part = readPart(value)
  return part?.type === 'data' && part.name === 'agent-run'
}

function readRunStatus(value: unknown): WorkspaceAssistantRunTraceView['runStatus'] {
  const part = readPart(value)
  const data = readPart(part?.data)
  if (part?.type !== 'data' || part.name !== 'agent-run') return null
  const status = data?.status
  return status === 'running'
    || status === 'awaiting_approval'
    || status === 'awaiting_choice'
    || status === 'awaiting_task'
    || status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    ? status
    : null
}

function isReasoningPart(value: unknown): boolean {
  return readPartType(value) === 'reasoning'
}

function isTextPart(value: unknown): boolean {
  return readPartType(value) === 'text'
}

function isToolPart(value: unknown): boolean {
  return readPartType(value) === 'tool-call'
}

function isVisibleToolPart(value: unknown): boolean {
  const part = readPart(value)
  return part?.type === 'tool-call'
    && typeof part.toolName === 'string'
    && !HIDDEN_TRACE_TOOL_NAMES.has(part.toolName)
}

function isVisibleDataPart(value: unknown): boolean {
  const part = readPart(value)
  return part?.type === 'data'
    && typeof part.name === 'string'
    && VISIBLE_DATA_PART_NAMES.has(part.name)
}

function isVisibleNonTracePart(value: unknown): boolean {
  const type = readPartType(value)
  if (type === 'text' || type === 'reasoning') return hasNonEmptyText(value)
  if (type === 'tool-call') return isVisibleToolPart(value)
  if (type === 'data') return isVisibleDataPart(value)
  return type === 'source'
    || type === 'image'
    || type === 'file'
    || type === 'audio'
}

export function resolveWorkspaceAssistantRunTraceView(
  parts: readonly unknown[],
): WorkspaceAssistantRunTraceView {
  const hasPublicReasoning = parts.some((part) => (
    isReasoningPart(part) && hasNonEmptyText(part)
  ))
  const traceAnchorIndex = parts.findIndex(isRunAnchorPart)
  const latestRunPart = parts.findLast(isRunAnchorPart)
  const runStatus = readRunStatus(latestRunPart)
  const lastVisibleToolIndex = parts.findLastIndex(isVisibleToolPart)
  const visibleToolCallIds = new Set<string>()

  for (const [index, partValue] of parts.entries()) {
    if (!isVisibleToolPart(partValue)) continue
    const part = readPart(partValue)
    const toolCallId = typeof part?.toolCallId === 'string' && part.toolCallId.trim()
      ? part.toolCallId.trim()
      : `missing-tool-call-id:${index}`
    visibleToolCallIds.add(toolCallId)
  }

  const terminal = runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled'
  const traceIndices = terminal && hasPublicReasoning && traceAnchorIndex >= 0
    ? parts.flatMap((part, index) => {
        if (index === traceAnchorIndex) return [index]
        if (isReasoningPart(part) || isToolPart(part)) return [index]
        if (
          lastVisibleToolIndex >= 0
          && index < lastVisibleToolIndex
          && isTextPart(part)
          && hasNonEmptyText(part)
        ) {
          return [index]
        }
        return []
      })
    : []

  return {
    hasPublicReasoning,
    hasVisibleContent: parts.some(isVisibleNonTracePart),
    visibleToolCallCount: visibleToolCallIds.size,
    runStatus,
    traceAnchorIndex: traceAnchorIndex >= 0 ? traceAnchorIndex : null,
    traceIndices,
  }
}

export function groupWorkspaceAssistantMessageParts(
  parts: readonly unknown[],
): WorkspaceAssistantMessagePartGroup[] {
  const view = resolveWorkspaceAssistantRunTraceView(parts)
  if (view.traceIndices.length === 0 || view.traceAnchorIndex === null) {
    return parts.map((_part, index) => ({
      groupKey: undefined,
      indices: [index],
    }))
  }

  const traceIndices = new Set(view.traceIndices)
  const groups: WorkspaceAssistantMessagePartGroup[] = []

  for (const [index] of parts.entries()) {
    if (index === view.traceAnchorIndex) {
      groups.push({
        groupKey: WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY,
        indices: [...view.traceIndices],
      })
      continue
    }
    if (traceIndices.has(index)) continue
    groups.push({
      groupKey: undefined,
      indices: [index],
    })
  }

  return groups
}
