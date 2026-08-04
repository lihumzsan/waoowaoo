import { NextRequest, NextResponse } from 'next/server'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  getAssistantRuntimeService,
  getAssistantRuntimeSessionView,
} from '@/lib/assistant-runtime'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  mapProjectAgentCommandError,
  readProjectAgentCommandHttpBody,
  readNullableProjectAgentCommandString,
  readRequiredProjectAgentCommandString,
  type ProjectAgentCommandHttpBody,
} from '../command-http'

async function validateUserMessage(message: unknown): Promise<UIMessage> {
  const validation = await safeValidateUIMessages({ messages: [message] })
  if (!validation.success) throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  const [validatedMessage] = ensureUniqueUIMessages(validation.data)
  if (!validatedMessage || validatedMessage.role !== 'user') {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  return validatedMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (unexpected.length > 0) {
    throw new Error(`${code}:${unexpected.sort().join(',')}`)
  }
}

function readUserTurnContext(body: ProjectAgentCommandHttpBody): {
  locale: string
  selectedScopeRef: string | null
  selectedAssetId: string | null
} {
  assertExactKeys(
    body,
    new Set(['message', 'context']),
    'AGENT_TURN_COMMAND_FIELDS_INVALID',
  )
  const context = body.context
  if (context !== undefined && !isRecord(context)) {
    throw new Error('AGENT_TURN_CONTEXT_INVALID')
  }
  const contextRecord = context ?? {}
  assertExactKeys(
    contextRecord,
    new Set([
      'locale',
      'selectedScopeRef',
      'selectedAssetId',
    ]),
    'AGENT_TURN_CONTEXT_FIELDS_INVALID',
  )
  return {
    locale: readRequiredProjectAgentCommandString(
      contextRecord.locale,
      'AGENT_TURN_LOCALE_INVALID',
      64,
    ),
    selectedScopeRef: readNullableProjectAgentCommandString(
      contextRecord.selectedScopeRef,
      'AGENT_TURN_SCOPE_REF_INVALID',
    ),
    selectedAssetId: readNullableProjectAgentCommandString(
      contextRecord.selectedAssetId,
      'AGENT_TURN_ASSET_ID_INVALID',
    ),
  }
}

function readClearCommand(body: ProjectAgentCommandHttpBody): {
  threadId: string
  requestId: string
} {
  assertExactKeys(
    body,
    new Set(['threadId', 'requestId']),
    'AGENT_THREAD_CLEAR_FIELDS_INVALID',
  )
  return {
    threadId: readRequiredProjectAgentCommandString(
      body.threadId,
      'AGENT_THREAD_ID_INVALID',
    ),
    requestId: readRequiredProjectAgentCommandString(
      body.requestId,
      'AGENT_THREAD_CLEAR_REQUEST_ID_INVALID',
      128,
    ),
  }
}

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const view = await getAssistantRuntimeSessionView({
      projectId,
      userId: authResult.session.user.id,
      assistantId: 'workspace-command',
    })
    return NextResponse.json(view)
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const body = await readProjectAgentCommandHttpBody(request)
    const command = readClearCommand(body)
    const receipt = await getAssistantRuntimeService().clear({
      projectId,
      userId: authResult.session.user.id,
      assistantId: 'workspace-command',
      threadId: command.threadId,
      requestId: command.requestId,
    })
    return NextResponse.json(receipt)
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const body = await readProjectAgentCommandHttpBody(request)
    const turnContext = readUserTurnContext(body)
    const message = await validateUserMessage(body.message)
    const sourceId = readRequiredProjectAgentCommandString(
      message.id,
      'AGENT_TURN_SOURCE_ID_INVALID',
    )
    const receipt = await getAssistantRuntimeService().send({
      projectId,
      userId: authResult.session.user.id,
      assistantId: 'workspace-command',
      sourceId,
      requestId: sourceId,
      message,
      context: {
        locale: turnContext.locale,
        selectedScopeRef: turnContext.selectedScopeRef,
        selectedAssetId: turnContext.selectedAssetId,
      },
    })
    return NextResponse.json(receipt, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
