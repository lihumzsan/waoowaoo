import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import type { SSEEvent } from '@/lib/task/types'

function readPositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function readEvents(value: unknown): SSEEvent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const events = (value as { events?: unknown }).events
  return Array.isArray(events) ? events.filter((event): event is SSEEvent => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false
    const record = event as Record<string, unknown>
    return typeof record.id === 'string'
      && typeof record.type === 'string'
      && typeof record.projectId === 'string'
      && typeof record.userId === 'string'
      && typeof record.ts === 'string'
  }) : []
}

export const GET = apiHandler(async (request: NextRequest) => {
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() ?? ''
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim() || null
  const lastEventId = request.nextUrl.searchParams.get('lastEventId')?.trim() || null
  const replayLimit = readPositiveInt(request.nextUrl.searchParams.get('replayLimit'), 500, 5000)
  const snapshotLimit = readPositiveInt(request.nextUrl.searchParams.get('snapshotLimit'), 500, 2000)

  const authResult = projectId === 'global-asset-hub'
    ? await requireUserAuth()
    : await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'get_sse_bootstrap',
    projectId,
    userId: authResult.session.user.id,
    input: {
      episodeId,
      lastEventId,
      replayLimit,
      snapshotLimit,
    },
    source: 'project-ui',
  })

  return NextResponse.json({
    success: true,
    events: readEvents(result),
  })
})
