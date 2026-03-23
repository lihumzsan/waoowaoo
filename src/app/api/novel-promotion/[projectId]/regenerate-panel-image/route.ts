import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { hasPanelImageOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'

const DEFAULT_CANDIDATE_COUNT = 1

function buildResolvedSourceText(panel: {
  description: string | null
  srtSegment: string | null
  videoPrompt: string | null
  imagePrompt: string | null
} | null): string {
  if (!panel) return ''
  return [
    panel.description ? `scene_description: ${panel.description}` : '',
    panel.srtSegment ? `source_text: ${panel.srtSegment}` : '',
    panel.videoPrompt ? `video_prompt: ${panel.videoPrompt}` : '',
    panel.imagePrompt ? `image_prompt: ${panel.imagePrompt}` : '',
  ].filter((item) => item.trim().length > 0).join('\n')
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const panelId = body?.panelId
  const count = body?.count
  const candidateCount = Math.max(1, Math.min(4, Number(count ?? DEFAULT_CANDIDATE_COUNT)))
  const requestId = getRequestId(request)

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const logger = createScopedLogger({
    module: 'api.panel-image',
    action: 'regenerate_panel_image_submit',
    requestId,
    projectId,
    userId: session.user.id,
  })

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      panelIndex: true,
      panelNumber: true,
      description: true,
      srtSegment: true,
      videoPrompt: true,
      imagePrompt: true,
      location: true,
      characters: true,
    },
  })

  logger.event({
    level: 'INFO',
    audit: true,
    message: 'panel image submit snapshot',
    details: {
      panelId,
      candidateCount,
      panelSnapshot: panel,
      resolvedSourceText: buildResolvedSourceText(panel),
    },
  })

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  if (!projectModelConfig.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_NOT_CONFIGURED'})
  }
  try {
    await resolveModelSelection(session.user.id, projectModelConfig.storyboardModel, 'image')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storyboard image model is invalid'
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_INVALID',
      message})
  }

  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId,
    userId: session.user.id,
    modelType: 'image',
    modelKey: projectModelConfig.storyboardModel})
  const billingPayload = {
    ...body,
    candidateCount,
    imageModel: projectModelConfig.storyboardModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {})}

  const hasOutputAtStart = await hasPanelImageOutput(panelId)

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId,
    projectId,
    type: TASK_TYPE.IMAGE_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panelId,
    payload: withTaskUiPayload(billingPayload, {
      intent: 'regenerate',
      hasOutputAtStart}),
    dedupeKey: `image_panel:${panelId}:${candidateCount}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload)})

  return NextResponse.json(result)
})
