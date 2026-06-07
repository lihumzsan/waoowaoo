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
  SCENE_PROMPT_TEST_PROJECT_ID,
  SCENE_PROMPT_TEST_TARGET_ID,
} from './prompts'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} is required` })
  }
  return value.trim()
}

function imageModelRequired(model: string | null): string {
  if (!model) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'USER_LOCATION_MODEL_REQUIRED',
      message: 'User location image model is required before scene prompt testing',
    })
  }
  return model
}

export async function submitScenePromptTestTask(input: {
  readonly request: NextRequest
  readonly userId: string
  readonly body: Record<string, unknown>
}) {
  const userModelConfig = await getUserModelConfig(input.userId)
  const imageModel = imageModelRequired(userModelConfig.locationModel)
  const payload = {
    sceneInput: readRequiredString(input.body.sceneInput, 'sceneInput'),
    imageModel,
    count: 4,
  }
  let billingPayload: Record<string, unknown>
  try {
    billingPayload = buildImageBillingPayloadFromUserConfig({
      userModelConfig,
      imageModel,
      basePayload: payload,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }

  const locale = resolveRequiredTaskLocale(input.request, billingPayload)
  const taskPayload = withTaskUiPayload(billingPayload, {
    intent: 'generate',
    hasOutputAtStart: false,
  })

  return await submitTask({
    requestId: input.request.headers.get('x-request-id'),
    userId: input.userId,
    locale,
    projectId: SCENE_PROMPT_TEST_PROJECT_ID,
    type: TASK_TYPE.SCENE_PROMPT_TEST,
    targetType: 'ScenePromptTest',
    targetId: SCENE_PROMPT_TEST_TARGET_ID,
    operationId: String(TASK_TYPE.SCENE_PROMPT_TEST),
    operationSource: 'standalone-ui',
    operationConfirmed: true,
    payload: taskPayload,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.SCENE_PROMPT_TEST, taskPayload),
  })
}
