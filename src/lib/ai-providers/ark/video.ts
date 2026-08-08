import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import type { AiProviderVideoExecutionContext } from '@/lib/ai-providers/runtime-types'
import { fetchWithRetry } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { normalizeVideoReferenceImages } from '@/lib/video-generation/reference-images'
import { AppError } from '@/lib/errors/app-error'
import { throwArkSubmissionError } from './error'

export interface ArkVideoTaskRequest {
  model: string
  content: Array<{
    type: 'image_url' | 'video_url' | 'audio_url' | 'text' | 'draft_task'
    image_url?: { url: string }
    video_url?: { url: string }
    audio_url?: { url: string }
    text?: string
    role?: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'
    draft_task?: { id: string }
  }>
  resolution?: '480p' | '720p' | '1080p'
  ratio?: string
  duration?: number
  frames?: number
  seed?: number
  camera_fixed?: boolean
  watermark?: boolean
  return_last_frame?: boolean
  service_tier?: 'default' | 'flex'
  execution_expires_after?: number
  generate_audio?: boolean
  draft?: boolean
  tools?: Array<{ type: 'web_search' }>
}

export interface ArkVideoTaskResponse {
  id: string
  model: string
  status: 'processing' | 'queued' | 'running' | 'succeeded' | 'failed'
  content?:
    | {
        video_url?: string
        image_url?: string
        audio_url?: string
      }
    | Array<{
        type?: 'video_url' | 'image_url' | 'audio_url'
        video_url?: { url?: string }
        image_url?: { url?: string }
        audio_url?: { url?: string }
      }>
  usage?: {
    completion_tokens?: number
    total_tokens?: number
    tool_usage?: { web_search?: number }
  }
  error?: { code: string; message: string }
}

type ArkVideoContentItem = ArkVideoTaskRequest['content'][number]

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function appendArkReferenceImageContents(
  content: ArkVideoTaskRequest['content'],
  imageUrls: readonly string[],
) {
  const seen = new Set<string>()
  for (const imageUrl of imageUrls) {
    if (seen.has(imageUrl)) continue
    seen.add(imageUrl)
    const item: ArkVideoContentItem = {
      type: 'image_url',
      image_url: { url: imageUrl },
      role: 'reference_image',
    }
    content.push(item)
  }
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

type ArkSeedanceModelSpec = {
  durationMin: number
  durationMax: number
  supportsFirstLastFrame: boolean
  supportsGenerateAudio: boolean
  supportsDraft: boolean
  supportsFrames: boolean
  resolutionOptions: ReadonlyArray<'480p' | '720p' | '1080p'>
}

const ARK_SEEDANCE_MODEL_SPECS: Record<string, ArkSeedanceModelSpec> = {
  'doubao-seedance-1-0-pro-fast-251015': {
    durationMin: 2,
    durationMax: 12,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
    supportsDraft: false,
    supportsFrames: true,
    resolutionOptions: ['480p', '720p', '1080p'],
  },
  'doubao-seedance-1-0-pro-250528': {
    durationMin: 2,
    durationMax: 12,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: false,
    supportsDraft: false,
    supportsFrames: true,
    resolutionOptions: ['480p', '720p', '1080p'],
  },
  'doubao-seedance-1-0-lite-i2v-250428': {
    durationMin: 2,
    durationMax: 12,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: false,
    supportsDraft: false,
    supportsFrames: true,
    resolutionOptions: ['480p', '720p', '1080p'],
  },
  'doubao-seedance-1-5-pro-251215': {
    durationMin: 4,
    durationMax: 12,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    supportsDraft: true,
    supportsFrames: false,
    resolutionOptions: ['480p', '720p', '1080p'],
  },
  'doubao-seedance-2-0-260128': {
    durationMin: 4,
    durationMax: 15,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    supportsDraft: false,
    supportsFrames: false,
    resolutionOptions: ['480p', '720p'],
  },
  'doubao-seedance-2-0-fast-260128': {
    durationMin: 4,
    durationMax: 15,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    supportsDraft: false,
    supportsFrames: false,
    resolutionOptions: ['480p', '720p'],
  },
}

const ARK_VIDEO_ALLOWED_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])

