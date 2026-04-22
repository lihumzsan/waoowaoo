import { NextRequest, NextResponse } from 'next/server'
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
import { prisma } from '@/lib/prisma'

const DEFAULT_CANDIDATE_COUNT = 1

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
  const requestImageModel = typeof body?.imageModel === 'string' ? body.imageModel.trim() : ''

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: { id: true, imageModel: true },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const selectedImageModel = requestImageModel || panel.imageModel || projectModelConfig.storyboardModel || ''
  if (!selectedImageModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORYBOARD_MODEL_NOT_CONFIGURED'})
  }
  try {
    await resolveModelSelection(session.user.id, selectedImageModel, 'image')
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
    modelKey: selectedImageModel})
  const billingPayload = {
    ...body,
    candidateCount,
    imageModel: selectedImageModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {})}

  const hasOutputAtStart = await hasPanelImageOutput(panelId)

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
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
