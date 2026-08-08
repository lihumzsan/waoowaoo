import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { userHasPaidBetaGroupAccess } from '@/lib/paid-beta/campaign'
import { readPaidBetaGroupQr } from '@/lib/paid-beta/group-qr'

export const runtime = 'nodejs'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const canJoin = await userHasPaidBetaGroupAccess(authResult.session.user.id)
  if (!canJoin) {
    throw new ApiError('FORBIDDEN', { code: 'PAID_BETA_GROUP_ACCESS_REQUIRED' })
  }

  return new NextResponse(await readPaidBetaGroupQr(), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': 'inline; filename="waoowaoo-paid-beta-group.png"',
    },
  })
})
