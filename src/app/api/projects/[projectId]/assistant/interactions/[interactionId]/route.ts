import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  buildAssistantRuntimeServerResponse,
  getAssistantRuntimeService,
  getAssistantRuntimeSessionView,
} from '@/lib/assistant-runtime'
import {
  assertProjectAgentCommandKeys,
  mapProjectAgentCommandError,
  readProjectAgentCommandHttpBody,
  readRequiredProjectAgentCommandString,
} from '../../command-http'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; interactionId: string }> },
) => {
  const { projectId, interactionId: rawInteractionId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const body = await readProjectAgentCommandHttpBody(request)
    assertProjectAgentCommandKeys(
      body,
      ['threadId', 'requestId', 'result'],
      'ASSISTANT_RUNTIME_INTERACTION_FIELDS_INVALID',
    )
    if (!Object.prototype.hasOwnProperty.call(body, 'result')) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESULT_REQUIRED')
    }
    readRequiredProjectAgentCommandString(
      body.requestId,
      'ASSISTANT_RUNTIME_INTERACTION_REQUEST_ID_INVALID',
      128,
    )
    const threadId = readRequiredProjectAgentCommandString(
      body.threadId,
      'ASSISTANT_RUNTIME_INTERACTION_THREAD_ID_INVALID',
    )
    const interactionId = readRequiredProjectAgentCommandString(
      rawInteractionId,
      'ASSISTANT_RUNTIME_INTERACTION_ID_INVALID',
    )
    const scope = {
      projectId,
      userId: authResult.session.user.id,
      assistantId: 'workspace-command' as const,
    }
    const view = await getAssistantRuntimeSessionView(scope)
    const interaction = view.pendingInteraction
    if (
      !interaction
      || view.thread?.threadId !== threadId
      || interaction.interactionId !== interactionId
    ) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_NOT_PENDING')
    }
    await getAssistantRuntimeService().respondToServerRequest({
      ...scope,
      threadId,
      turnId: interaction.turnId,
      interactionId,
      response: buildAssistantRuntimeServerResponse({
        interaction,
        result: body.result,
      }),
    })
    return NextResponse.json({ accepted: true, interactionId }, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
