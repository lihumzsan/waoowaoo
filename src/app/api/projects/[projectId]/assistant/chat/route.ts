import { NextRequest, NextResponse } from 'next/server'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  AGENT_TURN_PROTOCOL,
  AGENT_TURN_SOURCE_KIND,
} from '@/lib/agent-turn/contracts'
import { getAgentSessionView } from '@/lib/agent-turn/view'
import {
  getOrCreateProjectAssistantThread,
} from '@/lib/project-agent/persistence'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import { readProjectAssistantTextAttachmentsFromMessage } from '@/lib/project-agent/text-attachments'
import {
  readProjectAssistantMediaAttachmentsFromMessage,
  withProjectAssistantMediaAttachments,
} from '@/lib/project-agent/media-attachments'
import { resolveProjectAssistantMediaAttachments } from '@/lib/project-agent/media-attachments/resolve'
import {
  mapProjectAgentCommandError,
  readProjectAgentCommandEpisodeId,
  readProjectAgentCommandHttpBody,
  readNullableProjectAgentCommandString,
  readRequiredProjectAgentCommandString,
  type ProjectAgentCommandHttpBody,
} from '../command-http'
import {
  clearAgentThreadViaTemporal,
  submitAgentTurnViaTemporal,
} from '@/lib/temporal/agent-thread/client'

function readEpisodeIdFromQuery(request: NextRequest): string | null {
  return readNullableProjectAgentCommandString(
    request.nextUrl.searchParams.get('episodeId'),
    'AGENT_TURN_EPISODE_ID_INVALID',
  )
}

async function validateUserMessage(
  message: unknown,
  scope: { readonly userId: string; readonly projectId: string },
): Promise<UIMessage> {
  const validation = await safeValidateUIMessages({ messages: [message] })
  if (!validation.success) throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  const [validatedMessage] = ensureUniqueUIMessages(validation.data)
  if (!validatedMessage || validatedMessage.role !== 'user') {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  readProjectAssistantTextAttachmentsFromMessage(validatedMessage)
  const mediaRefs = readProjectAssistantMediaAttachmentsFromMessage(validatedMessage)
  if (mediaRefs.length === 0) return validatedMessage
  // The client only proposes refs; ownership, readiness, media type and the
  // visible name are resolved server-side and rewritten into the persisted
  // metadata before the message enters the thread.
  const resolved = await resolveProjectAssistantMediaAttachments({
    userId: scope.userId,
    projectId: scope.projectId,
    refs: mediaRefs,
  })
  return withProjectAssistantMediaAttachments(validatedMessage, resolved)
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
  locale: string | null
  episodeId: string | null
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
      'episodeId',
      'selectedScopeRef',
      'selectedAssetId',
    ]),
    'AGENT_TURN_CONTEXT_FIELDS_INVALID',
  )
  return {
    locale: readNullableProjectAgentCommandString(
      contextRecord.locale,
      'AGENT_TURN_LOCALE_INVALID',
      16,
    ),
    episodeId: readProjectAgentCommandEpisodeId(body),
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
  episodeId: string | null
} {
  assertExactKeys(
    body,
    new Set(['threadId', 'requestId', 'episodeId']),
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
    episodeId: readProjectAgentCommandEpisodeId(body),
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
    const view = await getAgentSessionView({
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromQuery(request),
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
    const receipt = await clearAgentThreadViaTemporal({
      protocol: 'agent_thread_clear_v1',
      threadId: command.threadId,
      projectId,
      userId: authResult.session.user.id,
      episodeId: command.episodeId,
      assistantId: 'workspace-command',
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
    const message = await validateUserMessage(body.message, {
      userId: authResult.session.user.id,
      projectId,
    })
    const sourceId = readRequiredProjectAgentCommandString(
      message.id,
      'AGENT_TURN_SOURCE_ID_INVALID',
    )
    const thread = await getOrCreateProjectAssistantThread({
      projectId,
      userId: authResult.session.user.id,
      episodeId: turnContext.episodeId,
      assistantId: 'workspace-command',
    })
    const receipt = await submitAgentTurnViaTemporal({
      protocol: AGENT_TURN_PROTOCOL,
      threadId: thread.id,
      projectId,
      userId: authResult.session.user.id,
      assistantId: 'workspace-command',
      sourceKind: AGENT_TURN_SOURCE_KIND.USER,
      sourceId,
      requestId: sourceId,
      userMessage: message,
      context: turnContext,
    })
    return NextResponse.json(receipt, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
