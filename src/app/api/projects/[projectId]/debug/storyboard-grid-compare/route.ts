import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import {
  parseStoryboardGridCompareSubmitBody,
  submitStoryboardGridCompareRun,
} from '@/lib/storyboard/grid-compare-lab'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = parseStoryboardGridCompareSubmitBody(await request.json().catch(() => ({})))
  const result = await submitStoryboardGridCompareRun({
    request,
    projectId,
    userId: authResult.session.user.id,
    episodeId: body.episodeId,
    sourceGenerationSegmentId: body.sourceGenerationSegmentId,
    panelIds: body.panelIds,
    mode: body.mode,
    locale: body.locale,
    omittedFields: body.omittedFields,
    previousGridImageUrl: body.previousGridImageUrl,
  })

  return NextResponse.json(result)
})
