import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isCreativeResourceMediaType, isCreativeResourceStatus } from '@/lib/creative-resource/contracts'
import { listProjectCreativeResourceCards } from '@/lib/creative-resource/view-service'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const rawEpisodeId = request.nextUrl.searchParams.get('episodeId')
  const episodeId = rawEpisodeId === null ? undefined : rawEpisodeId.trim() || null
  const rawMediaType = request.nextUrl.searchParams.get('mediaType')
  if (rawMediaType !== null && !isCreativeResourceMediaType(rawMediaType)) {
    throw new ApiError('INVALID_PARAMS', { field: 'mediaType' })
  }
  const mediaType = rawMediaType !== null && isCreativeResourceMediaType(rawMediaType) ? rawMediaType : null
  const rawStatus = request.nextUrl.searchParams.get('status')
  if (rawStatus !== null && !isCreativeResourceStatus(rawStatus)) {
    throw new ApiError('INVALID_PARAMS', { field: 'status' })
  }
  const status = rawStatus !== null && isCreativeResourceStatus(rawStatus) ? rawStatus : null
  const schemaId = request.nextUrl.searchParams.get('schemaId')?.trim() || null
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true'
  const resources = await listProjectCreativeResourceCards({
    projectId,
    userId: auth.session.user.id,
    episodeId,
    mediaType,
    schemaId,
    status,
    includeArchived,
    limit: 200,
  })
  const projectResources = request.nextUrl.searchParams.get('includeProjectScope') === 'true' && episodeId
    ? await listProjectCreativeResourceCards({
        projectId,
        userId: auth.session.user.id,
        episodeId: null,
        mediaType,
        schemaId,
        status,
        includeArchived,
        limit: 200,
      })
    : []
  return NextResponse.json({ success: true, resources: [...projectResources, ...resources] })
})
