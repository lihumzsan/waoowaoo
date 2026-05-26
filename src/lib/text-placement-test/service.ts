import { ApiError } from '@/lib/api-errors'
import { chatCompletion, generateImage } from '@/lib/ai-exec/engine'
import { getCompletionContent } from '@/lib/ai-exec/llm-helpers'
import { pollAsyncTask } from '@/lib/ai-exec/async-poll'
import { getUserModelConfig, resolveModelCapabilityGenerationOptions } from '@/lib/config-service'
import { safeParseJsonObject } from '@/lib/json-repair'
import { normalizeReferenceImagesForGeneration, type OutboundImageNormalizationIssue } from '@/lib/media/outbound-image'
import { processMediaResult } from '@/lib/media-process'
import { getSignedUrl } from '@/lib/storage'
import { getModelsByType } from '@/lib/user-api/runtime-config'
import {
  buildTextPlacementCharacterPrompt,
  buildTextPlacementFinalPrompt,
  buildTextPlacementPlanPrompt,
  buildTextPlacementScenePrompt,
} from '@/lib/text-placement-test/prompt'
import {
  textPlacementPlanSchema,
  type TextPlacementTestRunRequest,
  type TextPlacementTestRunResult,
} from '@/lib/text-placement-test/types'
import type { Locale } from '@/i18n/routing'

const IMAGE_ASPECT_RATIO = '16:9'
const CHARACTER_ASPECT_RATIO = '3:4'
const POLL_TIMEOUT_MS = 4 * 60 * 1000
const POLL_INTERVAL_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function assertUserSelectableModel(input: {
  readonly userId: string
  readonly type: 'llm' | 'image'
  readonly modelKey: string
}) {
  const models = await getModelsByType(input.userId, input.type)
  if (!models.some((model) => model.modelKey === input.modelKey)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TEXT_PLACEMENT_TEST_MODEL_INVALID',
      field: input.type === 'llm' ? 'llmModelKey' : 'imageModelKey',
      message: `${input.type} model is not available for current user`,
    })
  }
}

function readReferenceNormalizationResult(params: {
  readonly normalized: string[]
  readonly issues: OutboundImageNormalizationIssue[]
  readonly expectedCount: number
}) {
  if (params.issues.length > 0 || params.normalized.length !== params.expectedCount) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TEXT_PLACEMENT_TEST_REFERENCE_IMAGE_NORMALIZATION_FAILED',
      message: 'all text placement reference images must normalize successfully',
      issues: params.issues,
    })
  }
}

async function resolveGeneratedImageSource(result: Awaited<ReturnType<typeof generateImage>>, userId: string): Promise<string> {
  if (!result.success) {
    throw new Error(result.error || 'TEXT_PLACEMENT_TEST_IMAGE_FAILED')
  }
  if (result.imageUrl && result.imageUrl.trim()) return result.imageUrl.trim()
  if (result.imageBase64 && result.imageBase64.trim()) return `data:image/png;base64,${result.imageBase64.trim()}`

  const externalId = result.externalId?.trim()
  if (!result.async || !externalId) {
    throw new Error('TEXT_PLACEMENT_TEST_EMPTY_IMAGE_RESPONSE')
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    const status = await pollAsyncTask(externalId, userId)
    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl || status.videoUrl
      if (!url) throw new Error(`TEXT_PLACEMENT_TEST_ASYNC_RESULT_EMPTY:${externalId}`)
      return url
    }
    if (status.status === 'failed') {
      throw new Error(status.error || `TEXT_PLACEMENT_TEST_ASYNC_FAILED:${externalId}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`TEXT_PLACEMENT_TEST_ASYNC_TIMEOUT:${externalId}`)
}

async function persistGeneratedImage(input: {
  readonly source: string
  readonly userId: string
  readonly keyPrefix: string
}): Promise<{
  readonly storageKey: string
  readonly imageUrl: string
}> {
  const storageKey = await processMediaResult({
    source: input.source,
    type: 'image',
    keyPrefix: input.keyPrefix,
    targetId: input.userId,
  })
  return {
    storageKey,
    imageUrl: getSignedUrl(storageKey, 3600),
  }
}

export async function runTextPlacementTest(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: TextPlacementTestRunRequest
}): Promise<TextPlacementTestRunResult> {
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'llm',
    modelKey: input.request.llmModelKey,
  })
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'image',
    modelKey: input.request.imageModelKey,
  })

  const placementPrompt = buildTextPlacementPlanPrompt(input.request, input.locale)
  const completion = await chatCompletion(input.userId, input.request.llmModelKey, [
    {
      role: 'user',
      content: placementPrompt,
    },
  ], { temperature: 0.2 })
  const placementRawText = getCompletionContent(completion)
  const placementPlan = textPlacementPlanSchema.parse(safeParseJsonObject(placementRawText))

  const userConfig = await getUserModelConfig(input.userId)
  const capabilityOptions = resolveModelCapabilityGenerationOptions({
    modelType: 'image',
    modelKey: input.request.imageModelKey,
    capabilityDefaults: userConfig.capabilityDefaults,
  })

  const scenePrompt = buildTextPlacementScenePrompt(placementPlan, input.locale)
  const sceneGenerated = await generateImage(input.userId, input.request.imageModelKey, scenePrompt, {
    ...capabilityOptions,
    aspectRatio: IMAGE_ASPECT_RATIO,
  })
  const sceneSource = await resolveGeneratedImageSource(sceneGenerated, input.userId)
  const scene = await persistGeneratedImage({
    source: sceneSource,
    userId: input.userId,
    keyPrefix: 'text-placement-test-scene',
  })

  const characterPrompt = buildTextPlacementCharacterPrompt(placementPlan, input.locale)
  const characterGenerated = await generateImage(input.userId, input.request.imageModelKey, characterPrompt, {
    ...capabilityOptions,
    aspectRatio: CHARACTER_ASPECT_RATIO,
  })
  const characterSource = await resolveGeneratedImageSource(characterGenerated, input.userId)
  const character = await persistGeneratedImage({
    source: characterSource,
    userId: input.userId,
    keyPrefix: 'text-placement-test-character',
  })

  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([
    scene.imageUrl,
    character.imageUrl,
  ], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: { scope: 'text-placement-test.final' },
  })
  readReferenceNormalizationResult({
    normalized: referenceImages,
    issues: normalizationIssues,
    expectedCount: 2,
  })

  const finalPrompt = buildTextPlacementFinalPrompt({
    storyPrompt: input.request.storyPrompt,
    plan: placementPlan,
    locale: input.locale,
  })
  const finalGenerated = await generateImage(input.userId, input.request.imageModelKey, finalPrompt, {
    referenceImages,
    ...capabilityOptions,
    aspectRatio: IMAGE_ASPECT_RATIO,
  })
  const finalSource = await resolveGeneratedImageSource(finalGenerated, input.userId)
  const finalImage = await persistGeneratedImage({
    source: finalSource,
    userId: input.userId,
    keyPrefix: 'text-placement-test-final',
  })

  return {
    success: true,
    llmModelKey: input.request.llmModelKey,
    imageModelKey: input.request.imageModelKey,
    placementPlan,
    placementPrompt,
    placementRawText,
    scenePrompt,
    characterPrompt,
    finalPrompt,
    sceneImageUrl: scene.imageUrl,
    sceneStorageKey: scene.storageKey,
    characterImageUrl: character.imageUrl,
    characterStorageKey: character.storageKey,
    finalImageUrl: finalImage.imageUrl,
    finalStorageKey: finalImage.storageKey,
  }
}
