import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { confirmProjectEditStylePreview } from '@/lib/edit-script/service'
import { confirmEditStylePreviewRequestSchema } from '@/lib/edit-script/types'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = confirmEditStylePreviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }

  const stylePreview = await confirmProjectEditStylePreview({
    projectId,
    episodeId: parsed.data.episodeId,
    userId: authResult.session.user.id,
    stylePreviewId: parsed.data.stylePreviewId,
    aspectRatio: parsed.data.aspectRatio,
  })

  return NextResponse.json({ stylePreview })
})
