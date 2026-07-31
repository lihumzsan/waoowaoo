import { getToolName, isToolUIPart, type UIMessage } from 'ai'

export const WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES = [
  'update_plan',
] as const

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
