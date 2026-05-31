import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import {
  buildImageBillingPayloadFromUserConfig,
  getUserModelConfig,
} from '@/lib/config-service'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import {
  SCENE_REFERENCE_COMPARISON_TARGET_ID,
  SCENE_REFERENCE_TEST_PROJECT_ID,
  SCENE_REFERENCE_TEST_TARGET_ID,
  normalizeSceneReferenceLayouts,
} from './prompts'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} is required` })
  }
  return value.trim()
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 2
  return Math.min(4, Math.max(1, Math.floor(parsed)))
}

function readAspectRatio(value: unknown): string {
  const ratio = readOptionalString(value)
  return ratio || '16:9'
}

function imageModelRequired(model: string | null, code: string, message: string): string {
  if (!model) throw new ApiError('INVALID_PARAMS', { code, message })
  return model
}

async function submitImageTestTask(input: {
  readonly request: NextRequest
  readonly userId: string
  readonly taskType: typeof TASK_TYPE.SCENE_REFERENCE_TEST | typeof TASK_TYPE.SCENE_REFERENCE_COMPARISON_TEST
  readonly imageModel: string
  readonly targetId: string
  readonly payload: Record<string, unknown>
}) {
  const userModelConfig = await getUserModelConfig(input.userId)
  let billingPayload: Record<string, unknown>
  try {
    billingPayload = buildImageBillingPayloadFromUserConfig({
      userModelConfig,
      imageModel: input.imageModel,
      basePayload: input.payload,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }

  const locale = resolveRequiredTaskLocale(input.request, billingPayload)
  const payload = withTaskUiPayload(billingPayload, {
    intent: 'generate',
    hasOutputAtStart: false,
  })

  return await submitTask({
    requestId: input.request.headers.get('x-request-id'),
    userId: input.userId,
    locale,
    projectId: SCENE_REFERENCE_TEST_PROJECT_ID,
    type: input.taskType,
    targetType: input.taskType === TASK_TYPE.SCENE_REFERENCE_TEST
      ? 'SceneReferenceTest'
      : 'SceneReferenceComparisonTest',
    targetId: input.targetId,
    operationId: String(input.taskType),
    operationSource: 'standalone-ui',
    operationConfirmed: true,
    payload,
    billingInfo: buildDefaultTaskBillingInfo(input.taskType, payload),
  })
}

export async function submitSceneReferenceTestTask(input: {
  readonly request: NextRequest
  readonly userId: string
  readonly body: Record<string, unknown>
}) {
  const userModelConfig = await getUserModelConfig(input.userId)
  const imageModel = imageModelRequired(
    userModelConfig.locationModel,
    'USER_LOCATION_MODEL_REQUIRED',
    'User location image model is required before scene reference testing',
  )
  const sceneDescription = readRequiredString(input.body.sceneDescription, 'sceneDescription')
  const styleRequest = readOptionalString(input.body.styleRequest)
  const layouts = normalizeSceneReferenceLayouts(input.body.layouts)

  return await submitImageTestTask({
    request: input.request,
    userId: input.userId,
    taskType: TASK_TYPE.SCENE_REFERENCE_TEST,
    imageModel,
    targetId: SCENE_REFERENCE_TEST_TARGET_ID,
    payload: {
      sceneDescription,
      styleRequest,
      layouts,
      count: 1 + layouts.length,
    },
  })
}

export async function submitSceneReferenceComparisonTask(input: {
  readonly request: NextRequest
  readonly userId: string
  readonly body: Record<string, unknown>
}) {
  const userModelConfig = await getUserModelConfig(input.userId)
  const imageModel = imageModelRequired(
    userModelConfig.storyboardModel,
    'USER_STORYBOARD_MODEL_REQUIRED',
    'User storyboard image model is required before scene reference comparison testing',
  )
  const variants = Array.isArray(input.body.variants) ? input.body.variants : []
  if (variants.length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'variants is required' })
  }
  const pairCount = readCount(input.body.pairCount)

  return await submitImageTestTask({
    request: input.request,
    userId: input.userId,
    taskType: TASK_TYPE.SCENE_REFERENCE_COMPARISON_TEST,
    imageModel,
    targetId: SCENE_REFERENCE_COMPARISON_TARGET_ID,
    payload: {
      characterImageUrl: readRequiredString(input.body.characterImageUrl, 'characterImageUrl'),
      singleSceneImageUrl: readRequiredString(input.body.singleSceneImageUrl, 'singleSceneImageUrl'),
      storyboardPrompt: readRequiredString(input.body.storyboardPrompt, 'storyboardPrompt'),
      aspectRatio: readAspectRatio(input.body.aspectRatio),
      variants,
      pairCount,
      count: pairCount * variants.length * 2,
    },
  })
}
