import { NextRequest, NextResponse } from 'next/server'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { executeProjectAgentCommand } from '@/lib/project-agent/command-service'
import { clearProjectAssistantThread } from '@/lib/project-agent/thread-clear'
import { getProjectAssistantThreadWatermarkedSnapshot } from '@/lib/project-agent/thread-snapshot'
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
  readProjectAgentCommandString,
  type ProjectAgentCommandHttpBody,
} from '../command-http'

function readEpisodeIdFromQuery(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get('episodeId')?.trim() || null
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

function assertChatCommandShape(body: ProjectAgentCommandHttpBody): void {
  if (Object.prototype.hasOwnProperty.call(body, 'messages')) {
    throw new Error('PROJECT_AGENT_MESSAGES_NOT_ACCEPTED')
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'control')
    || Object.prototype.hasOwnProperty.call(body, 'visibleUserText')
  ) {
    throw new Error('PROJECT_AGENT_CONTROL_ENDPOINT_REQUIRED')
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
    const snapshot = await getProjectAssistantThreadWatermarkedSnapshot({
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromQuery(request),
      assistantId: 'workspace-command',
    })
    return NextResponse.json(snapshot)
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
    const result = await clearProjectAssistantThread({
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromQuery(request),
      assistantId: 'workspace-command',
    })
    return NextResponse.json({ success: true, eventWatermark: result.eventWatermark })
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
    assertChatCommandShape(body)
    const message = await validateUserMessage(body.message, {
      userId: authResult.session.user.id,
      projectId,
    })
    return await executeProjectAgentCommand({
      request,
      scope: {
        projectId,
        userId: authResult.session.user.id,
        episodeId: readProjectAgentCommandEpisodeId(body),
        assistantId: 'workspace-command',
      },
      context: body.context,
      locale: readProjectAgentCommandString(body.locale),
      command: {
        kind: 'user_turn',
        message,
      },
    })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
