import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { isAnnouncementPlacement } from '@/lib/announcements/registry'
import { readPendingAnnouncementViews } from '@/lib/announcements/service'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const placement = request.nextUrl.searchParams.get('placement')
  if (!isAnnouncementPlacement(placement)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ANNOUNCEMENT_PLACEMENT_INVALID',
      field: 'placement',
    })
  }
  const announcements = await readPendingAnnouncementViews(
    authResult.session.user.id,
    placement,
  )
  return NextResponse.json({ success: true, announcements })
})