type ArkVideoOptions = NonNullable<AiProviderVideoExecutionContext['options']> & {
  serviceTier?: 'default' | 'flex'
  executionExpiresAfter?: number
  returnLastFrame?: boolean
  draft?: boolean
  seed?: number
  cameraFixed?: boolean
  watermark?: boolean
  frames?: number
  referenceImages?: string[]
  referenceAudios?: string[]
  referenceVideos?: string[]
}

function assertAllowedArkVideoOptions(options: ArkVideoOptions) {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'resolution',
    'duration',
    'frames',
    'aspectRatio',
    'generateAudio',
    'lastFrameImageUrl',
    'serviceTier',
    'executionExpiresAfter',
    'returnLastFrame',
    'draft',
    'seed',
    'cameraFixed',
    'watermark',
    'prompt',
    'referenceImages',
    'referenceAudios',
    'referenceVideos',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function validateArkVideoTaskRequest(request: ArkVideoTaskRequest) {
  const allowedTopLevelKeys = new Set([
    'model',
    'content',
    'resolution',
    'ratio',
    'duration',
    'frames',
    'seed',
    'camera_fixed',
    'watermark',
    'return_last_frame',
    'service_tier',
    'execution_expires_after',
    'generate_audio',
    'draft',
    'tools',
  ])
  for (const key of Object.keys(request)) {
    if (!allowedTopLevelKeys.has(key)) throw new Error(`ARK_VIDEO_REQUEST_FIELD_UNSUPPORTED: ${key}`)
  }

  if (!isNonEmptyString(request.model)) throw new Error('ARK_VIDEO_REQUEST_INVALID: model is required')
  if (!Array.isArray(request.content) || request.content.length === 0) {
    throw new Error('ARK_VIDEO_REQUEST_INVALID: content must be a non-empty array')
  }

  const allowedRatios = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
  if (request.ratio !== undefined && !allowedRatios.has(request.ratio)) {
    throw new Error(`ARK_VIDEO_REQUEST_INVALID: ratio=${request.ratio}`)
  }

  if (
    request.resolution !== undefined &&
    request.resolution !== '480p' &&
    request.resolution !== '720p' &&
    request.resolution !== '1080p'
  ) {
    throw new Error(`ARK_VIDEO_REQUEST_INVALID: resolution=${request.resolution}`)
  }

  if (request.duration !== undefined) {
    if (!isInteger(request.duration)) throw new Error('ARK_VIDEO_REQUEST_INVALID: duration must be integer')
    if (request.duration !== -1 && (request.duration < 2 || request.duration > 15)) {
      throw new Error(`ARK_VIDEO_REQUEST_INVALID: duration=${request.duration}`)
    }
  }

  if (request.frames !== undefined) {
    if (!isInteger(request.frames)) throw new Error('ARK_VIDEO_REQUEST_INVALID: frames must be integer')
    if (request.frames < 29 || request.frames > 289 || (request.frames - 25) % 4 !== 0) {
      throw new Error(`ARK_VIDEO_REQUEST_INVALID: frames=${request.frames}`)
    }
  }

  if (request.seed !== undefined) {
    if (!isInteger(request.seed)) throw new Error('ARK_VIDEO_REQUEST_INVALID: seed must be integer')
    if (request.seed < -1 || request.seed > 4294967295) {
      throw new Error(`ARK_VIDEO_REQUEST_INVALID: seed=${request.seed}`)
    }
  }

  if (request.execution_expires_after !== undefined) {
    if (!isInteger(request.execution_expires_after)) {
      throw new Error('ARK_VIDEO_REQUEST_INVALID: execution_expires_after must be integer')
    }
    if (request.execution_expires_after < 3600 || request.execution_expires_after > 259200) {
      throw new Error(`ARK_VIDEO_REQUEST_INVALID: execution_expires_after=${request.execution_expires_after}`)
    }
  }

  if (request.service_tier !== undefined && request.service_tier !== 'default' && request.service_tier !== 'flex') {
    throw new Error(`ARK_VIDEO_REQUEST_INVALID: service_tier=${String(request.service_tier)}`)
  }
}

export async function arkCreateVideoTask(
  request: ArkVideoTaskRequest,
  options: { apiKey: string; baseUrl: string; timeoutMs?: number; logPrefix?: string },
): Promise<{ id: string; [key: string]: unknown }> {
  if (!options.apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'ark' })
  validateArkVideoTaskRequest(request)

  const { apiKey, baseUrl, timeoutMs, logPrefix = '[Ark Video]' } = options
  const url = `${baseUrl.replace(/\/+$/, '')}/contents/generations/tasks`

  _ulogInfo(`${logPrefix} 创建视频任务, 模型: ${request.model}`)
  let response: Response
  try {
    response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
      timeoutMs,
      scope: 'ark:video:create',
      fetchFn: fetchWithProviderProxy,
    })
  } catch (error: unknown) {
    throwArkSubmissionError(error)
  }

  const data = (await response.json()) as { id?: unknown; [key: string]: unknown }
  const taskId = typeof data.id === 'string' ? data.id : ''
  _ulogInfo(`${logPrefix} 视频任务创建成功, taskId: ${taskId}`)
  return { ...data, id: taskId }
}

