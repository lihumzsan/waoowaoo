import { NextRequest, NextResponse } from 'next/server'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { createScopedLogger, type ScopedLogger } from '@/lib/logging/core'
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

function validationDiagnostics(message: unknown, error: unknown): Record<string, unknown> {
  const messageRecord = isRecord(message) ? message : null
  const parts = messageRecord && Array.isArray(messageRecord.parts) ? messageRecord.parts : []
  const errorRecord = isRecord(error) ? error : null
  const issues = errorRecord && Array.isArray(errorRecord.issues) ? errorRecord.issues : []
  return {
    payloadKind: message === null ? 'null' : Array.isArray(message) ? 'array' : typeof message,
    payloadKeys: messageRecord ? Object.keys(messageRecord).sort().slice(0, 20) : [],
    role: messageRecord && typeof messageRecord.role === 'string' ? messageRecord.role : null,
    partCount: parts.length,
    partTypes: parts.slice(0, 20).map((part) => (
      isRecord(part) && typeof part.type === 'string' ? part.type : 'invalid'
    )),
    issueCount: issues.length,
    issues: issues.slice(0, 20).map((issue) => {
      if (!isRecord(issue)) return { code: 'unknown', path: [] }
      return {
        code: typeof issue.code === 'string' ? issue.code : 'unknown',
        path: Array.isArray(issue.path)
          ? issue.path.filter((entry): entry is string | number => (
              typeof entry === 'string' || typeof entry === 'number'
            )).slice(0, 12)
          : [],
      }
    }),
  }
}

async function validateUserMessage(message: unknown, logger: ScopedLogger): Promise<UIMessage> {
  const validation = await safeValidateUIMessages({ messages: [message] })
  if (!validation.success) {
    logger.warn({
      action: 'assistant.message.invalid',
      message: 'assistant message failed structural validation',
      details: validationDiagnostics(message, validation.error),
    })
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  const [validatedMessage] = ensureUniqueUIMessages(validation.data)
  if (!validatedMessage || validatedMessage.role !== 'user') {
    logger.warn({
      action: 'assistant.message.invalid',
      message: 'assistant message did not resolve to one user message',
      details: validationDiagnostics(message, null),
    })
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
  const logger = createScopedLogger({
    module: 'assistant',
    projectId,
    userId: authResult.session.user.id,
  })

  try {
    const body = await readProjectAgentCommandHttpBody(request)
    const turnContext = readUserTurnContext(body)
    const message = await validateUserMessage(body.message, logger)
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
