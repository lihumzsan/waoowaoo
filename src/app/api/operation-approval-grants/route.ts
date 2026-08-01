import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import {
  assertOperationRequestIdMatches,
  readOperationRequestId,
} from '@/lib/operations/api-request-identity'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const body: unknown = await request.json()
  if (!isRecord(body)) throw new ApiError('INVALID_PARAMS')
  const planSnapshotId = typeof body.planSnapshotId === 'string' ? body.planSnapshotId.trim() : ''
  const operationRequestId = typeof body.operationRequestId === 'string' ? body.operationRequestId.trim() : ''
  if (!planSnapshotId || !operationRequestId) throw new ApiError('INVALID_PARAMS')
  const headerRequestId = readOperationRequestId(request, { required: true })
  assertOperationRequestIdMatches(headerRequestId, operationRequestId)
  return NextResponse.json(await issueApprovalGrant({
    userId: authResult.session.user.id,
    planSnapshotId,
    requestId: operationRequestId,
  }))
})
