import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { readPaidBetaPaymentAccessState } from '@/lib/paid-beta/campaign'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const providerObjectId = request.nextUrl.searchParams.get('providerObjectId')?.trim()
  if (!providerObjectId || providerObjectId.length > 191) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAID_BETA_PROVIDER_OBJECT_ID_INVALID',
      field: 'providerObjectId',
    })
  }

  const state = await readPaidBetaPaymentAccessState(
    authResult.session.user.id,
    providerObjectId,
  )
  return NextResponse.json({ success: true, state })
})
