import { ApiError } from '@/lib/api-errors'
import { getUserModelConfig, resolveModelCapabilityGenerationOptions } from '@/lib/config-service'
import { generateImage } from '@/lib/ai-exec/engine'
import { pollAsyncTask } from '@/lib/ai-exec/async-poll'
import { normalizeReferenceImagesForGeneration, type OutboundImageNormalizationIssue } from '@/lib/media/outbound-image'
import { processMediaResult } from '@/lib/media-process'
import { getSignedUrl } from '@/lib/storage'
import { buildCoordinatePlacementPrompt } from '@/lib/coordinate-placement-test/prompt'
import type {
  CoordinatePlacementTestRequest,
  CoordinatePlacementTestResult,
} from '@/lib/coordinate-placement-test/types'
import type { Locale } from '@/i18n/routing'

const POLL_TIMEOUT_MS = 4 * 60 * 1000
const POLL_INTERVAL_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

export async function runCoordinatePlacementTest(input: {
  readonly userId: string
  readonly locale: Locale
  readonly request: CoordinatePlacementTestRequest
}): Promise<CoordinatePlacementTestResult> {
  const userConfig = await getUserModelConfig(input.userId)
  const editModel = userConfig.editModel
  if (!editModel) {
    throw new ApiError('MISSING_CONFIG', {
      code: 'EDIT_MODEL_REQUIRED',
      message: 'edit model is required for coordinate placement test',
    })
  }

  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const referenceImages = await normalizeReferenceImagesForGeneration([
    input.request.coordinateReferenceImage,
    input.request.characterImage,
  ], {
    onIssue: (issue) => normalizationIssues.push(issue),
    context: {
      scope: 'coordinate-placement-test',
      referenceMode: input.request.referenceMode,
    },
  })
  if (normalizationIssues.length > 0 || referenceImages.length !== 2) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'REFERENCE_IMAGE_NORMALIZATION_FAILED',
      message: 'all coordinate placement reference images must normalize successfully',
      issues: normalizationIssues,
    })
  }

  const capabilityOptions = resolveModelCapabilityGenerationOptions({
    modelType: 'image',
    modelKey: editModel,
    capabilityDefaults: userConfig.capabilityDefaults,
  })
  const finalPrompt = buildCoordinatePlacementPrompt(input.request, input.locale)
  const generated = await generateImage(input.userId, editModel, finalPrompt, {
    referenceImages,
    ...capabilityOptions,
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
    modelKey: editModel,
    finalPrompt,
  }
}
