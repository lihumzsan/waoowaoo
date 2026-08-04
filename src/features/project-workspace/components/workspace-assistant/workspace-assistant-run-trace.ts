import { getToolName, isToolUIPart, type UIMessage } from 'ai'

export const WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES = [
  'update_plan',
] as const

type MessagePartRecord = {
  readonly id?: unknown
  readonly type?: unknown
  readonly state?: unknown
  readonly text?: unknown
  readonly name?: unknown
  readonly data?: unknown
  readonly status?: unknown
  readonly toolCallId?: unknown
  readonly toolName?: unknown
  readonly input?: unknown
  readonly agentThreadId?: unknown
  readonly agentPath?: unknown
  readonly activities?: unknown
  readonly label?: unknown
  readonly kind?: unknown
  readonly result?: unknown
  readonly output?: unknown
  readonly errorText?: unknown
  readonly structuredContent?: unknown
  readonly isError?: unknown
  readonly ok?: unknown
  readonly async?: unknown
  readonly taskId?: unknown
  readonly taskIds?: unknown
}

const RUNTIME_TOOL_INTERRUPTED_PREFIX = 'ASSISTANT_RUNTIME_TOOL_INTERRUPTED:'

export type WorkspaceAssistantSubagentStatus = 'active' | 'completed' | 'interrupted'

export type WorkspaceAssistantSubagentView = {
  readonly agentThreadId: string
  readonly agentPath: string
  readonly status: WorkspaceAssistantSubagentStatus
  readonly activities: readonly WorkspaceAssistantSubagentActivityView[]
}

export type WorkspaceAssistantSubagentActivityView = {
  readonly id: string
  readonly kind: 'message' | 'reasoning' | 'tool'
  readonly label: string | null
  readonly text: string | null
  readonly status: 'running' | 'completed' | 'failed'
}

export type WorkspaceAssistantSubagentLifecycleView = {
  readonly agents: readonly WorkspaceAssistantSubagentView[]
  readonly active: number
  readonly completed: number
  readonly interrupted: number
}

export type WorkspaceAssistantMessageTurnStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

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

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function subagentStatusForTurn(status: WorkspaceAssistantMessageTurnStatus | undefined): WorkspaceAssistantSubagentStatus {
  if (status === 'queued' || status === 'running' || status === 'waiting_approval') return 'active'
  if (status === 'failed' || status === 'interrupted' || status === 'cancelled') return 'interrupted'
  return 'completed'
}

function readSubagentActivities(value: unknown): WorkspaceAssistantSubagentActivityView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): WorkspaceAssistantSubagentActivityView[] => {
    const activity = readPart(entry)
    const id = readNonEmptyString(activity?.id)
    const kind = readNonEmptyString(activity?.kind)
    const status = readNonEmptyString(activity?.status)
    if (
      !id
      || (kind !== 'message' && kind !== 'reasoning' && kind !== 'tool')
      || (status !== 'running' && status !== 'completed' && status !== 'failed')
    ) return []
    return [{
      id,
      kind,
      label: readNonEmptyString(activity?.label),
      text: readNonEmptyString(activity?.text),
      status,
    }]
  })
}

/**
 * Subagent activity items carry the stable child thread and path identities,
 * while the Wao Turn is the authority for whether that collaboration is still
 * active, completed, or interrupted. This keeps the UI from treating a
 * completed `spawn`/`wait` tool call as the child agent's lifecycle.
 */
