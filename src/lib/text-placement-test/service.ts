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
  type TextPlacementAssetKind,
  type TextPlacementAssetResult,
  type TextPlacementFinalImageResult,
  type TextPlacementRetryAssetRequest,
  type TextPlacementRetryFinalImageRequest,
  type TextPlacementShot,
  type TextPlacementTestProgressEvent,
  type TextPlacementTestRunRequest,
  type TextPlacementTestRunResult,
} from '@/lib/text-placement-test/types'
import type { Locale } from '@/i18n/routing'

const IMAGE_ASPECT_RATIO = '16:9'
const CHARACTER_ASPECT_RATIO = '3:4'
const POLL_TIMEOUT_MS = 4 * 60 * 1000
const POLL_INTERVAL_MS = 3000
const TEXT_PLACEMENT_REFERENCE_IMAGE_COUNT = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getAssetAspectRatio(asset: TextPlacementAssetKind): string {
  return asset === 'scene' ? IMAGE_ASPECT_RATIO : CHARACTER_ASPECT_RATIO
}

function getAssetKeyPrefix(asset: TextPlacementAssetKind): string {
  if (asset === 'scene') return 'text-placement-test-scene'
  if (asset === 'characterA') return 'text-placement-test-character-a'
  return 'text-placement-test-character-b'
}

function formatSettledErrors(input: {
  readonly scope: string
  readonly failures: readonly PromiseRejectedResult[]
}): string {
  const messages = input.failures
    .map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason))
    .join(' | ')
  return `${input.scope}:${input.failures.length}:${messages}`
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

async function generateAndPersistImageAsset(input: {
  readonly userId: string
  readonly imageModelKey: string
  readonly asset: TextPlacementAssetKind
  readonly prompt: string
  readonly aspectRatio: string
  readonly keyPrefix: string
  readonly capabilityOptions: ReturnType<typeof resolveModelCapabilityGenerationOptions>
  readonly onProgress?: (event: TextPlacementTestProgressEvent) => void | Promise<void>
}): Promise<{
  readonly imageUrl: string
  readonly storageKey: string
}> {
  const generated = await generateImage(input.userId, input.imageModelKey, input.prompt, {
    ...input.capabilityOptions,
    aspectRatio: input.aspectRatio,
  })
  const source = await resolveGeneratedImageSource(generated, input.userId)
  const image = await persistGeneratedImage({
    source,
    userId: input.userId,
    keyPrefix: input.keyPrefix,
  })
  await input.onProgress?.({
    type: 'asset',
    asset: input.asset,
    prompt: input.prompt,
    imageUrl: image.imageUrl,
    storageKey: image.storageKey,
  })
  return image
}

async function getImageCapabilityOptions(input: {
  readonly userId: string
  readonly imageModelKey: string
}): Promise<ReturnType<typeof resolveModelCapabilityGenerationOptions>> {
  const userConfig = await getUserModelConfig(input.userId)
  return resolveModelCapabilityGenerationOptions({
    modelType: 'image',
    modelKey: input.imageModelKey,
    capabilityDefaults: userConfig.capabilityDefaults,
  })
}

