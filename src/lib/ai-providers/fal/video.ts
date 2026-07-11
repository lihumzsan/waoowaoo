import { createScopedLogger } from '@/lib/logging/core'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderVideoExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { buildFalQueueUrl } from '@/lib/ai-providers/fal/base-url'
import { fetchWithRetry, RETRY_POLICY } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import {
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
} from '@/lib/ai-providers/fal/models'

type FalVideoOptions = NonNullable<AiProviderVideoExecutionContext['options']>

type FalWanVideoPayload = {
  image_url: string
  prompt: string
  resolution?: string
  duration?: string
}

type FalVeo31ImageVideoPayload = {
  image_url: string
  prompt: string
  aspect_ratio?: string
  duration?: string
  resolution?: string
  generate_audio: false
}

type FalVeo31ReferenceVideoPayload = {
  image_urls: string[]
  prompt: string
  aspect_ratio?: string
  duration?: string
  resolution?: string
  generate_audio: boolean
}

type FalKlingV25VideoPayload = {
  image_url: string
  prompt: string
  duration?: string
  negative_prompt: string
  cfg_scale: number
}

type FalKlingV3VideoPayload = {
  start_image_url: string
  prompt: string
  aspect_ratio?: string
  duration?: string
  end_image_url?: string
  generate_audio: false
  elements?: FalKlingV3ImageElement[]
}

type FalKlingV3ImageElement = {
  frontal_image_url: string
  reference_image_urls?: string[]
}

type FalKlingO3VideoPayload = {
  image_url: string
  prompt: string
  aspect_ratio?: string
  duration?: string
  end_image_url?: string
  generate_audio?: boolean
}

type FalHappyHorseVideoPayload = {
  image_url: string
  prompt?: string
  resolution?: string
  duration?: number
}

type FalHappyHorseReferenceVideoPayload = {
  prompt: string
  image_urls: string[]
  aspect_ratio?: string
  resolution?: string
  duration?: number
}

type FalSeedance2ImageVideoPayload = {
  prompt: string
  image_url: string
  end_image_url?: string
  resolution?: string
  duration?: string
  aspect_ratio?: string
  generate_audio?: boolean
}

type FalSeedance2ReferenceVideoPayload = {
  prompt: string
  image_urls: string[]
  resolution?: string
  duration?: string
  aspect_ratio?: string
  generate_audio?: boolean
}

type FalSeedance2TextVideoPayload = {
  prompt: string
  resolution?: string
  duration?: string
  aspect_ratio?: string
  generate_audio?: boolean
}

type FalVideoPayload =
  | FalWanVideoPayload
  | FalVeo31ImageVideoPayload
  | FalVeo31ReferenceVideoPayload
  | FalKlingV25VideoPayload
  | FalKlingV3VideoPayload
  | FalKlingO3VideoPayload
  | FalHappyHorseVideoPayload
  | FalHappyHorseReferenceVideoPayload
  | FalSeedance2ImageVideoPayload
  | FalSeedance2ReferenceVideoPayload
  | FalSeedance2TextVideoPayload

const FAL_VIDEO_ENDPOINTS: Record<string, string> = {
  'fal-wan25': 'wan/v2.6/image-to-video',
  'fal-veo31': 'fal-ai/veo3.1/fast/image-to-video',
  [FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID]: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  [FAL_SEEDANCE_2_VIDEO_MODEL_ID]: 'bytedance/seedance-2.0/image-to-video',
  [FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID]: 'bytedance/seedance-2.0/fast/image-to-video',
  'fal-ai/kling-video/v2.5-turbo/pro/image-to-video': 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  [FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID]: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  [FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID]: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  [FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID]: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  [FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID]: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
}

const FAL_HAPPY_HORSE_RESOLUTIONS = new Set(['720p', '1080p'])
const FAL_HAPPY_HORSE_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4'])
const FAL_SEEDANCE_2_RESOLUTIONS = new Set(['480p', '720p', '1080p'])
const FAL_SEEDANCE_2_FAST_RESOLUTIONS = new Set(['480p', '720p'])
const FAL_SEEDANCE_2_ASPECT_RATIOS = new Set(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])

