import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  buildAssistantRuntimeServerResponse,
  getAssistantRuntimeService,
  getAssistantRuntimeSessionView,
  isAssistantRuntimeApprovalRequest,
} from '@/lib/assistant-runtime'
import {
  assertProjectAgentCommandKeys,
  mapProjectAgentCommandError,
  readNullableProjectAgentCommandString,
  readProjectAgentCommandEpisodeId,
  readProjectAgentCommandHttpBody,
  readRequiredProjectAgentCommandString,
} from '../../../command-http'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; turnId: string }> },
) => {
  const { projectId, turnId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const body = await readProjectAgentCommandHttpBody(request)
    assertProjectAgentCommandKeys(
      body,
      ['threadId', 'interactionId', 'requestId', 'decision', 'reason', 'episodeId'],
      'AGENT_TURN_APPROVAL_FIELDS_INVALID',
    )
    const decision = body.decision
    if (decision !== 'approve' && decision !== 'reject') {
      throw new Error('AGENT_TURN_APPROVAL_DECISION_INVALID')
    }
    const threadId = readRequiredProjectAgentCommandString(
        body.threadId,
        'AGENT_TURN_APPROVAL_THREAD_ID_INVALID',
      )
    const canonicalTurnId = readRequiredProjectAgentCommandString(
        turnId,
        'AGENT_TURN_APPROVAL_TURN_ID_INVALID',
      )
    const interactionId = readRequiredProjectAgentCommandString(
        body.interactionId,
        'AGENT_TURN_APPROVAL_INTERACTION_ID_INVALID',
      )
    readRequiredProjectAgentCommandString(
      body.requestId,
      'AGENT_TURN_APPROVAL_REQUEST_ID_INVALID',
      128,
    )
    readNullableProjectAgentCommandString(
      body.reason,
      'AGENT_TURN_APPROVAL_REASON_INVALID',
      2_000,
    )
    const episodeId = readProjectAgentCommandEpisodeId(body)
    const scope = {
      projectId,
      userId: authResult.session.user.id,
      episodeId,
      assistantId: 'workspace-command' as const,
    }
    const view = await getAssistantRuntimeSessionView(scope)
    const interaction = view.pendingInteraction
    if (
      !isAssistantRuntimeApprovalRequest(interaction)
      || view.thread?.threadId !== threadId
      || interaction.turnId !== canonicalTurnId
      || interaction.interactionId !== interactionId
    ) {
      throw new Error('ASSISTANT_RUNTIME_APPROVAL_NOT_PENDING')
    }
    await getAssistantRuntimeService().respondToServerRequest({
      ...scope,
      threadId,
      turnId: canonicalTurnId,
      interactionId,
      response: buildAssistantRuntimeServerResponse({
        interaction,
        result: { decision: decision === 'approve' ? 'accept' : 'decline' },
      }),
    })
    return NextResponse.json({ accepted: true, interactionId }, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
