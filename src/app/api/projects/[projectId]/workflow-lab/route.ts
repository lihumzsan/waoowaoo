import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import {
  forkWorkflowLabEpisode,
  isWorkflowLabEnabled,
  listWorkflowLabEpisodes,
} from '@/lib/workflow-lab/service'

export const runtime = 'nodejs'

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodes = isWorkflowLabEnabled()
    ? await listWorkflowLabEpisodes({
      projectId,
      userId: authResult.session.user.id,
    })
    : []

  return NextResponse.json({
    enabled: isWorkflowLabEnabled(),
    episodes,
    currentEpisodeId: request.nextUrl.searchParams.get('episodeId')?.trim() || null,
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = readObject(await request.json().catch(() => ({})))
  const action = readTrimmedString(body.action)
  if (action !== 'forkEpisode') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WORKFLOW_LAB_ACTION_INVALID',
      field: 'action',
      message: 'workflow lab action is invalid',
    })
  }

  const sourceEpisodeId = readTrimmedString(body.sourceEpisodeId)
  if (!sourceEpisodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WORKFLOW_LAB_SOURCE_EPISODE_REQUIRED',
      field: 'sourceEpisodeId',
      message: 'sourceEpisodeId is required',
    })
  }

  const result = await forkWorkflowLabEpisode({
    projectId,
    userId: authResult.session.user.id,
    sourceEpisodeId,
    name: readTrimmedString(body.name) || null,
  })

  return NextResponse.json({
    success: true,
    result,
  })
})
