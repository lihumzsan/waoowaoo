import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { hasPanelLipSyncOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import {
  getConnectedModelsByType,
  getProviderConfig,
  resolveModelSelection,
  resolveModelSelectionOrSingle,
} from '@/lib/api-config'

function isModelConfigError(code: string): boolean {
  return (
    code === 'MODEL_NOT_CONFIGURED'
    || code === 'MODEL_SELECTION_REQUIRED'
    || code === 'MODEL_NOT_FOUND'
    || code === 'PROVIDER_API_KEY_MISSING'
    || code === 'PROVIDER_NOT_FOUND'
  )
}

async function ensureLipSyncModelReady(userId: string, modelKey: string): Promise<string> {
  const selection = await resolveModelSelection(userId, modelKey, 'lipsync')
  await getProviderConfig(userId, selection.provider)
  return selection.modelKey
}

async function resolveLipSyncModelKey(
  userId: string,
  requestedLipSyncModel: string,
  preferredLipSyncModel: string,
): Promise<string> {
  if (requestedLipSyncModel) {
    return await ensureLipSyncModelReady(userId, requestedLipSyncModel)
  }

  if (preferredLipSyncModel) {
    try {
      return await ensureLipSyncModelReady(userId, preferredLipSyncModel)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const code = message.split(':', 1)[0] || ''
      if (!isModelConfigError(code)) throw error
    }
  }

  const connectedLipSyncModels = await getConnectedModelsByType(userId, 'lipsync')
  if (connectedLipSyncModels.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_NOT_CONFIGURED',
      field: 'lipSyncModel',
      message: '当前未配置可用的口型同步模型，请先在设置中心配置口型同步模型。',
    })
  }

  if (connectedLipSyncModels.length === 1) {
    return await resolveModelSelectionOrSingle(userId, null, 'lipsync').then((selection) => selection.modelKey)
  }

  throw new ApiError('INVALID_PARAMS', {
    code: 'MODEL_SELECTION_REQUIRED',
    field: 'lipSyncModel',
    message: '当前存在多个可用的口型同步模型，请先在设置中心选择默认口型同步模型。',
  })
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
  const storyboardId = body?.storyboardId
  const panelIndex = body?.panelIndex
  const voiceLineId = body?.voiceLineId
  const requestedLipSyncModel = typeof body?.lipSyncModel === 'string' ? body.lipSyncModel.trim() : ''

  if (!storyboardId || panelIndex === undefined || !voiceLineId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (requestedLipSyncModel && !parseModelKeyStrict(requestedLipSyncModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'lipSyncModel',
    })
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { lipSyncModel: true },
  })
  const preferredLipSyncModel = typeof pref?.lipSyncModel === 'string' ? pref.lipSyncModel.trim() : ''
  const resolvedLipSyncModel = await resolveLipSyncModelKey(
    session.user.id,
    requestedLipSyncModel,
    preferredLipSyncModel,
  )
  if (!parseModelKeyStrict(resolvedLipSyncModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'lipSyncModel',
    })
  }

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: { storyboardId, panelIndex: Number(panelIndex) },
    select: { id: true },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const payload = {
    ...body,
    lipSyncModel: resolvedLipSyncModel,
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.LIP_SYNC,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(payload, {
      hasOutputAtStart: await hasPanelLipSyncOutput(panel.id),
    }),
    dedupeKey: `lip_sync:${panel.id}:${voiceLineId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.LIP_SYNC, payload),
  })

  return NextResponse.json(result)
})
