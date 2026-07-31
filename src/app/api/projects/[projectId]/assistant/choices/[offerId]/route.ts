import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { resolveAgentTurnChoiceViaTemporal } from '@/lib/temporal/agent-thread/client'
import {
  assertProjectAgentCommandKeys,
  mapProjectAgentCommandError,
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
      ['threadId', 'requestId', 'response'],
      'AGENT_TURN_CHOICE_FIELDS_INVALID',
    )
    if (!Object.prototype.hasOwnProperty.call(body, 'response')) {
      throw new Error('AGENT_TURN_CHOICE_RESPONSE_REQUIRED')
    }
    const receipt = await resolveAgentTurnChoiceViaTemporal({
      protocol: 'agent_turn_choice_response_v1',
      threadId: readRequiredProjectAgentCommandString(
        body.threadId,
        'AGENT_TURN_CHOICE_THREAD_ID_INVALID',
      ),
      offerId: readRequiredProjectAgentCommandString(
        offerId,
        'AGENT_TURN_CHOICE_OFFER_ID_INVALID',
      ),
      projectId,
      userId: authResult.session.user.id,
      requestId: readRequiredProjectAgentCommandString(
        body.requestId,
        'AGENT_TURN_CHOICE_REQUEST_ID_INVALID',
        128,
      ),
      response: body.response,
    })
    return NextResponse.json(receipt, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
