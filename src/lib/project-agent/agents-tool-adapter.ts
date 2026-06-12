import type { UIMessage, UIMessageStreamWriter } from 'ai'
import {
  tool,
  type Tool,
} from '@openai/agents'
import type { NextRequest } from 'next/server'
import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
import { isConfirmedOperationInput, shouldRequireAssistantConfirmation } from '@/lib/operations/confirmation'
import type {
  ProjectAgentOperationDefinition,
  ProjectAgentToolResult,
} from '@/lib/operations/types'
import type { ProjectAgentContext } from './types'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
  writer: UIMessageStreamWriter<UIMessage>
}

export function createProjectAgentOperationTool(
  params: CreateProjectAgentOperationToolParams,
): Tool {
  const requiresApproval = shouldRequireAssistantConfirmation(params.operation.confirmation)

  return tool({
    name: params.operation.id,
    description: params.description,
    parameters: params.operation.inputSchema as never,
    strict: true,
    ...(requiresApproval ? { needsApproval: true } : {}),
    execute: async (toolInput: unknown, _runContext: unknown, details: unknown): Promise<ProjectAgentToolResult<unknown>> => (
      executeProjectAgentOperationFromTool({
        request: params.request,
        operationId: params.operation.id,
        projectId: params.projectId,
        userId: params.userId,
        context: params.context,
        source: 'assistant-panel',
        writer: params.writer,
        input: injectConfirmedInput(toolInput, requiresApproval),
        toolCallId: readToolCallId(details),
      })
    ),
  })
}
