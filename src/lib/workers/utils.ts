import { type Job } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { withLogContext } from '@/lib/logging/context'
import { generateImage, generateVideo } from '@/lib/ai-exec/engine'
import { waitForAsyncProviderResult } from '@/lib/ai-exec/async-wait'
import { ProviderPermanentFailureError, ProviderTerminalFailureError } from '@/lib/ai-exec/provider-errors'
import { getSignedUrl } from '@/lib/storage'
import { processMediaResult } from '@/lib/media-process'
import {
  getProjectModelConfig,
  getUserModelConfig,
  resolveProjectModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { TaskTerminatedError } from '@/lib/task/errors'
import { markTaskProviderInvocationRetryableByExternalId } from '@/lib/task/provider-invocation'
import { clearTaskExternalId, isTaskActive, trySetTaskExternalId } from '@/lib/task/service'
import { type TaskJobData } from '@/lib/task/types'
import { AppError } from '@/lib/errors/app-error'
import { reportTaskProgress } from './shared'
import { prisma } from '@/lib/prisma'
import {
  resolveProviderVideoReferencePayload,
  type VideoReferenceImageInput,
} from '@/lib/video-generation/reference-images'

function summarizeImageGenerationOptions(options: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = options || {}
  const referenceImagesValue = (value as { referenceImages?: unknown }).referenceImages
  const referenceImageCount = Array.isArray(referenceImagesValue) ? referenceImagesValue.length : 0
  return {
    provider: typeof (value as { provider?: unknown }).provider === 'string' ? (value as { provider: string }).provider : undefined,
    aspectRatio: typeof (value as { aspectRatio?: unknown }).aspectRatio === 'string' ? (value as { aspectRatio: string }).aspectRatio : undefined,
    resolution: typeof (value as { resolution?: unknown }).resolution === 'string' ? (value as { resolution: string }).resolution : undefined,
    quality: typeof (value as { quality?: unknown }).quality === 'string' ? (value as { quality: string }).quality : undefined,
    size: typeof (value as { size?: unknown }).size === 'string' ? (value as { size: string }).size : undefined,
    referenceImageCount,
    optionKeys: Object.keys(value),
  }
}

function jsonStringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"<unserializable>"'
  }
}

/**
 * 查询 DB 中任务是否已有 externalId（服务重启后续接轮询用，避免重复提交外部 API）
 */
async function getTaskExistingExternalId(taskId: string): Promise<string | null> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { externalId: true },
    })
    const val = task?.externalId?.trim()
    return val || null
  } catch {
    return null
  }
}

