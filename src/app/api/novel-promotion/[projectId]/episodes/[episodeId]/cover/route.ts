import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, getRequestId } from '@/lib/api-errors'
import { submitEpisodeCoverTask } from '@/lib/novel-promotion/episode-cover/task'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const result = await submitEpisodeCoverTask({
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    projectId,
    episodeId,
    mode: 'manual',
    requestId: getRequestId(request),
  })

  return NextResponse.json(result)
})
