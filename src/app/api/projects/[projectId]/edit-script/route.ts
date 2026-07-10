import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  readProjectEditScript,
  updateProjectEditScriptAssetRequirementDescription,
} from '@/lib/edit-script/service'
import { submitProjectEditScriptGenerationTask } from '@/lib/edit-script/task-submission'
import {
  createEditScriptRequestSchema,
  getEditScriptRequestSchema,
  updateEditScriptAssetRequirementDescriptionRequestSchema,
} from '@/lib/edit-script/types'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const parsed = getEditScriptRequestSchema.safeParse({
    episodeId: searchParams.get('episodeId'),
    chapterId: searchParams.get('chapterId') ?? undefined,
  })
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }

  const editScript = await readProjectEditScript({
    projectId,
    episodeId: parsed.data.episodeId,
    chapterId: parsed.data.chapterId,
  })
  return NextResponse.json({ editScript })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = createEditScriptRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, 'artStyle')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LEGACY_ART_STYLE_REMOVED',
      field: 'artStyle',
      message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
    })
  }

  const result = await submitProjectEditScriptGenerationTask({
    request,
    projectId,
    userId: authResult.session.user.id,
    episodeId: parsed.data.episodeId,
    chapterId: parsed.data.chapterId,
    videoRatio: parsed.data.videoRatio,
    source: 'project-ui',
    locale: resolveRequiredTaskLocale(request, body),
  })

  return NextResponse.json(result)
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = updateEditScriptAssetRequirementDescriptionRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }

  const editScript = await updateProjectEditScriptAssetRequirementDescription({
    projectId,
    episodeId: parsed.data.episodeId,
    chapterId: parsed.data.chapterId,
    editScriptId: parsed.data.editScriptId,
    requirementId: parsed.data.requirementId,
    description: parsed.data.description,
  })

  return NextResponse.json({ editScript })
})
