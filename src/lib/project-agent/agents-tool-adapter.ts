import type { UIMessage, UIMessageStreamWriter } from 'ai'
import {
  tool,
  type Tool,
} from '@openai/agents'
import type { NextRequest } from 'next/server'
import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
import { isConfirmedOperationInput } from '@/lib/operations/confirmation'
import type {
  ProjectAgentOperationDefinition,
  ProjectAgentToolResult,
} from '@/lib/operations/types'
import {
  shouldRequireAssistantToolApproval,
  type AssistantPermissionMode,
} from './permission-mode'
import type { ProjectAgentContext } from './types'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeToolInputForExecution(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolInputForExecution)
  }
  if (!isRecord(value)) return value
  const out: UnknownObject = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === null) continue
    out[key] = normalizeToolInputForExecution(child)
  }
  return out
}

function injectConfirmedInput(input: unknown, requiresApproval: boolean): unknown {
  if (!requiresApproval || isConfirmedOperationInput(input)) return input
  if (isRecord(input)) {
    return {
      ...input,
      confirmed: true,
    }
  }
  return {
    value: input,
    confirmed: true,
  }
}

function readToolCallId(details: unknown): string | null {
  if (!isRecord(details)) return null
  const toolCall = details.toolCall
  if (!isRecord(toolCall)) return null
  const callId = toolCall.callId
  if (typeof callId === 'string' && callId.trim()) return callId.trim()
  const id = toolCall.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export interface CreateProjectAgentOperationToolParams {
  request: NextRequest
  operation: ProjectAgentOperationDefinition
  description: string
  projectId: string
  userId: string
  context: ProjectAgentContext
  assistantPermissionMode: AssistantPermissionMode
  writer: UIMessageStreamWriter<UIMessage>
}

export function createProjectAgentOperationTool(
  params: CreateProjectAgentOperationToolParams,
): Tool {
  const requiresApproval = shouldRequireAssistantToolApproval({
    mode: params.assistantPermissionMode,
    operation: params.operation,
  })

  return tool({
    name: params.operation.id,
    description: params.description,
    parameters: params.operation.toolInputSchema as never,
    strict: true,
    ...(requiresApproval ? { needsApproval: true } : {}),
    execute: async (toolInput: unknown, _runContext: unknown, details: unknown): Promise<ProjectAgentToolResult<unknown>> => (
      executeProjectAgentOperationFromTool({
        request: params.request,
        operationId: params.operation.id,
        projectId: params.projectId,
        userId: params.userId,
        context: params.context,
        assistantPermissionMode: params.assistantPermissionMode,
        source: 'assistant-panel',
        writer: params.writer,
        input: injectConfirmedInput(normalizeToolInputForExecution(toolInput), requiresApproval),
        toolCallId: readToolCallId(details),
      })
    ),
  })
}
