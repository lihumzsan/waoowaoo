import sharp from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { getUserModelConfig, resolveModelCapabilityGenerationOptions } from '@/lib/config-service'
import { chatCompletionWithVision, generateImage } from '@/lib/ai-exec/engine'
import { getCompletionContent } from '@/lib/ai-exec/llm-helpers'
import { pollAsyncTask } from '@/lib/ai-exec/async-poll'
import { normalizeReferenceImagesForGeneration, type OutboundImageNormalizationIssue } from '@/lib/media/outbound-image'
import { processMediaResult } from '@/lib/media-process'
import { getObjectBuffer, getSignedUrl } from '@/lib/storage'
import { getModelsByType } from '@/lib/user-api/runtime-config'
import { safeParseJsonObject } from '@/lib/json-repair'
import {
  buildCoordinateAnalysisPrompt,
  buildCoordinateCameraGenerationPrompt,
  buildCoordinateFloorPlanPrompt,
  buildCoordinateThreeViewPrompt,
} from '@/lib/coordinate-placement-test/prompt'
import {
  coordinatePlacementAnalysisSchema,
  type CoordinatePlacementAnalyzeRequest,
  type CoordinatePlacementAnalyzeResult,
  type CoordinatePlacementGenerateRequest,
  type CoordinatePlacementReferenceViewsRequest,
  type CoordinatePlacementReferenceViewsResult,
  type CoordinatePlacementTestResult,
} from '@/lib/coordinate-placement-test/types'
import type { Locale } from '@/i18n/routing'

const POLL_TIMEOUT_MS = 4 * 60 * 1000
const POLL_INTERVAL_MS = 3000
const THREE_VIEW_SHEET_ASPECT_RATIO = '16:9'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b > 0) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

function bufferFromDataUrl(source: string): Buffer {
  const marker = ';base64,'
  const markerIndex = source.indexOf(marker)
  if (!source.startsWith('data:') || markerIndex === -1) {
    throw new Error('COORDINATE_PLACEMENT_TEST_REFERENCE_DATA_URL_REQUIRED')
  }
  return Buffer.from(source.slice(markerIndex + marker.length), 'base64')
}

async function resolveImageAspectRatio(source: string): Promise<string> {
  const metadata = await sharp(bufferFromDataUrl(source)).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height) {
    throw new Error('COORDINATE_PLACEMENT_TEST_REFERENCE_DIMENSIONS_REQUIRED')
  }
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

async function assertUserSelectableModel(input: {
  readonly userId: string
  readonly type: 'llm' | 'image'
  readonly modelKey: string
}) {
  const models = await getModelsByType(input.userId, input.type)
  if (!models.some((model) => model.modelKey === input.modelKey)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'COORDINATE_PLACEMENT_TEST_MODEL_INVALID',
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
      code: 'REFERENCE_IMAGE_NORMALIZATION_FAILED',
      message: 'all coordinate placement reference images must normalize successfully',
      issues: params.issues,
    })
  }
}

