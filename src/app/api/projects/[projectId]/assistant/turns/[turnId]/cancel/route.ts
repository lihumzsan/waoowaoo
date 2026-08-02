import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { getAssistantRuntimeService } from '@/lib/assistant-runtime'
import {
  assertProjectAgentCommandKeys,
  mapProjectAgentCommandError,
  readNullableProjectAgentCommandString,
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
      ['threadId', 'requestId', 'reason'],
      'AGENT_TURN_CANCEL_FIELDS_INVALID',
    )
    const receipt = await getAssistantRuntimeService().interrupt({
      projectId,
      userId: authResult.session.user.id,
      assistantId: 'workspace-command',
      threadId: readRequiredProjectAgentCommandString(
        body.threadId,
        'AGENT_TURN_CANCEL_THREAD_ID_INVALID',
      ),
      turnId: readRequiredProjectAgentCommandString(
        turnId,
        'AGENT_TURN_CANCEL_TURN_ID_INVALID',
      ),
      requestId: readRequiredProjectAgentCommandString(
        body.requestId,
        'AGENT_TURN_CANCEL_REQUEST_ID_INVALID',
        128,
      ),
      reason: readNullableProjectAgentCommandString(
        body.reason,
        'AGENT_TURN_CANCEL_REASON_INVALID',
        2_000,
      ),
    })
    return NextResponse.json(receipt)
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