async function generateFinalShotImage(input: {
  readonly userId: string
  readonly imageModelKey: string
  readonly storyPrompt: string
  readonly shot: TextPlacementShot
  readonly locale: Locale
  readonly referenceImages: readonly string[]
  readonly capabilityOptions: ReturnType<typeof resolveModelCapabilityGenerationOptions>
  readonly onProgress?: (event: TextPlacementTestProgressEvent) => void | Promise<void>
  readonly completedFinalImageCount: () => number
  readonly totalFinalImageCount: number
}): Promise<TextPlacementFinalImageResult> {
  const prompt = buildTextPlacementFinalPrompt({
    storyPrompt: input.storyPrompt,
    shot: input.shot,
    locale: input.locale,
  })
  const generated = await generateImage(input.userId, input.imageModelKey, prompt, {
    referenceImages: [...input.referenceImages],
    ...input.capabilityOptions,
    aspectRatio: IMAGE_ASPECT_RATIO,
  })
  const source = await resolveGeneratedImageSource(generated, input.userId)
  const image = await persistGeneratedImage({
    source,
    userId: input.userId,
    keyPrefix: `text-placement-test-final-shot-${input.shot.shotNumber}`,
  })

  const finalImage = {
    shotNumber: input.shot.shotNumber,
    shotLabel: input.shot.shotLabel,
    prompt,
    imageUrl: image.imageUrl,
    storageKey: image.storageKey,
  }
  await input.onProgress?.({
    type: 'finalImage',
    image: finalImage,
    completedFinalImageCount: input.completedFinalImageCount(),
    totalFinalImageCount: input.totalFinalImageCount,
  })
  return finalImage
}

export async function runTextPlacementTest(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: TextPlacementTestRunRequest
  readonly onProgress?: (event: TextPlacementTestProgressEvent) => void | Promise<void>
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
  await input.onProgress?.({
    type: 'placementPlan',
    placementPlan,
    placementPrompt,
    placementRawText,
  })

  const capabilityOptions = await getImageCapabilityOptions({
    userId: input.userId,
    imageModelKey: input.request.imageModelKey,
  })

  const scenePrompt = buildTextPlacementScenePrompt(placementPlan, input.locale)
  const characterAPrompt = buildTextPlacementCharacterPrompt(placementPlan, input.locale, 'A')
  const characterBPrompt = buildTextPlacementCharacterPrompt(placementPlan, input.locale, 'B')
  await input.onProgress?.({
    type: 'assetPrompts',
    scenePrompt,
    characterAPrompt,
    characterBPrompt,
  })
  const assetResults = await Promise.allSettled([
    generateAndPersistImageAsset({
      userId: input.userId,
      imageModelKey: input.request.imageModelKey,
      asset: 'scene',
      prompt: scenePrompt,
      aspectRatio: getAssetAspectRatio('scene'),
      keyPrefix: getAssetKeyPrefix('scene'),
      capabilityOptions,
      onProgress: input.onProgress,
    }),
    generateAndPersistImageAsset({
      userId: input.userId,
      imageModelKey: input.request.imageModelKey,
      asset: 'characterA',
      prompt: characterAPrompt,
      aspectRatio: getAssetAspectRatio('characterA'),
      keyPrefix: getAssetKeyPrefix('characterA'),
      capabilityOptions,
      onProgress: input.onProgress,
    }),
    generateAndPersistImageAsset({
      userId: input.userId,
      imageModelKey: input.request.imageModelKey,
      asset: 'characterB',
      prompt: characterBPrompt,
      aspectRatio: getAssetAspectRatio('characterB'),
      keyPrefix: getAssetKeyPrefix('characterB'),
      capabilityOptions,
      onProgress: input.onProgress,
    }),
  ])
  const assetFailures = assetResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (assetFailures.length > 0) {
    throw new Error(formatSettledErrors({
      scope: 'TEXT_PLACEMENT_TEST_ASSETS_FAILED',
      failures: assetFailures,
    }))
  }
  const [sceneResult, characterAResult, characterBResult] = assetResults
  if (sceneResult.status !== 'fulfilled' || characterAResult.status !== 'fulfilled' || characterBResult.status !== 'fulfilled') {
    throw new Error('TEXT_PLACEMENT_TEST_ASSET_RESULT_INVALID')
  }
  const scene = sceneResult.value
  const characterA = characterAResult.value
  const characterB = characterBResult.value

  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([
    scene.imageUrl,
    characterA.imageUrl,
    characterB.imageUrl,
  ], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: { scope: 'text-placement-test.final' },
  })
  readReferenceNormalizationResult({
    normalized: referenceImages,
    issues: normalizationIssues,
    expectedCount: TEXT_PLACEMENT_REFERENCE_IMAGE_COUNT,
  })

  let completedFinalImageCount = 0
  const finalImageResults = await Promise.allSettled(placementPlan.shots.map((shot) => generateFinalShotImage({
    userId: input.userId,
    imageModelKey: input.request.imageModelKey,
    storyPrompt: input.request.storyPrompt,
    shot,
    locale: input.locale,
    referenceImages,
    capabilityOptions,
    onProgress: input.onProgress,
    completedFinalImageCount: () => {
      completedFinalImageCount += 1
      return completedFinalImageCount
    },
    totalFinalImageCount: placementPlan.shots.length,
  })))
  const finalImageFailures = finalImageResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (finalImageFailures.length > 0) {
    throw new Error(formatSettledErrors({
      scope: 'TEXT_PLACEMENT_TEST_FINAL_IMAGES_FAILED',
      failures: finalImageFailures,
    }))
  }
  const finalImages = finalImageResults.map((finalImageResult) => {
    if (finalImageResult.status !== 'fulfilled') {
      throw new Error('TEXT_PLACEMENT_TEST_FINAL_IMAGE_RESULT_INVALID')
    }
    return finalImageResult.value
  })

  const result: TextPlacementTestRunResult = {
    success: true,
    llmModelKey: input.request.llmModelKey,
    imageModelKey: input.request.imageModelKey,
    placementPlan,
    placementPrompt,
    placementRawText,
    scenePrompt,
    characterAPrompt,
    characterBPrompt,
    sceneImageUrl: scene.imageUrl,
    sceneStorageKey: scene.storageKey,
    characterAImageUrl: characterA.imageUrl,
    characterAStorageKey: characterA.storageKey,
    characterBImageUrl: characterB.imageUrl,
    characterBStorageKey: characterB.storageKey,
    finalImages,
  }
  await input.onProgress?.({
    type: 'complete',
    result,
  })
  return result
}

