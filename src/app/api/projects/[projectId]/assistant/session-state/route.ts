import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import { getProjectAgentSessionSnapshot } from '@/lib/project-agent/session-state'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim() || null
  const locale = normalizeProjectAgentLocale(request.nextUrl.searchParams.get('locale'))
  const snapshot = await getProjectAgentSessionSnapshot({
    projectId,
    userId: authResult.session.user.id,
    episodeId,
    assistantId: 'workspace-command',
    locale,
  })

  return NextResponse.json({
    success: true,
    sessionState: snapshot.sessionState,
    eventWatermark: snapshot.eventWatermark,
  })
})