export function resolveWorkspaceAssistantSubagentLifecycleViews(
  messages: readonly UIMessage[],
  statusByAssistantMessageId: ReadonlyMap<string, WorkspaceAssistantMessageTurnStatus>,
): ReadonlyMap<string, WorkspaceAssistantSubagentLifecycleView> {
  const views = new Map<string, WorkspaceAssistantSubagentLifecycleView>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const status = subagentStatusForTurn(statusByAssistantMessageId.get(message.id))
    const byThreadId = new Map<string, WorkspaceAssistantSubagentView>()
    for (const part of message.parts) {
      const record = readPart(part)
      if (record?.type === 'data-assistant-runtime-subagent') {
        const data = readPart(record.data)
        const agentThreadId = readNonEmptyString(data?.agentThreadId)
        const agentPath = readNonEmptyString(data?.agentPath)
        const childStatus = readNonEmptyString(data?.status)
        if (
          agentThreadId
          && agentPath
          && (childStatus === 'active' || childStatus === 'completed' || childStatus === 'interrupted')
        ) {
          byThreadId.set(agentThreadId, {
            agentThreadId,
            agentPath,
            status: childStatus,
            activities: readSubagentActivities(data?.activities),
          })
        }
        continue
      }
      if (!isToolUIPart(part) || getToolName(part) !== 'subagent_activity') continue
      const input = readPart(record?.input)
      const agentThreadId = readNonEmptyString(input?.agentThreadId)
      const agentPath = readNonEmptyString(input?.agentPath)
      if (!agentThreadId || !agentPath) continue
      const kind = readNonEmptyString(input?.kind)
      if (byThreadId.has(agentThreadId)) continue
      byThreadId.set(agentThreadId, {
        agentThreadId,
        agentPath,
        status: kind === 'interrupted' ? 'interrupted' : status,
        activities: [],
      })
    }
    if (byThreadId.size === 0) continue
    const agents = [...byThreadId.values()].sort((left, right) => left.agentPath.localeCompare(right.agentPath))
    views.set(message.id, {
      agents,
      active: agents.filter((agent) => agent.status === 'active').length,
      completed: agents.filter((agent) => agent.status === 'completed').length,
      interrupted: agents.filter((agent) => agent.status === 'interrupted').length,
    })
  }
  return views
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
  const record = readPart(result)
  return record?.ok === false || record?.status === 'failed' || record?.status === 'errored'
}

function isInterruptedToolResult(result: unknown): boolean {
  const record = readPart(result)
  const nestedResult = readPart(record?.result)
  const structuredContent = readPart(record?.structuredContent)
    ?? readPart(nestedResult?.structuredContent)
  return [record?.status, structuredContent?.status].some((status) => (
    status === 'declined' || status === 'interrupted' || status === 'cancelled'
  ))
}

export function isWorkspaceAssistantRuntimeInterruptedToolPart(value: unknown): boolean {
  const part = readPart(value)
  return part?.state === 'output-error'
    && readNonEmptyString(part.errorText)?.startsWith(RUNTIME_TOOL_INTERRUPTED_PREFIX) === true
}

export function resolveWorkspaceAssistantToolCallDisplayState(
  value: unknown,
): WorkspaceAssistantToolCallDisplayState {
  const part = readPart(value)
  const status = readPart(part?.status)?.type
  if (status === 'incomplete') return 'interrupted'
  if (status === 'requires-action') return 'needsAction'
  if (status !== 'complete') return 'running'
  if (readNonEmptyString(part?.errorText)?.startsWith(RUNTIME_TOOL_INTERRUPTED_PREFIX)) {
    return 'interrupted'
  }
  if (isInterruptedToolResult(part?.result)) return 'interrupted'
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
  messages: readonly UIMessage[],
  group: WorkspaceAssistantRepeatedToolCallGroup,
): WorkspaceAssistantToolCallGroupView {
  const partByToolCallId = new Map<string, MessagePartRecord>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const partValue of message.parts) {
      if (!isToolUIPart(partValue) || !partValue.toolCallId) continue
      const part = readPart(partValue)
      const state = typeof part?.state === 'string' ? part.state : null
      const output = part?.output
      partByToolCallId.set(partValue.toolCallId, {
        type: 'tool-call',
        toolCallId: partValue.toolCallId,
        toolName: getToolName(partValue),
        status: {
          type: state === 'output-available' || state === 'output-error'
            ? 'complete'
            : 'running',
        },
        result: output,
        errorText: part?.errorText,
        isError: state === 'output-error',
      })
    }
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
