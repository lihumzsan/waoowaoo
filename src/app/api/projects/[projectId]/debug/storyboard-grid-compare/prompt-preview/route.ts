import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { parseStoryboardGridCompareSubmitBody } from '@/lib/storyboard/grid-compare-lab'
import { buildStoryboardGridComparePromptPreview } from '@/lib/storyboard/grid-compare-prompt-preview'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = parseStoryboardGridCompareSubmitBody(await request.json().catch(() => ({})))
  const result = await buildStoryboardGridComparePromptPreview({
    projectId,
    userId: authResult.session.user.id,
    episodeId: body.episodeId,
    sourceGenerationSegmentId: body.sourceGenerationSegmentId,
    panelIds: body.panelIds,
    locale: body.locale,
    omittedFields: body.omittedFields,
  })

  return NextResponse.json(result)
})