export async function retryTextPlacementAsset(input: {
  readonly userId: string
  readonly request: TextPlacementRetryAssetRequest
}): Promise<TextPlacementAssetResult> {
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'image',
    modelKey: input.request.imageModelKey,
  })
  const capabilityOptions = await getImageCapabilityOptions({
    userId: input.userId,
    imageModelKey: input.request.imageModelKey,
  })
  const image = await generateAndPersistImageAsset({
    userId: input.userId,
    imageModelKey: input.request.imageModelKey,
    asset: input.request.asset,
    prompt: input.request.prompt,
    aspectRatio: getAssetAspectRatio(input.request.asset),
    keyPrefix: getAssetKeyPrefix(input.request.asset),
    capabilityOptions,
  })
  return {
    asset: input.request.asset,
    prompt: input.request.prompt,
    imageUrl: image.imageUrl,
    storageKey: image.storageKey,
  }
}

export async function retryTextPlacementFinalImage(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: TextPlacementRetryFinalImageRequest
}): Promise<TextPlacementFinalImageResult> {
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'image',
    modelKey: input.request.imageModelKey,
  })
  const capabilityOptions = await getImageCapabilityOptions({
    userId: input.userId,
    imageModelKey: input.request.imageModelKey,
  })
  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([...input.request.referenceImages], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: { scope: 'text-placement-test.retry-final' },
  })
  readReferenceNormalizationResult({
    normalized: referenceImages,
    issues: normalizationIssues,
    expectedCount: TEXT_PLACEMENT_REFERENCE_IMAGE_COUNT,
  })
  return generateFinalShotImage({
    userId: input.userId,
    imageModelKey: input.request.imageModelKey,
    storyPrompt: input.request.storyPrompt,
    shot: input.request.shot,
    locale: input.locale,
    referenceImages,
    capabilityOptions,
    completedFinalImageCount: () => 1,
    totalFinalImageCount: 1,
  })
}
