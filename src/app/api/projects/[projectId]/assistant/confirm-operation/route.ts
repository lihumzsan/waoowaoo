import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  normalizeAssistantToolApprovalRequest,
  resolveAssistantToolApproval,
} from '@/lib/project-agent/tool-approval'

export const runtime = 'nodejs'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }

  const approvalRequest = normalizeAssistantToolApprovalRequest(body)
  const resolution = await resolveAssistantToolApproval({
    request,
    projectId,
    userId: authResult.session.user.id,
    approvalId: approvalRequest.approvalId,
    decision: approvalRequest.decision,
  })

  return NextResponse.json(resolution.output)
})
