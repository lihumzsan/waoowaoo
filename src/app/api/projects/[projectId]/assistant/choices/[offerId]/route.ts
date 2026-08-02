import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  buildAssistantRuntimeServerResponse,
  getAssistantRuntimeService,
  getAssistantRuntimeSessionView,
  isAssistantRuntimeChoiceRequest,
} from '@/lib/assistant-runtime'
import {
  assertProjectAgentCommandKeys,
  mapProjectAgentCommandError,
  readProjectAgentCommandEpisodeId,
  readProjectAgentCommandHttpBody,
  readRequiredProjectAgentCommandString,
} from '../../command-http'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; offerId: string }> },
) => {
  const { projectId, offerId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const body = await readProjectAgentCommandHttpBody(request)
    assertProjectAgentCommandKeys(
      body,
      ['threadId', 'requestId', 'response', 'episodeId'],
      'AGENT_TURN_CHOICE_FIELDS_INVALID',
    )
    if (!Object.prototype.hasOwnProperty.call(body, 'response')) {
      throw new Error('AGENT_TURN_CHOICE_RESPONSE_REQUIRED')
    }
    readRequiredProjectAgentCommandString(
      body.requestId,
      'AGENT_TURN_CHOICE_REQUEST_ID_INVALID',
      128,
    )
    const threadId = readRequiredProjectAgentCommandString(
      body.threadId,
      'AGENT_TURN_CHOICE_THREAD_ID_INVALID',
    )
    const interactionId = readRequiredProjectAgentCommandString(
      offerId,
      'AGENT_TURN_CHOICE_OFFER_ID_INVALID',
    )
    const scope = {
      projectId,
      userId: authResult.session.user.id,
      episodeId: readProjectAgentCommandEpisodeId(body),
      assistantId: 'workspace-command' as const,
    }
    const view = await getAssistantRuntimeSessionView(scope)
    const interaction = view.pendingInteraction
    if (
      !isAssistantRuntimeChoiceRequest(interaction)
      || view.thread?.threadId !== threadId
      || interaction.interactionId !== interactionId
    ) {
      throw new Error('ASSISTANT_RUNTIME_CHOICE_NOT_PENDING')
    }
    await getAssistantRuntimeService().respondToServerRequest({
      ...scope,
      threadId,
      turnId: interaction.turnId,
      interactionId,
      response: buildAssistantRuntimeServerResponse({
        interaction,
        result: body.response,
      }),
    })
    return NextResponse.json({ accepted: true, interactionId }, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