function scopedWorkerUtilLogger(job: Job<TaskJobData>, action: string) {
  return createScopedLogger({
    module: 'worker.utils',
    action,
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
}

export function parseJsonArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function assertTaskActive(job: Job<TaskJobData>, stage: string) {
  const active = await isTaskActive(job.data.taskId)
  if (active) return
  throw new TaskTerminatedError(job.data.taskId, `Task terminated during ${stage}`)
}

function normalizeExternalId(result: {
  async?: boolean
  externalId?: string
  requestId?: string
  endpoint?: string
}, mediaType: 'IMAGE' | 'VIDEO') {
  if (!result.async) return null
  const externalId = typeof result.externalId === 'string' ? result.externalId.trim() : ''
  if (externalId) return externalId
  throw new Error(`ASYNC_EXTERNAL_ID_MISSING: async ${mediaType} task returned without standard externalId`)
}

export async function waitExternalResult(
  job: Job<TaskJobData>,
  externalId: string,
  userId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; progressStart?: number; progressEnd?: number },
) {
  const progressStart = opts?.progressStart ?? 40
  const progressEnd = opts?.progressEnd ?? 90
  const startAt = Date.now()
  const logger = scopedWorkerUtilLogger(job, 'worker.external.poll')

  logger.info({
    message: 'external poll started',
    details: {
      externalId,
      timeoutMs: opts?.timeoutMs ?? null,
      intervalMs: opts?.intervalMs ?? null,
    },
  })

  const externalIdPersisted = await trySetTaskExternalId(job.data.taskId, externalId)
  logger.info({
    message: 'external id persistence checked',
    details: {
      externalId,
      persisted: externalIdPersisted,
    },
  })

  try {
    const result = await waitForAsyncProviderResult({
      externalId,
      userId,
      timeoutMs: opts?.timeoutMs,
      intervalMs: opts?.intervalMs,
      beforePoll: async () => await assertTaskActive(job, 'polling_external'),
      onPending: async (elapsedRatio) => {
        const progress = progressStart + Math.floor((progressEnd - progressStart) * elapsedRatio)
        await reportTaskProgress(job, progress, { stage: 'polling_external', externalId })
        await assertTaskActive(job, 'polling_external_wait')
      },
    })
    logger.info({
      message: 'external poll completed',
      durationMs: Date.now() - startAt,
      details: { externalId },
    })
    return result
  } catch (error) {
    if (error instanceof ProviderTerminalFailureError) {
      const terminalError = new AppError('EXTERNAL_ERROR', error.message, {
        details: { externalId, externalStatus: 'failed' },
        cause: error,
      })
      logger.error({
        message: terminalError.message,
        errorCode: 'EXTERNAL_ERROR',
        retryable: true,
        durationMs: Date.now() - startAt,
        details: {
          externalId,
        },
      })
      await markTaskProviderInvocationRetryableByExternalId({
        taskId: job.data.taskId,
        externalId,
        error: terminalError,
      })
      await clearTaskExternalId(job.data.taskId)
      throw terminalError
    }
    if (error instanceof ProviderPermanentFailureError) {
      await clearTaskExternalId(job.data.taskId)
      throw new AppError('PROVIDER_SUBMISSION_REJECTED', error.message, {
        details: { externalId, externalStatus: 'failed' },
        cause: error,
      })
    }
    throw error
  }
}

export async function resolveImageSourceFromGeneration(
  job: Job<TaskJobData>,
  params: {
    userId: string
    modelId: string
    prompt: string
    options?: {
      referenceImages?: string[]
      aspectRatio?: string
      resolution?: string
      quality?: string
      size?: string
      provider?: string
    }
    /**
     * A durable identity for this exact provider submission. A Task may make
     * more than one independent image request, so callers that fan out must
     * supply a stable per-request key rather than sharing the default.
     */
    invocationKey?: string
    allowTaskExternalIdResume?: boolean
    pollProgress?: { start?: number; end?: number }
  },
): Promise<string> {
  const logger = scopedWorkerUtilLogger(job, 'worker.image.generate_source')
  const startedAt = Date.now()
  const invocationKey = params.invocationKey === undefined
    ? 'media:image:primary'
    : params.invocationKey.trim()
  if (!invocationKey) throw new Error('IMAGE_PROVIDER_INVOCATION_KEY_REQUIRED')
  const allowTaskExternalIdResume = params.allowTaskExternalIdResume !== false

  // 服务重启续接：若 DB 中已有 externalId，直接恢复轮询，不重新提交外部 API
  if (allowTaskExternalIdResume) {
    const resumeExternalId = await getTaskExistingExternalId(job.data.taskId)
    if (resumeExternalId) {
      logger.info({
        message: 'image source generation resumed from existing external id',
        details: { externalId: resumeExternalId },
      })
      const polled = await waitExternalResult(job, resumeExternalId, params.userId, {
        progressStart: params.pollProgress?.start ?? 40,
        progressEnd: params.pollProgress?.end ?? 92,
      })
      return polled.url
    }
  }

  logger.info({
    message: 'image source generation started',
    provider: params.options?.provider || undefined,
    details: {
      model: params.modelId,
    },
  })

  const runtimeSelections: Record<string, string | number | boolean> = {}
  if (typeof params.options?.resolution === 'string') {
    runtimeSelections.resolution = params.options.resolution
  }
  if (typeof params.options?.quality === 'string') {
    runtimeSelections.quality = params.options.quality
  }

  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId: job.data.projectId,
    userId: params.userId,
    modelType: 'image',
    modelKey: params.modelId,
    runtimeSelections,
  })

  logger.info({
    message: 'image source generation calling generateImage',
    details: {
      model: params.modelId,
      referenceImageCount: params.options?.referenceImages?.length ?? 0,
      capabilityOptions,
      optionKeys: Object.keys(params.options || {}),
    },
  })

  const finalOptions = {
    ...(params.options || {}),
    ...capabilityOptions,
  } as Record<string, unknown>

  let result: Awaited<ReturnType<typeof generateImage>>
  try {
    result = await withLogContext(
      { projectId: job.data.projectId, taskId: job.data.taskId, userId: params.userId },
      () => generateImage(params.userId, params.modelId, params.prompt, finalOptions, {
        key: invocationKey,
      }),
    )
  } catch (error) {
    const providerKey = typeof (finalOptions as { provider?: unknown }).provider === 'string'
      ? (finalOptions as { provider: string }).provider
      : (params.options?.provider || '')
    throw new Error(
      [
        'IMAGE_GENERATION_THROWN',
        `modelKey=${params.modelId}`,
        providerKey ? `providerKey=${providerKey}` : 'providerKey=<unset>',
        `options=${jsonStringifySafe(summarizeImageGenerationOptions(finalOptions))}`,
        `capabilityOptions=${jsonStringifySafe(capabilityOptions)}`,
        `cause=${error instanceof Error ? error.message : String(error)}`,
      ].join(' '),
      { cause: error },
    )
  }
  if (!result.success) {
    const providerKey = typeof (finalOptions as { provider?: unknown }).provider === 'string'
      ? (finalOptions as { provider: string }).provider
      : (params.options?.provider || '')
    throw new Error(
      [
        'IMAGE_GENERATION_FAILED',
        `modelKey=${params.modelId}`,
        providerKey ? `providerKey=${providerKey}` : 'providerKey=<unset>',
        `options=${jsonStringifySafe(summarizeImageGenerationOptions(finalOptions))}`,
        `capabilityOptions=${jsonStringifySafe(capabilityOptions)}`,
        `error=${result.error || '<empty>'}`,
      ].join(' '),
    )
  }

  if (result.imageUrl) {
    logger.info({
      message: 'image source generation completed',
      provider: params.options?.provider || undefined,
      durationMs: Date.now() - startedAt,
    })
    return result.imageUrl
  }
  if (result.imageBase64) {
    logger.info({
      message: 'image source generation completed (base64)',
      provider: params.options?.provider || undefined,
      durationMs: Date.now() - startedAt,
    })
    return `data:image/png;base64,${result.imageBase64}`
  }

  const externalId = normalizeExternalId(result, 'IMAGE')
  if (!externalId) {
    throw new Error('Image generation returned no image and no external id')
  }

  const polled = await waitExternalResult(job, externalId, params.userId, {
    progressStart: params.pollProgress?.start ?? 40,
    progressEnd: params.pollProgress?.end ?? 92,
  })
  logger.info({
    message: 'image source generation completed (async)',
    provider: params.options?.provider || undefined,
    durationMs: Date.now() - startedAt,
    details: {
      externalId,
    },
  })
  return polled.url
}

