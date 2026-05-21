import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  generateProjectEditScript,
  readProjectEditScript,
  updateProjectEditScriptAssetRequirementDescription,
  updateProjectEditScriptVideoBlockPrompt,
} from '@/lib/edit-script/service'
import { arrangeProjectEditScriptVideoBlocks } from '@/lib/edit-script/video-block-arrangement'
import { mergeProjectEditScriptVideoBlocks } from '@/lib/edit-script/video-block-merge'
import {
  arrangeEditScriptVideoBlocksRequestSchema,
  createEditScriptRequestSchema,
  getEditScriptRequestSchema,
  mergeEditScriptVideoBlocksRequestSchema,
  updateEditScriptAssetRequirementDescriptionRequestSchema,
  updateEditScriptVideoBlockPromptRequestSchema,
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

  const editScript = await generateProjectEditScript({
    request,
    projectId,
    episodeId: parsed.data.episodeId,
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    screenplayId: parsed.data.screenplayId,
    videoRatio: parsed.data.videoRatio,
    artStyle: parsed.data.artStyle,
  })

  return NextResponse.json({ editScript })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = updateEditScriptVideoBlockPromptRequestSchema
    .or(updateEditScriptAssetRequirementDescriptionRequestSchema)
    .or(arrangeEditScriptVideoBlocksRequestSchema)
    .or(mergeEditScriptVideoBlocksRequestSchema)
    .safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS')
  }

  if ('operation' in parsed.data && parsed.data.operation === 'arrangeVideoBlocks') {
    const editScript = await arrangeProjectEditScriptVideoBlocks({
      projectId,
      episodeId: parsed.data.episodeId,
      editScriptId: parsed.data.editScriptId,
      blocks: parsed.data.blocks,
      userId: authResult.session.user.id,
      locale: resolveRequiredTaskLocale(request, body),
    })

    return NextResponse.json({ editScript })
  }

  if ('operation' in parsed.data && parsed.data.operation === 'mergeVideoBlocks') {
    const editScript = await mergeProjectEditScriptVideoBlocks({
      projectId,
      episodeId: parsed.data.episodeId,
      editScriptId: parsed.data.editScriptId,
      leftBlockIndex: parsed.data.leftBlockIndex,
      rightBlockIndex: parsed.data.rightBlockIndex,
      userId: authResult.session.user.id,
      locale: resolveRequiredTaskLocale(request, body),
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

  const editScript = await updateProjectEditScriptVideoBlockPrompt({
    projectId,
    episodeId: parsed.data.episodeId,
    editScriptId: parsed.data.editScriptId,
    blockIndex: parsed.data.blockIndex,
    prompt: parsed.data.prompt,
  })

  return NextResponse.json({ editScript })
})
