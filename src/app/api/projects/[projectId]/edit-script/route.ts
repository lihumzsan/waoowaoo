import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_TYPE } from '@/lib/task/types'
import {
  readProjectEditScript,
  updateProjectEditScriptAssetRequirementDescription,
} from '@/lib/edit-script/service'
import {
  arrangeProjectEditScriptGenerationSegments,
  mergeProjectEditScriptGenerationSegments,
  updateProjectEditScriptGenerationSegmentContinuity,
} from '@/lib/edit-script/generation-segments'
import {
  arrangeEditScriptGenerationSegmentsRequestSchema,
  createEditScriptRequestSchema,
  getEditScriptRequestSchema,
  mergeEditScriptGenerationSegmentsRequestSchema,
  updateEditScriptAssetRequirementDescriptionRequestSchema,
  updateEditScriptGenerationSegmentContinuityRequestSchema,
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
  })
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }

  const editScript = await readProjectEditScript({
    projectId,
    episodeId: parsed.data.episodeId,
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

  const result = await submitOperationTask({
    request,
    projectId,
    userId: authResult.session.user.id,
    episodeId: parsed.data.episodeId,
    type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: parsed.data.episodeId,
    operationId: 'generate_edit_script',
    source: 'project-ui',
    confirmed: true,
    payload: {
      episodeId: parsed.data.episodeId,
      ...(parsed.data.screenplayId ? { screenplayId: parsed.data.screenplayId } : {}),
      ...(parsed.data.videoRatio ? { videoRatio: parsed.data.videoRatio } : {}),
      displayMode: 'detail',
    },
    dedupeKey: `edit_script_generate:${projectId}:${parsed.data.episodeId}`,
    billingInfo: null,
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
  const parsed = updateEditScriptGenerationSegmentContinuityRequestSchema
    .or(updateEditScriptAssetRequirementDescriptionRequestSchema)
    .or(arrangeEditScriptGenerationSegmentsRequestSchema)
    .or(mergeEditScriptGenerationSegmentsRequestSchema)
    .safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }

  if ('operation' in parsed.data && parsed.data.operation === 'arrangeGenerationSegments') {
    const editScript = await arrangeProjectEditScriptGenerationSegments({
      projectId,
      episodeId: parsed.data.episodeId,
      editScriptId: parsed.data.editScriptId,
      segments: parsed.data.segments,
    })

    return NextResponse.json({ editScript })
  }

  if ('operation' in parsed.data && parsed.data.operation === 'mergeGenerationSegments') {
    const editScript = await mergeProjectEditScriptGenerationSegments({
      projectId,
      episodeId: parsed.data.episodeId,
      editScriptId: parsed.data.editScriptId,
      leftSegmentIndex: parsed.data.leftSegmentIndex,
      rightSegmentIndex: parsed.data.rightSegmentIndex,
    })

    return NextResponse.json({ editScript })
  }

  if ('requirementId' in parsed.data) {
    const editScript = await updateProjectEditScriptAssetRequirementDescription({
      projectId,
      episodeId: parsed.data.episodeId,
      editScriptId: parsed.data.editScriptId,
      requirementId: parsed.data.requirementId,
      description: parsed.data.description,
    })

    return NextResponse.json({ editScript })
  }

  const editScript = await updateProjectEditScriptGenerationSegmentContinuity({
    projectId,
    episodeId: parsed.data.episodeId,
    editScriptId: parsed.data.editScriptId,
    segmentIndex: parsed.data.segmentIndex,
    continuity: parsed.data.continuity,
  })

  return NextResponse.json({ editScript })
})
