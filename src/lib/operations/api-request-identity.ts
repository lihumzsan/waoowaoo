import type { NextRequest } from 'next/server'
import { ApiError, getIdempotencyKey } from '@/lib/api-errors'

const OPERATION_REQUEST_ID_MAX_LENGTH = 128

export function readOperationRequestId(
  request: NextRequest,
  params: {
    readonly required: true
    readonly operationId?: string
  },
): string
export function readOperationRequestId(
  request: NextRequest,
  params: {
    readonly required: boolean
    readonly operationId?: string
  },
): string | null
export function readOperationRequestId(
  request: NextRequest,
  params: {
    readonly required: boolean
    readonly operationId?: string
  },
): string | null {
  const requestId = getIdempotencyKey(request)?.trim() || null
  if (!requestId && params.required) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_IDEMPOTENCY_KEY_REQUIRED',
      header: 'Idempotency-Key',
      ...(params.operationId ? { operationId: params.operationId } : {}),
    })
  }
  if (requestId && requestId.length > OPERATION_REQUEST_ID_MAX_LENGTH) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_IDEMPOTENCY_KEY_INVALID',
      header: 'Idempotency-Key',
      ...(params.operationId ? { operationId: params.operationId } : {}),
    })
  }
  return requestId
}

export function assertOperationRequestIdMatches(
  headerRequestId: string,
  bodyRequestId: string,
  operationId?: string,
): void {
  if (headerRequestId === bodyRequestId) return
  throw new ApiError('CONFLICT', {
    code: 'APPROVAL_GRANT_REQUEST_MISMATCH',
    ...(operationId ? { operationId } : {}),
  })
}
