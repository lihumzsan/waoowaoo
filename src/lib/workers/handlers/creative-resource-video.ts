import type { Job } from 'bullmq'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { supportsTextToVideoModel } from '@/lib/ai-registry/video-model-helpers'
import {
  parseCreativeResourceGenerationTaskPayload,
  type CreativeResourceGenerationTaskPayload,
} from '@/lib/creative-resource/generation-contract'
import { normalizeOwnedMediaToBase64ForGeneration } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { resolveVideoDownloadHeaders } from '@/lib/workers/video-download'
import {
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToCos,
} from '@/lib/workers/utils'

async function loadVideoImageReferences(
  job: Job<TaskJobData>,
  input: CreativeResourceGenerationTaskPayload,
) {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const imageInputs = input.resource.imageInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`CREATIVE_RESOURCE_VIDEO_IMAGE_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (imageInputs.length === 0) return []
  const resources = await prisma.creativeResource.findMany({
    where: { id: { in: imageInputs.map((reference) => reference.resourceId) } },
    select: {
      id: true,
      media: { select: { storageKey: true } },
      userId: true,
      mediaType: true,
      status: true,
    },
  })
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  return await Promise.all(imageInputs.map(async (reference, index) => {
    const resource = byId.get(reference.resourceId)
    if (!resource) throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
    if (resource.userId !== job.data.userId || resource.status !== 'ready') {
      throw new Error(`CREATIVE_RESOURCE_INPUT_CHANGED:${reference.resourceId}`)
    }
    if (resource.mediaType !== 'image' || !resource.media?.storageKey) {
      throw new Error(`CREATIVE_RESOURCE_VIDEO_IMAGE_REFERENCE_REQUIRED:${reference.resourceId}`)
    }
    const role: 'first_frame' | 'last_frame' | 'reference' = reference.role === 'first_frame' || reference.role === 'last_frame'
      ? reference.role
      : 'reference'
    return {
      url: await normalizeOwnedMediaToBase64ForGeneration(resource.media.storageKey, job.data.userId),
      role,
      order: index + 1,
      source: 'generated' as const,
    }
  }))
}

async function loadVideoAudioReferences(
  job: Job<TaskJobData>,
  input: CreativeResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const audioInputs = input.resource.audioInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`CREATIVE_RESOURCE_VIDEO_AUDIO_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (audioInputs.length === 0) return []
  const resources = await prisma.creativeResource.findMany({
    where: { id: { in: audioInputs.map((reference) => reference.resourceId) } },
    select: {
      id: true,
      media: { select: { storageKey: true } },
      userId: true,
      mediaType: true,
      status: true,
    },
  })
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  return await Promise.all(audioInputs.map(async (reference) => {
    const resource = byId.get(reference.resourceId)
    if (!resource) throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
    if (resource.userId !== job.data.userId || resource.status !== 'ready') {
      throw new Error(`CREATIVE_RESOURCE_INPUT_CHANGED:${reference.resourceId}`)
    }
    if (resource.mediaType !== 'audio' || !resource.media?.storageKey) {
      throw new Error(`CREATIVE_RESOURCE_VIDEO_AUDIO_REFERENCE_REQUIRED:${reference.resourceId}`)
    }
    return getSignedUrl(resource.media.storageKey, 3600)
  }))
}

export async function handleCreativeResourceVideoTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${job.data.targetType}`)
  }
  const payload = parseCreativeResourceGenerationTaskPayload(job.data.payload ?? {})
  if (
    payload.resource.resourceId !== job.data.targetId
    || payload.resource.mediaType !== 'video'
    || payload.videoModel !== payload.resource.modelKey
  ) {
    throw new Error(`CREATIVE_RESOURCE_VIDEO_TASK_CONTRACT_INVALID:${job.data.taskId}`)
  }
  await reportTaskProgress(job, 20, { stage: 'creative_resource_prepare' })
  const referenceImages = await loadVideoImageReferences(job, payload)
  const referenceAudios = await loadVideoAudioReferences(job, payload)
  if (referenceAudios.length > 0 && referenceImages.length === 0) {
    throw new Error(`VIDEO_MODEL_REFERENCE_AUDIO_REQUIRES_IMAGE:${payload.resource.modelKey}`)
  }
  if (
    referenceAudios.length > 0
    && referenceImages.some((reference) => reference.role === 'first_frame' || reference.role === 'last_frame')
  ) {
    throw new Error(`VIDEO_MODEL_REFERENCE_AUDIO_FRAME_ROLE_CONFLICT:${payload.resource.modelKey}`)
  }
  if (referenceImages.length === 0 && !supportsTextToVideoModel(payload.resource.modelKey)) {
    throw new Error(`VIDEO_MODEL_TEXT_TO_VIDEO_UNSUPPORTED:${payload.resource.modelKey}`)
  }
  const maxReferences = resolveBuiltinCapabilitiesByModelKey('video', payload.resource.modelKey)
    ?.video?.maxReferenceImages ?? 1
  if (referenceImages.length > maxReferences) {
    throw new Error(
      `VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED:${payload.resource.modelKey}:${String(referenceImages.length)}:${String(maxReferences)}`,
    )
  }
  const maxReferenceAudios = resolveBuiltinCapabilitiesByModelKey('video', payload.resource.modelKey)
    ?.video?.maxReferenceAudios
  if (referenceAudios.length > 0 && (!maxReferenceAudios || referenceAudios.length > maxReferenceAudios)) {
    throw new Error(
      `VIDEO_MODEL_AUDIO_REFERENCE_LIMIT_EXCEEDED:${payload.resource.modelKey}:${String(referenceAudios.length)}:${String(maxReferenceAudios ?? 0)}`,
    )
  }
  const options = payload.generationOptions
  await reportTaskProgress(job, 45, { stage: 'creative_resource_generate' })
  const generated = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: payload.resource.modelKey,
    referenceImages,
    referenceAudios,
    allowTextOnly: referenceImages.length === 0,
    options: {
      prompt: payload.resource.prompt,
      ...(typeof options.duration === 'number' ? { duration: options.duration } : {}),
      ...(typeof options.resolution === 'string' ? { resolution: options.resolution } : {}),
      ...(typeof options.aspectRatio === 'string' ? { aspectRatio: options.aspectRatio } : {}),
      ...(typeof options.generateAudio === 'boolean' ? { generateAudio: options.generateAudio } : {}),
      generationMode: 'normal',
    },
  })
  const downloadHeaders = await resolveVideoDownloadHeaders(
    job.data.userId,
    payload.resource.modelKey,
    generated.url,
    generated.downloadHeaders,
  )
  await reportTaskProgress(job, 90, { stage: 'creative_resource_persist' })
  const storageKey = await uploadVideoSourceToCos(
    generated.url,
    'creative-resource',
    payload.resource.resourceId,
    downloadHeaders,
    { taskId: job.data.taskId, artifact: `creative-resource:${payload.resource.resourceId}` },
  )
  const durationSeconds = typeof options.duration === 'number' ? options.duration : null
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: 'video/mp4',
    ...(durationSeconds ? { durationMs: durationSeconds * 1000 } : {}),
  })
  return {
    mediaId: media.id,
    videoUrl: media.url,
    storageKey: media.storageKey,
    modelKey: payload.resource.modelKey,
    provider: payload.resource.modelKey.split('::')[0] || null,
    ...(durationSeconds ? { durationMs: durationSeconds * 1000 } : {}),
    ...(typeof generated.actualVideoTokens === 'number'
      ? { actualVideoTokens: generated.actualVideoTokens }
      : {}),
  }
}
