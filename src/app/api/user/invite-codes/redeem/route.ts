import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { redeemInviteCode } from '@/lib/billing/invite-codes'

const redeemInviteCodeSchema = z.object({
  code: z.string().min(1),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
    })
  }

  const parsed = redeemInviteCodeSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_PAYLOAD_INVALID',
      field: 'code',
    })
  }

  const result = await redeemInviteCode({
    userId: authResult.session.user.id,
    code: parsed.data.code,
  })

  return NextResponse.json(result)
})