export async function arkQueryVideoTask(
  taskId: string,
  options: { apiKey: string; baseUrl: string; timeoutMs?: number; logPrefix?: string },
): Promise<ArkVideoTaskResponse> {
  if (!options.apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'ark' })

  const { apiKey, baseUrl, timeoutMs } = options
  const url = `${baseUrl.replace(/\/+$/, '')}/contents/generations/tasks/${taskId}`

  const response = await fetchWithRetry(url, {
    operation: EXTERNAL_OPERATION.PROVIDER_POLL,
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs,
    scope: 'ark:video:query',
    fetchFn: fetchWithProviderProxy,
  })

  return (await response.json()) as ArkVideoTaskResponse
}

export async function executeArkVideoGeneration(input: AiProviderVideoExecutionContext) {
  const options: ArkVideoOptions = input.options ?? {}
  assertAllowedArkVideoOptions(options)

  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  if (!baseUrl) throw new Error('PROVIDER_BASE_URL_MISSING: ark (video)')
  const { prompt, ...providerOptions } = options

  const modelId = requireSelectedModelId(input.selection, 'ark:video')

  const isBatchMode = modelId.endsWith('-batch')
  const realModel = isBatchMode ? modelId.replace('-batch', '') : modelId
  const modelSpec = ARK_SEEDANCE_MODEL_SPECS[realModel]
  if (!modelSpec) {
    throw new Error(`ARK_VIDEO_MODEL_UNSUPPORTED: ${realModel}`)
  }

  const resolution = providerOptions.resolution
  const duration = providerOptions.duration
  const frames = providerOptions.frames
  const aspectRatio = providerOptions.aspectRatio
  const generateAudio = providerOptions.generateAudio
  const lastFrameImageUrl = providerOptions.lastFrameImageUrl
  const serviceTier = providerOptions.serviceTier
  const executionExpiresAfter = providerOptions.executionExpiresAfter
  const returnLastFrame = providerOptions.returnLastFrame
  const draft = providerOptions.draft
  const seed = providerOptions.seed
  const cameraFixed = providerOptions.cameraFixed
  const watermark = providerOptions.watermark

  if (resolution !== undefined && !modelSpec.resolutionOptions.includes(resolution as '480p' | '720p' | '1080p')) {
    throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=${resolution}`)
  }
  if (duration !== undefined) {
    if (!isInteger(duration)) {
      throw new Error('ARK_VIDEO_OPTION_INVALID: duration must be integer')
    }
    const durationOutOfRange = duration !== -1 && (duration < modelSpec.durationMin || duration > modelSpec.durationMax)
    if (durationOutOfRange) {
      throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${duration}`)
    }
    if (duration === -1 && realModel !== 'doubao-seedance-1-5-pro-251215') {
      throw new Error('ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=-1 only supported by Seedance 1.5 Pro')
    }
  }
  if (frames !== undefined) {
    if (!modelSpec.supportsFrames) {
      throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: frames for ${realModel}`)
    }
    if (!isInteger(frames)) {
      throw new Error('ARK_VIDEO_OPTION_INVALID: frames must be integer')
    }
    if (frames < 29 || frames > 289 || (frames - 25) % 4 !== 0) {
      throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: frames=${frames}`)
    }
  }
  if (aspectRatio !== undefined && !ARK_VIDEO_ALLOWED_RATIOS.has(aspectRatio)) {
    throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
  }
  if (lastFrameImageUrl && !modelSpec.supportsFirstLastFrame) {
    throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: lastFrameImageUrl for ${realModel}`)
  }
  if (generateAudio !== undefined && !modelSpec.supportsGenerateAudio) {
    throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: generateAudio for ${realModel}`)
  }
  if (serviceTier !== undefined && serviceTier !== 'default' && serviceTier !== 'flex') {
    throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: serviceTier=${serviceTier}`)
  }
  if (executionExpiresAfter !== undefined) {
    if (!isInteger(executionExpiresAfter)) {
      throw new Error('ARK_VIDEO_OPTION_INVALID: executionExpiresAfter must be integer')
    }
    if (executionExpiresAfter < 3600 || executionExpiresAfter > 259200) {
      throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: executionExpiresAfter=${executionExpiresAfter}`)
    }
  }
  if (seed !== undefined) {
    if (!isInteger(seed)) {
      throw new Error('ARK_VIDEO_OPTION_INVALID: seed must be integer')
    }
    if (seed < -1 || seed > 4294967295) {
      throw new Error(`ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: seed=${seed}`)
    }
  }
  if (draft === true) {
    if (!modelSpec.supportsDraft) {
      throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: draft for ${realModel}`)
    }
    if (resolution !== undefined && resolution !== '480p') {
      throw new Error('ARK_VIDEO_OPTION_INVALID: draft only supports 480p')
    }
    if (returnLastFrame === true) {
      throw new Error('ARK_VIDEO_OPTION_INVALID: returnLastFrame is not supported when draft=true')
    }
    if (isBatchMode || serviceTier === 'flex') {
      throw new Error('ARK_VIDEO_OPTION_INVALID: draft does not support flex service tier')
    }
  }

  const inputImageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : ''
  const referenceImageUrls = Array.isArray(input.options?.referenceImages)
    ? input.options.referenceImages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const referenceAudioUrls = Array.isArray(input.options?.referenceAudios)
    ? Array.from(new Set(input.options.referenceAudios.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )))
    : []
  const referenceVideoUrls = Array.isArray(input.options?.referenceVideos)
    ? Array.from(new Set(input.options.referenceVideos.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )))
    : []
  if (referenceImageUrls.length > 9) {
    throw new Error('ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: referenceImages>9')
  }
  if (referenceAudioUrls.length > 0) {
    if (referenceAudioUrls.length > 3) {
      throw new Error('ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: referenceAudios>3')
    }
    if (realModel !== 'doubao-seedance-2-0-260128' && realModel !== 'doubao-seedance-2-0-fast-260128') {
      throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: referenceAudios for ${realModel}`)
    }
  }
  if (referenceVideoUrls.length > 0) {
    if (referenceVideoUrls.length > 3) {
      throw new Error('ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: referenceVideos>3')
    }
    if (realModel !== 'doubao-seedance-2-0-260128' && realModel !== 'doubao-seedance-2-0-fast-260128') {
      throw new Error(`ARK_VIDEO_OPTION_UNSUPPORTED: referenceVideos for ${realModel}`)
    }
  }
  if (referenceImageUrls.length + referenceAudioUrls.length + referenceVideoUrls.length > 12) {
    throw new Error('ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: totalReferences>12')
  }
  if (referenceAudioUrls.length > 0 && referenceImageUrls.length === 0 && referenceVideoUrls.length === 0) {
    throw new Error('ARK_VIDEO_REFERENCE_AUDIO_REQUIRES_VISUAL')
  }
  const content: ArkVideoTaskRequest['content'] = []
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  if (trimmedPrompt) {
    content.push({ type: 'text', text: trimmedPrompt })
  }

  if (lastFrameImageUrl) {
    if (!inputImageUrl) throw new Error('ARK_VIDEO_LAST_FRAME_REQUIRES_FIRST_FRAME')
    if (referenceImageUrls.length > 0 || referenceAudioUrls.length > 0 || referenceVideoUrls.length > 0) {
      throw new Error('ARK_VIDEO_OPTION_UNSUPPORTED: references_with_lastFrameImageUrl')
    }
    for (const image of normalizeVideoReferenceImages([
      { url: inputImageUrl, role: 'first_frame', order: 1 },
      { url: lastFrameImageUrl, role: 'last_frame', order: 2 },
    ])) {
      const frameRole = image.role === 'last_frame' ? 'last_frame' : 'first_frame'
      content.push({
        type: 'image_url',
        image_url: { url: image.url },
        role: frameRole,
      })
    }
  } else if (inputImageUrl) {
    if (referenceImageUrls.length > 0 || referenceAudioUrls.length > 0 || referenceVideoUrls.length > 0) {
      throw new Error('ARK_VIDEO_OPTION_UNSUPPORTED: frame_with_references')
    }
    content.push({
      type: 'image_url',
      image_url: { url: inputImageUrl },
      role: 'first_frame',
    })
  } else {
    appendArkReferenceImageContents(content, normalizeVideoReferenceImages([
      ...referenceImageUrls.map((url, index) => ({ url, role: 'reference_image' as const, order: index + 1 })),
    ]).map((image) => image.url))
    for (const referenceAudioUrl of referenceAudioUrls) {
      content.push({
        type: 'audio_url',
        audio_url: { url: referenceAudioUrl },
        role: 'reference_audio',
      })
    }
    for (const referenceVideoUrl of referenceVideoUrls) {
      content.push({
        type: 'video_url',
        video_url: { url: referenceVideoUrl },
        role: 'reference_video',
      })
    }
  }

  const requestBody: ArkVideoTaskRequest = {
    model: realModel,
    content,
    ...(resolution === '480p' || resolution === '720p' || resolution === '1080p' ? { resolution } : {}),
    ...(aspectRatio ? { ratio: aspectRatio } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(typeof frames === 'number' ? { frames } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(typeof cameraFixed === 'boolean' ? { camera_fixed: cameraFixed } : {}),
    ...(typeof watermark === 'boolean' ? { watermark } : {}),
    ...(typeof returnLastFrame === 'boolean' ? { return_last_frame: returnLastFrame } : {}),
    ...(typeof draft === 'boolean' ? { draft } : {}),
    ...(serviceTier !== undefined ? { service_tier: serviceTier } : {}),
    ...(typeof executionExpiresAfter === 'number' ? { execution_expires_after: executionExpiresAfter } : {}),
    ...(generateAudio !== undefined ? { generate_audio: generateAudio } : {}),
  }

  if (isBatchMode) {
    requestBody.service_tier = 'flex'
    if (requestBody.execution_expires_after === undefined) {
      requestBody.execution_expires_after = 86400
    }
  }

  const taskData = await arkCreateVideoTask(requestBody, { apiKey, baseUrl, logPrefix: '[ARK Video]' })
  const taskId = taskData.id
  if (!taskId) {
    throw new Error('ARK_VIDEO_TASK_CREATE_INVALID_RESPONSE: missing task id')
  }

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `ARK:VIDEO:${taskId}`,
  }
}