function assertHappyHorseVideoOptions(options: FalVideoOptions) {
  if (options.resolution !== undefined && !FAL_HAPPY_HORSE_RESOLUTIONS.has(options.resolution)) {
    throw new Error(`FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=${options.resolution}`)
  }
  if (options.duration !== undefined) {
    if (!Number.isInteger(options.duration) || options.duration < 3 || options.duration > 15) {
      throw new Error(`FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${options.duration}`)
    }
  }
  if (options.aspectRatio !== undefined && !FAL_HAPPY_HORSE_ASPECT_RATIOS.has(options.aspectRatio)) {
    throw new Error(`FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=${options.aspectRatio}`)
  }
  if (options.generateAudio !== undefined) {
    throw new Error('FAL_VIDEO_OPTION_UNSUPPORTED: generateAudio')
  }
  if (options.lastFrameImageUrl !== undefined) {
    throw new Error('FAL_VIDEO_OPTION_UNSUPPORTED: lastFrameImageUrl')
  }
}

function buildHappyHorsePayload(input: {
  imageUrl: string
  options: FalVideoOptions
}): { endpoint: string; payload: FalHappyHorseVideoPayload | FalHappyHorseReferenceVideoPayload } {
  assertHappyHorseVideoOptions(input.options)
  const referenceImages = Array.isArray(input.options.referenceImages)
    ? input.options.referenceImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : []
  const uniqueReferences = Array.from(new Set([input.imageUrl, ...referenceImages]))

  if (input.options.aspectRatio || uniqueReferences.length > 1) {
    return {
      endpoint: 'alibaba/happy-horse/reference-to-video',
      payload: {
        prompt: input.options.prompt || '',
        image_urls: uniqueReferences.slice(0, 9),
        ...(input.options.aspectRatio ? { aspect_ratio: input.options.aspectRatio } : {}),
        ...(input.options.resolution ? { resolution: input.options.resolution } : {}),
        ...(typeof input.options.duration === 'number' ? { duration: input.options.duration } : {}),
      },
    }
  }

  return {
    endpoint: 'alibaba/happy-horse/image-to-video',
    payload: {
      image_url: input.imageUrl,
      ...(input.options.prompt ? { prompt: input.options.prompt } : {}),
      ...(input.options.resolution ? { resolution: input.options.resolution } : {}),
      ...(typeof input.options.duration === 'number' ? { duration: input.options.duration } : {}),
    },
  }
}

function assertSeedance2VideoOptions(options: FalVideoOptions, input: { fast: boolean; textOnly: boolean }) {
  const resolutions = input.fast ? FAL_SEEDANCE_2_FAST_RESOLUTIONS : FAL_SEEDANCE_2_RESOLUTIONS
  if (options.resolution !== undefined && !resolutions.has(options.resolution)) {
    throw new Error(`FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=${options.resolution}`)
  }
  if (!input.fast && input.textOnly && options.resolution === '1080p') {
    throw new Error('FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=1080p_for_text_to_video')
  }
  if (options.duration !== undefined) {
    if (!Number.isInteger(options.duration) || options.duration < 4 || options.duration > 15) {
      throw new Error(`FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${options.duration}`)
    }
  }
  if (options.aspectRatio !== undefined && !FAL_SEEDANCE_2_ASPECT_RATIOS.has(options.aspectRatio)) {
    throw new Error(`FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=${options.aspectRatio}`)
  }
}