async function resolveGeneratedImageSource(result: Awaited<ReturnType<typeof generateImage>>, userId: string): Promise<string> {
  if (!result.success) {
    throw new Error(result.error || 'COORDINATE_PLACEMENT_TEST_IMAGE_FAILED')
  }
  if (result.imageUrl && result.imageUrl.trim()) return result.imageUrl.trim()
  if (result.imageBase64 && result.imageBase64.trim()) return `data:image/png;base64,${result.imageBase64.trim()}`

  const externalId = result.externalId?.trim()
  if (!result.async || !externalId) {
    throw new Error('COORDINATE_PLACEMENT_TEST_EMPTY_IMAGE_RESPONSE')
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    const status = await pollAsyncTask(externalId, userId)
    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl || status.videoUrl
      if (!url) throw new Error(`COORDINATE_PLACEMENT_TEST_ASYNC_RESULT_EMPTY:${externalId}`)
      return url
    }
    if (status.status === 'failed') {
      throw new Error(status.error || `COORDINATE_PLACEMENT_TEST_ASYNC_FAILED:${externalId}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`COORDINATE_PLACEMENT_TEST_ASYNC_TIMEOUT:${externalId}`)
}

async function persistGeneratedImageAsDataUrl(input: {
  readonly source: string
  readonly userId: string
  readonly keyPrefix: string
}): Promise<{
  readonly storageKey: string
  readonly imageUrl: string
  readonly imageDataUrl: string
}> {
  const storageKey = await processMediaResult({
    source: input.source,
    type: 'image',
    keyPrefix: input.keyPrefix,
    targetId: input.userId,
  })
  const buffer = await getObjectBuffer(storageKey)
  return {
    storageKey,
    imageUrl: getSignedUrl(storageKey, 3600),
    imageDataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
  }
}

export async function generateCoordinateReferenceViews(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: CoordinatePlacementReferenceViewsRequest
}): Promise<CoordinatePlacementReferenceViewsResult> {
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'image',
    modelKey: input.request.imageModelKey,
  })

  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([
    input.request.sceneImage,
  ], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: { scope: 'coordinate-placement-test.reference-views' },
  })
  readReferenceNormalizationResult({
    normalized: referenceImages,
    issues: normalizationIssues,
    expectedCount: 1,
  })
  const sourceReference = referenceImages[0]
  if (!sourceReference) throw new Error('COORDINATE_PLACEMENT_TEST_SCENE_REFERENCE_REQUIRED')

  const userConfig = await getUserModelConfig(input.userId)
  const capabilityOptions = resolveModelCapabilityGenerationOptions({
    modelType: 'image',
    modelKey: input.request.imageModelKey,
    capabilityDefaults: userConfig.capabilityDefaults,
  })
  const sourceAspectRatio = await resolveImageAspectRatio(sourceReference)
  const floorPlanPrompt = buildCoordinateFloorPlanPrompt(input.request, input.locale)
  const floorPlanGenerated = await generateImage(input.userId, input.request.imageModelKey, floorPlanPrompt, {
    referenceImages: [sourceReference],
    ...capabilityOptions,
    aspectRatio: sourceAspectRatio,
  })
  const floorPlanSource = await resolveGeneratedImageSource(floorPlanGenerated, input.userId)
  const floorPlan = await persistGeneratedImageAsDataUrl({
    source: floorPlanSource,
    userId: input.userId,
    keyPrefix: 'coordinate-placement-test-floor-plan',
  })

  const threeViewPrompt = buildCoordinateThreeViewPrompt(input.request, input.locale)
  const threeViewGenerated = await generateImage(input.userId, input.request.imageModelKey, threeViewPrompt, {
    referenceImages: [sourceReference],
    ...capabilityOptions,
    aspectRatio: THREE_VIEW_SHEET_ASPECT_RATIO,
  })
  const threeViewSource = await resolveGeneratedImageSource(threeViewGenerated, input.userId)
  const threeView = await persistGeneratedImageAsDataUrl({
    source: threeViewSource,
    userId: input.userId,
    keyPrefix: 'coordinate-placement-test-three-view',
  })

  return {
    success: true,
    modelKey: input.request.imageModelKey,
    floorPlanImageUrl: floorPlan.imageUrl,
    floorPlanImageDataUrl: floorPlan.imageDataUrl,
    floorPlanStorageKey: floorPlan.storageKey,
    threeViewImageUrl: threeView.imageUrl,
    threeViewImageDataUrl: threeView.imageDataUrl,
    threeViewStorageKey: threeView.storageKey,
    floorPlanPrompt,
    threeViewPrompt,
  }
}

export async function analyzeCoordinatePlacement(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: CoordinatePlacementAnalyzeRequest
}): Promise<CoordinatePlacementAnalyzeResult> {
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'llm',
    modelKey: input.request.llmModelKey,
  })

  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([
    input.request.coordinateReferenceImage,
  ], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: {
      scope: 'coordinate-placement-test.analyze',
      referenceMode: input.request.referenceMode,
    },
  })
  readReferenceNormalizationResult({
    normalized: referenceImages,
    issues: normalizationIssues,
    expectedCount: 1,
  })

  const finalPrompt = buildCoordinateAnalysisPrompt(input.request, input.locale)
  const completion = await chatCompletionWithVision(
    input.userId,
    input.request.llmModelKey,
    finalPrompt,
    referenceImages,
    { temperature: 0.1 },
  )
  const rawText = getCompletionContent(completion)
  const analysis = coordinatePlacementAnalysisSchema.parse(safeParseJsonObject(rawText))

  return {
    success: true,
    modelKey: input.request.llmModelKey,
    finalPrompt,
    analysis,
    rawText,
  }
}

export async function runCoordinatePlacementTest(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: CoordinatePlacementGenerateRequest
}): Promise<CoordinatePlacementTestResult> {
  await assertUserSelectableModel({
    userId: input.userId,
    type: 'image',
    modelKey: input.request.imageModelKey,
  })

  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([
    input.request.cameraReferenceImage,
    input.request.threeViewReferenceImage,
    input.request.characterImage,
  ], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: {
      scope: 'coordinate-placement-test.generate',
      cameraFacing: input.request.analysis.cameraFacing,
    },
  })
  readReferenceNormalizationResult({
    normalized: referenceImages,
    issues: normalizationIssues,
    expectedCount: 3,
  })

  const userConfig = await getUserModelConfig(input.userId)
  const capabilityOptions = resolveModelCapabilityGenerationOptions({
    modelType: 'image',
    modelKey: input.request.imageModelKey,
    capabilityDefaults: userConfig.capabilityDefaults,
  })
  const cameraReferenceImage = referenceImages[0]
  if (!cameraReferenceImage) throw new Error('COORDINATE_PLACEMENT_TEST_CAMERA_REFERENCE_REQUIRED')
  const aspectRatio = await resolveImageAspectRatio(cameraReferenceImage)
  const finalPrompt = buildCoordinateCameraGenerationPrompt(input.request, input.locale)
  const generated = await generateImage(input.userId, input.request.imageModelKey, finalPrompt, {
    referenceImages,
    ...capabilityOptions,
    aspectRatio,
  })
  const source = await resolveGeneratedImageSource(generated, input.userId)
  const storageKey = await processMediaResult({
    source,
    type: 'image',
    keyPrefix: 'coordinate-placement-test',
    targetId: input.userId,
  })

  return {
    success: true,
    imageUrl: getSignedUrl(storageKey, 3600),
    storageKey,
    modelKey: input.request.imageModelKey,
    promptVariant: input.request.promptVariant,
    finalPrompt,
  }
}
