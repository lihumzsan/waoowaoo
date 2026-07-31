import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { resolveAgentTurnApprovalViaTemporal } from '@/lib/temporal/agent-thread/client'
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
      ['threadId', 'interactionId', 'requestId', 'decision', 'reason'],
      'AGENT_TURN_APPROVAL_FIELDS_INVALID',
    )
    const decision = body.decision
    if (decision !== 'approve' && decision !== 'reject') {
      throw new Error('AGENT_TURN_APPROVAL_DECISION_INVALID')
    }
    const receipt = await resolveAgentTurnApprovalViaTemporal({
      protocol: 'agent_turn_approval_response_v1',
      threadId: readRequiredProjectAgentCommandString(
        body.threadId,
        'AGENT_TURN_APPROVAL_THREAD_ID_INVALID',
      ),
      turnId: readRequiredProjectAgentCommandString(
        turnId,
        'AGENT_TURN_APPROVAL_TURN_ID_INVALID',
      ),
      interactionId: readRequiredProjectAgentCommandString(
        body.interactionId,
        'AGENT_TURN_APPROVAL_INTERACTION_ID_INVALID',
      ),
      projectId,
      userId: authResult.session.user.id,
      requestId: readRequiredProjectAgentCommandString(
        body.requestId,
        'AGENT_TURN_APPROVAL_REQUEST_ID_INVALID',
        128,
      ),
      decision,
      reason: readNullableProjectAgentCommandString(
        body.reason,
        'AGENT_TURN_APPROVAL_REASON_INVALID',
        2_000,
      ),
    })
    return NextResponse.json(receipt, { status: 202 })
  } catch (error) {
    throw mapProjectAgentCommandError(error)
  }
})