function buildSeedance2Payload(input: {
  imageUrl: string
  options: FalVideoOptions
  fast: boolean
}): { endpoint: string; payload: FalSeedance2ImageVideoPayload | FalSeedance2ReferenceVideoPayload | FalSeedance2TextVideoPayload } {
  const prompt = input.options.prompt || ''
  const endpointPrefix = input.fast ? 'bytedance/seedance-2.0/fast' : 'bytedance/seedance-2.0'
  const sharedOptions = {
    ...(input.options.resolution ? { resolution: input.options.resolution } : {}),
    ...(typeof input.options.duration === 'number' ? { duration: String(input.options.duration) } : {}),
    ...(input.options.aspectRatio ? { aspect_ratio: input.options.aspectRatio } : {}),
    ...(typeof input.options.generateAudio === 'boolean' ? { generate_audio: input.options.generateAudio } : {}),
  }
  const referenceImages = Array.isArray(input.options.referenceImages)
    ? input.options.referenceImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : []
  const inputImageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : ''
  const uniqueReferences = Array.from(new Set([
    ...(inputImageUrl ? [inputImageUrl] : []),
    ...referenceImages,
  ]))
  assertSeedance2VideoOptions(input.options, { fast: input.fast, textOnly: uniqueReferences.length === 0 })

  if (input.options.lastFrameImageUrl) {
    if (!inputImageUrl) {
      throw new Error('FAL_VIDEO_OPTION_VALUE_UNSUPPORTED: lastFrameImageUrl_without_imageUrl')
    }
    return {
      endpoint: `${endpointPrefix}/image-to-video`,
      payload: {
        prompt,
        image_url: inputImageUrl,
        end_image_url: input.options.lastFrameImageUrl,
        ...sharedOptions,
      },
    }
  }

  if (uniqueReferences.length > 1) {
    return {
      endpoint: `${endpointPrefix}/reference-to-video`,
      payload: {
        prompt,
        image_urls: uniqueReferences.slice(0, 9),
        ...sharedOptions,
      },
    }
  }

  if (uniqueReferences.length === 0) {
    return {
      endpoint: `${endpointPrefix}/text-to-video`,
      payload: {
        prompt,
        ...sharedOptions,
      },
    }
  }

  const primaryReference = uniqueReferences[0]
  if (!primaryReference) {
    throw new Error('FAL_VIDEO_REFERENCE_IMAGE_REQUIRED')
  }

  return {
    endpoint: `${endpointPrefix}/image-to-video`,
    payload: {
      prompt,
      image_url: primaryReference,
      ...sharedOptions,
    },
  }
}

