import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import {
  creativeRuntimeSkillReadToolName,
  resolveCreativeRuntimeSkillReadCommand,
} from '@/lib/creative-skills/runtime-skill-read'

export const WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES = [
  'update_plan',
  // Deleted file/pointer protocol. Historical messages may still contain its
  // calls, but rendering their intermediate success/failure counts would
  // misrepresent the canonical media Task results.
  'submit_production_manifest',
  // Codex agents are disabled. Keep historical collaboration calls out of the
  // current trace instead of preserving a dead lifecycle renderer.
  'spawnAgent',
  'spawn_agent',
  'sendInput',
  'send_message',
  'resumeAgent',
  'followup_task',
  'wait',
  'wait_agent',
  'closeAgent',
  'interrupt_agent',
  'list_agents',
  'subagent_activity',
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
  readonly command?: unknown
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

/**
 * Historical messages stored Skill file reads as shell calls. Normalize only
 * their presentation identity; the persisted execution and call id stay intact.
 */
function presentationToolName(value: UIMessage['parts'][number]): string | null {
  if (!isToolUIPart(value)) return null
  const toolName = getToolName(value)
  if (toolName !== 'shell') return toolName
  const part = readPart(value)
  const input = readPart(part?.input)
  const skillId = resolveCreativeRuntimeSkillReadCommand(input?.command)
  return skillId ? creativeRuntimeSkillReadToolName(skillId) : toolName
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
      const toolName = presentationToolName(part)
      if (!toolName) continue
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
        toolName: presentationToolName(partValue) ?? getToolName(partValue),
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