/**
 * 多图版本：一次生成调用返回所有图片 URL 数组。
 *
 * - 接口返回多张（result.imageUrls）→ 返回完整列表
 * - 接口只返回单张（result.imageUrl / result.imageBase64）→ 封装成 [url] 保持接口一致
 * - 异步任务：轮询结果只有一个 URL，封装成 [url]
 *
 * 现有代码请继续使用 resolveImageSourceFromGeneration（取第一张），
 * 只有需要利用多图结果时才调用此函数。
 */
export async function resolveImageSourcesFromGeneration(
  job: Job<TaskJobData>,
  params: {
    userId: string
    modelId: string
    prompt: string
    options?: {
      referenceImages?: string[]
      aspectRatio?: string
      resolution?: string
      quality?: string
      size?: string
      provider?: string
    }
    allowTaskExternalIdResume?: boolean
    pollProgress?: { start?: number; end?: number }
  },
): Promise<string[]> {
  const logger = scopedWorkerUtilLogger(job, 'worker.image.generate_sources')
  const startedAt = Date.now()
  const allowTaskExternalIdResume = params.allowTaskExternalIdResume !== false

  // 服务重启续接：若 DB 中已有 externalId，直接恢复轮询（异步只有一张）
  if (allowTaskExternalIdResume) {
    const resumeExternalId = await getTaskExistingExternalId(job.data.taskId)
    if (resumeExternalId) {
      logger.info({
        message: 'image sources generation resumed from existing external id',
        details: { externalId: resumeExternalId },
      })
      const polled = await waitExternalResult(job, resumeExternalId, params.userId, {
        progressStart: params.pollProgress?.start ?? 40,
        progressEnd: params.pollProgress?.end ?? 92,
      })
      return [polled.url]
    }
  }

  logger.info({
    message: 'image sources generation started',
    provider: params.options?.provider || undefined,
    details: { model: params.modelId },
  })

  const runtimeSelections: Record<string, string | number | boolean> = {}
  if (typeof params.options?.resolution === 'string') {
    runtimeSelections.resolution = params.options.resolution
  }
  if (typeof params.options?.quality === 'string') {
    runtimeSelections.quality = params.options.quality
  }

  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId: job.data.projectId,
    userId: params.userId,
    modelType: 'image',
    modelKey: params.modelId,
    runtimeSelections,
  })

  const finalOptions = {
    ...(params.options || {}),
    ...capabilityOptions,
  } as Record<string, unknown>

  let result: Awaited<ReturnType<typeof generateImage>>
  try {
    result = await withLogContext(
      { projectId: job.data.projectId, taskId: job.data.taskId, userId: params.userId },
      () => generateImage(params.userId, params.modelId, params.prompt, finalOptions, {
        key: 'media:image:sources',
      }),
    )
  } catch (error) {
    const providerKey = typeof (finalOptions as { provider?: unknown }).provider === 'string'
      ? (finalOptions as { provider: string }).provider
      : (params.options?.provider || '')
    throw new Error(
      [
        'IMAGE_GENERATION_THROWN',
        `modelKey=${params.modelId}`,
        providerKey ? `providerKey=${providerKey}` : 'providerKey=<unset>',
        `options=${jsonStringifySafe(summarizeImageGenerationOptions(finalOptions))}`,
        `capabilityOptions=${jsonStringifySafe(capabilityOptions)}`,
        `cause=${error instanceof Error ? error.message : String(error)}`,
      ].join(' '),
      { cause: error },
    )
  }
  if (!result.success) {
    const providerKey = typeof (finalOptions as { provider?: unknown }).provider === 'string'
      ? (finalOptions as { provider: string }).provider
      : (params.options?.provider || '')
    throw new Error(
      [
        'IMAGE_GENERATION_FAILED',
        `modelKey=${params.modelId}`,
        providerKey ? `providerKey=${providerKey}` : 'providerKey=<unset>',
        `options=${jsonStringifySafe(summarizeImageGenerationOptions(finalOptions))}`,
        `capabilityOptions=${jsonStringifySafe(capabilityOptions)}`,
        `error=${result.error || '<empty>'}`,
      ].join(' '),
    )
  }

  // 优先使用多图列表
  if (result.imageUrls && result.imageUrls.length > 0) {
    logger.info({
      message: 'image sources generation completed (multi-image)',
      provider: params.options?.provider || undefined,
      durationMs: Date.now() - startedAt,
      details: { count: result.imageUrls.length },
    })
    return result.imageUrls
  }

  if (result.imageUrl) {
    logger.info({
      message: 'image sources generation completed (single url)',
      provider: params.options?.provider || undefined,
      durationMs: Date.now() - startedAt,
    })
    return [result.imageUrl]
  }

  if (result.imageBase64) {
    logger.info({
      message: 'image sources generation completed (base64)',
      provider: params.options?.provider || undefined,
      durationMs: Date.now() - startedAt,
    })
    return [`data:image/png;base64,${result.imageBase64}`]
  }

  const externalId = normalizeExternalId(result, 'IMAGE')
  if (!externalId) {
    throw new Error('Image generation returned no image and no external id')
  }

  const polled = await waitExternalResult(job, externalId, params.userId, {
    progressStart: params.pollProgress?.start ?? 40,
    progressEnd: params.pollProgress?.end ?? 92,
  })
  logger.info({
    message: 'image sources generation completed (async)',
    provider: params.options?.provider || undefined,
    durationMs: Date.now() - startedAt,
    details: { externalId },
  })
  return [polled.url]
}

