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
}

export type WorkspaceAssistantMessagePartGroup = {
  readonly groupKey: string | undefined
  readonly indices: number[]
}

export type WorkspaceAssistantRunTraceView = {
  readonly hasPublicReasoning: boolean
  readonly hasVisibleContent: boolean
  readonly visibleToolCallCount: number
  readonly traceAnchorIndex: number | null
  readonly traceIndices: readonly number[]
}

function readPart(value: unknown): MessagePartRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as MessagePartRecord
    : null
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

function isRunCompleted(value: unknown): boolean {
  const part = readPart(value)
  const data = readPart(part?.data)
  return part?.type === 'data'
    && part.name === 'agent-run'
    && data?.status === 'completed'
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
  const runCompleted = isRunCompleted(latestRunPart)
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

  const traceIndices = runCompleted && hasPublicReasoning && traceAnchorIndex >= 0
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
