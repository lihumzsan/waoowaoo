import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { grantUserCredits } from '@/lib/billing/admin-credit-grant'
import { requireAdminUserId } from '@/lib/admin/admin-auth'

const grantCreditsSchema = z.object({
  userId: z.string().min(1).optional(),
  userName: z.string().min(1).optional(),
  amount: z.number().positive(),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
}).refine((value) => Boolean(value.userId || value.userName), {
  message: 'userId or userName is required',
})

function requireAdminCreditToken(request: NextRequest) {
  const expectedToken = process.env.ADMIN_CREDIT_TOKEN || ''
  if (!expectedToken) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'ADMIN_CREDIT_TOKEN_MISSING',
    })
  }
  const token = request.headers.get('x-admin-credit-token') || ''
  if (token !== expectedToken) {
    throw new ApiError('FORBIDDEN')
  }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  requireAdminUserId(authResult.session.user.id)
  requireAdminCreditToken(request)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
    })
  }

  const parsed = grantCreditsSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ADMIN_CREDIT_GRANT_PAYLOAD_INVALID',
      field: 'body',
    })
  }

  const result = await grantUserCredits({
    ...parsed.data,
    operatorId: authResult.session.user.id,
  })
  return NextResponse.json(result)
})