export async function resolveVideoSourceFromGeneration(
  job: Job<TaskJobData>,
  params: {
    userId: string
    modelId: string
    imageUrl?: string
    referenceImages?: readonly VideoReferenceImageInput[]
    options?: {
      prompt?: string
      duration?: number
      fps?: number
      resolution?: string
      aspectRatio?: string
      generateAudio?: boolean
      lastFrameImageUrl?: string
      generationMode?: 'normal' | 'firstlastframe'
      referenceImages?: string[]
      [key: string]: string | number | boolean | string[] | undefined
    }
    pollProgress?: { start?: number; end?: number }
  },
): Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }> {
  const logger = scopedWorkerUtilLogger(job, 'worker.video.generate_source')
  const startedAt = Date.now()

  // 服务重启续接：若 DB 中已有 externalId，直接恢复轮询，不重新提交外部 API（避免重复扣费）
  const resumeExternalId = await getTaskExistingExternalId(job.data.taskId)
  if (resumeExternalId) {
    logger.info({
      message: 'video source generation resumed from existing external id',
      details: { externalId: resumeExternalId, model: params.modelId },
    })
    const polled = await waitExternalResult(job, resumeExternalId, params.userId, {
      progressStart: params.pollProgress?.start ?? 45,
      progressEnd: params.pollProgress?.end ?? 94,
    })
    logger.info({
      message: 'video source generation completed (resumed)',
      durationMs: Date.now() - startedAt,
      details: { externalId: resumeExternalId },
    })
    return {
      url: polled.url,
      ...(typeof polled.actualVideoTokens === 'number' ? { actualVideoTokens: polled.actualVideoTokens } : {}),
      ...(polled.downloadHeaders ? { downloadHeaders: polled.downloadHeaders } : {}),
    }
  }

  logger.info({
    message: 'video source generation started',
    details: {
      model: params.modelId,
    },
  })

  const runtimeSelections: Record<string, string | number | boolean> = {}
  if (typeof params.options?.duration === 'number') {
    runtimeSelections.duration = params.options.duration
  }
  if (typeof params.options?.resolution === 'string') {
    runtimeSelections.resolution = params.options.resolution
  }
  if (
    params.options?.generationMode === 'normal'
    || params.options?.generationMode === 'firstlastframe'
  ) {
    runtimeSelections.generationMode = params.options.generationMode
  }
  if (typeof params.options?.generateAudio === 'boolean') {
    runtimeSelections.generateAudio = params.options.generateAudio
  }

  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId: job.data.projectId,
    userId: params.userId,
    modelType: 'video',
    modelKey: params.modelId,
    runtimeSelections,
  })

  const providerCapabilityOptions: Record<string, string | number | boolean> = { ...capabilityOptions }
  delete providerCapabilityOptions.generationMode
  const providerReferencePayload = resolveProviderVideoReferencePayload({
    referenceImages: params.referenceImages,
    imageUrl: params.imageUrl,
    legacyReferenceImages: params.options?.referenceImages,
    legacyLastFrameImageUrl: params.options?.lastFrameImageUrl,
  })
  const providerRequestOptions: Record<string, string | number | boolean | string[]> = {}
  for (const [key, value] of Object.entries(params.options || {})) {
    if (
      key === 'generationMode'
      || key === 'referenceImages'
      || key === 'lastFrameImageUrl'
      || value === undefined
    ) continue
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      providerRequestOptions[key] = value
    }
  }

  const result = await withLogContext(
    { projectId: job.data.projectId, taskId: job.data.taskId, userId: params.userId },
    () => generateVideo(
      params.userId,
      params.modelId,
      providerReferencePayload.imageUrl,
      {
        ...providerRequestOptions,
        ...providerReferencePayload.options,
        ...providerCapabilityOptions,
      },
      { key: 'media:video:primary' },
    ),
  )
  if (!result.success) {
    throw new Error(result.error || 'Video generation failed')
  }

  if (result.videoUrl) {
    logger.info({
      message: 'video source generation completed',
      durationMs: Date.now() - startedAt,
    })
    return { url: result.videoUrl }
  }

  const externalId = normalizeExternalId(result, 'VIDEO')
  if (!externalId) {
    throw new Error('Video generation returned no video and no external id')
  }

  const polled = await waitExternalResult(job, externalId, params.userId, {
    progressStart: params.pollProgress?.start ?? 45,
    progressEnd: params.pollProgress?.end ?? 94,
  })
  logger.info({
    message: 'video source generation completed (async)',
    durationMs: Date.now() - startedAt,
    details: {
      externalId,
    },
  })
  return {
    url: polled.url,
    ...(typeof polled.actualVideoTokens === 'number' ? { actualVideoTokens: polled.actualVideoTokens } : {}),
    ...(polled.downloadHeaders ? { downloadHeaders: polled.downloadHeaders } : {}),
  }
}