function assertAllowedFalVideoOptions(options: FalVideoOptions) {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'duration',
    'resolution',
    'aspectRatio',
    'prompt',
    'fps',
    'generateAudio',
    'lastFrameImageUrl',
    'referenceImages',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`FAL_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function collectUniqueReferenceImageUrls(input: { imageUrl: string; options: FalVideoOptions }): string[] {
  const referenceImages = Array.isArray(input.options.referenceImages)
    ? input.options.referenceImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : []
  const inputImageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : ''
  return Array.from(new Set([
    ...(inputImageUrl ? [inputImageUrl] : []),
    ...referenceImages,
  ]))
}

function buildKlingV3Elements(input: { imageUrl: string; options: FalVideoOptions }): FalKlingV3ImageElement[] | undefined {
  const uniqueReferences = collectUniqueReferenceImageUrls(input)
  const elementReferences = uniqueReferences.slice(1)
  if (elementReferences.length === 0) return undefined
  return elementReferences.map((frontalImageUrl) => ({
    frontal_image_url: frontalImageUrl,
  }))
}

function buildKlingO3Payload(input: {
  imageUrl: string
  options: FalVideoOptions
  aspectRatio?: string
  duration?: number
}): FalKlingO3VideoPayload {
  const uniqueReferences = collectUniqueReferenceImageUrls(input)
  if (uniqueReferences.length > 2) {
    throw new Error('FAL_VIDEO_OPTION_UNSUPPORTED: referenceImages>2')
  }
  const startImageUrl = uniqueReferences[0] ?? input.imageUrl
  if (!startImageUrl) {
    throw new Error('FAL_VIDEO_REFERENCE_IMAGE_REQUIRED')
  }
  if (uniqueReferences.length > 1 && input.options.lastFrameImageUrl) {
    throw new Error('FAL_VIDEO_OPTION_UNSUPPORTED: referenceImages_with_lastFrameImageUrl')
  }
  const endImageUrl = input.options.lastFrameImageUrl ?? uniqueReferences[1]
  return {
    image_url: startImageUrl,
    prompt: input.options.prompt || '',
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    ...(typeof input.duration === 'number' ? { duration: String(input.duration) } : {}),
    ...(endImageUrl ? { end_image_url: endImageUrl } : {}),
    ...(typeof input.options.generateAudio === 'boolean' ? { generate_audio: input.options.generateAudio } : {}),
  }
}

export async function executeFalVideoGeneration(input: AiProviderVideoExecutionContext): Promise<GenerateResult> {
  const { apiKey } = await getProviderConfig(input.userId, input.selection.provider)

  const options: FalVideoOptions = input.options ?? {}
  assertAllowedFalVideoOptions(options)

  const duration = options.duration
  const resolution = options.resolution
  const aspectRatio = options.aspectRatio
  const modelId = requireSelectedModelId(input.selection, 'fal:video')

  let endpoint = FAL_VIDEO_ENDPOINTS[modelId]
  if (!endpoint) {
    throw new Error(`FAL_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
  }

  let payload: FalVideoPayload
  switch (modelId) {
    case 'fal-wan25':
      payload = {
        image_url: input.imageUrl,
        prompt: input.options?.prompt || '',
        ...(resolution ? { resolution } : {}),
        ...(typeof duration === 'number' ? { duration: String(duration) } : {}),
      }
      break
    case 'fal-veo31':
      {
        const referenceImages = Array.isArray(options.referenceImages)
          ? options.referenceImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
          : []
        const inputImageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : ''
        const uniqueReferences = Array.from(new Set([
          ...(inputImageUrl ? [inputImageUrl] : []),
          ...referenceImages,
        ]))

        if (uniqueReferences.length > 1) {
          endpoint = 'fal-ai/veo3.1/fast/reference-to-video'
          payload = {
            image_urls: uniqueReferences,
            prompt: input.options?.prompt || '',
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(typeof duration === 'number' ? { duration: `${duration}s` } : {}),
            ...(resolution ? { resolution } : {}),
            generate_audio: typeof options.generateAudio === 'boolean' ? options.generateAudio : false,
          }
          break
        }

        payload = {
          image_url: input.imageUrl,
          prompt: input.options?.prompt || '',
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(typeof duration === 'number' ? { duration: `${duration}s` } : {}),
          ...(resolution ? { resolution } : {}),
          generate_audio: false,
        }
      }
      break
    case FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID:
      {
        const happyHorseRequest = buildHappyHorsePayload({
          imageUrl: input.imageUrl,
          options,
        })
        endpoint = happyHorseRequest.endpoint
        payload = happyHorseRequest.payload
      }
      break
    case FAL_SEEDANCE_2_VIDEO_MODEL_ID: {
      const seedance2Request = buildSeedance2Payload({
        imageUrl: input.imageUrl,
        options,
        fast: false,
      })
      endpoint = seedance2Request.endpoint
      payload = seedance2Request.payload
      break
    }
    case FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID: {
      const seedance2Request = buildSeedance2Payload({
        imageUrl: input.imageUrl,
        options,
        fast: true,
      })
      endpoint = seedance2Request.endpoint
      payload = seedance2Request.payload
      break
    }
    case 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video':
      payload = {
        image_url: input.imageUrl,
        prompt: input.options?.prompt || '',
        ...(typeof duration === 'number' ? { duration: String(duration) } : {}),
        negative_prompt: 'blur, distort, and low quality',
        cfg_scale: 0.5,
      }
      break
    case FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID:
    case FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID:
      payload = buildKlingO3Payload({
        imageUrl: input.imageUrl,
        options,
        aspectRatio,
        duration,
      })
      break
    case FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID:
    case FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID:
      {
        const elements = buildKlingV3Elements({ imageUrl: input.imageUrl, options })
        payload = {
          start_image_url: input.imageUrl,
          prompt: input.options?.prompt || '',
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(typeof duration === 'number' ? { duration: String(duration) } : {}),
          ...(options.lastFrameImageUrl ? { end_image_url: options.lastFrameImageUrl } : {}),
          ...(elements ? { elements } : {}),
          generate_audio: false,
        }
      }
      break
    default:
      throw new Error(`FAL_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
  }

  const logger = createScopedLogger({ module: 'worker.fal-video', action: 'fal_video_generate' })
  logger.info({ message: 'FAL video generation request', details: { modelId, endpoint } })

  const submitResponse = await fetchWithRetry(buildFalQueueUrl(endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(payload),
    policy: RETRY_POLICY.providerSubmit,
    cache: 'no-store',
    scope: `fal:video:submit:${endpoint}`,
    fetchFn: fetchWithProviderProxy,
  })

  const submitData = (await submitResponse.json()) as { request_id?: unknown }
  const requestId = typeof submitData.request_id === 'string' ? submitData.request_id : ''
  if (!requestId) {
    throw new Error('FAL 未返回 request_id')
  }
  logger.info({ message: 'FAL video task submitted', details: { requestId } })
  return {
    success: true,
    async: true,
    requestId,
    endpoint,
    externalId: `FAL:VIDEO:${endpoint}:${requestId}`,
  }
}
