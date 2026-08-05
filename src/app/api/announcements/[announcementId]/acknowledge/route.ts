import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { acknowledgeAnnouncement } from '@/lib/announcements/service'

const acknowledgeSchema = z.object({ version: z.number().int().positive() }).strict()

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ announcementId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { announcementId } = await context.params
  if (!announcementId || announcementId.length > 96) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ANNOUNCEMENT_ID_INVALID',
      field: 'announcementId',
    })
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = acknowledgeSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ANNOUNCEMENT_VERSION_INVALID',
      field: 'version',
    })
  }
  const result = await acknowledgeAnnouncement(
    authResult.session.user.id,
    announcementId,
    parsed.data.version,
  )
  if (result === 'not_available') {
    throw new ApiError('NOT_FOUND', { code: 'ANNOUNCEMENT_NOT_AVAILABLE' })
  }
  return NextResponse.json({ success: true, acknowledged: true })
})