export async function uploadImageSourceToCos(
  source: string | Buffer,
  keyPrefix: string,
  targetId: string,
  taskArtifact?: { taskId: string; artifact: string },
) {
  return await processMediaResult({
    source,
    type: 'image',
    keyPrefix,
    targetId,
    taskArtifact,
  })
}

export async function uploadVideoSourceToCos(
  source: string | Buffer,
  keyPrefix: string,
  targetId: string,
  downloadHeaders?: Record<string, string>,
  taskArtifact?: { taskId: string; artifact: string },
) {
  return await processMediaResult({
    source,
    type: 'video',
    keyPrefix,
    targetId,
    downloadHeaders,
    taskArtifact,
  })
}

export async function uploadAudioSourceToCos(
  source: string | Buffer,
  keyPrefix: string,
  targetId: string,
  taskArtifact?: { taskId: string; artifact: string },
) {
  return await processMediaResult({
    source,
    type: 'audio',
    keyPrefix,
    targetId,
    taskArtifact,
  })
}

export function toSignedUrlIfCos(keyOrUrl: string | null | undefined, ttlSeconds = 3600) {
  if (!keyOrUrl) return null
  return keyOrUrl.startsWith('images/') || keyOrUrl.startsWith('audio/') || keyOrUrl.startsWith('music/') || keyOrUrl.startsWith('video/')
    ? getSignedUrl(keyOrUrl, ttlSeconds)
    : keyOrUrl
}

export async function getProjectModels(projectId: string, userId: string) {
  return await getProjectModelConfig(projectId, userId)
}

export async function getUserModels(userId: string) {
  return await getUserModelConfig(userId)
}
