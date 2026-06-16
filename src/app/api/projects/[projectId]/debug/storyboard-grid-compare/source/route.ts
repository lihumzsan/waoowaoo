import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { getStoryboardGridCompareSource, readEpisodeId } from '@/lib/storyboard/grid-compare-lab'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodeId = readEpisodeId(request.nextUrl.searchParams.get('episodeId'))
  const result = await getStoryboardGridCompareSource({
    projectId,
    episodeId,
  })

  return NextResponse.json(result)
})
