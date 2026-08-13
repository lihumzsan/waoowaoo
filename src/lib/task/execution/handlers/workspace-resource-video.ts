import {
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { resolveOwnedAudioUrlForGeneration } from '@/lib/media/outbound-audio'
import { resolveOwnedImageUrlForGeneration } from '@/lib/media/outbound-image'
import { resolveOwnedVideoUrlForGeneration } from '@/lib/media/outbound-video'
import { probeMediaBufferDurationMs } from '@/lib/media/probe-duration'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { getObjectBuffer } from '@/lib/storage'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import {
  requireTaskProviderRouteSelection,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToStorage,
} from '../provider-media'

function frozenVideoOptions(
  value: WorkspaceResourceGenerationTaskPayload['generationOptions'],
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] => (
      entry[1] !== null
    )),
  )
}

async function loadVideoImageReferences(
  context: TaskExecutionContext,
  input: WorkspaceResourceGenerationTaskPayload,
) {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const imageInputs = input.resource.imageInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_VIDEO_IMAGE_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (imageInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId: context.data.userId,
    projectId: context.data.projectId,
    references: imageInputs,
    expectedMediaType: 'image',
  })
  return await Promise.all(resources.map(async (resource, index) => {
    const reference = resource.reference
    const role: 'first_frame' | 'last_frame' | 'reference_image' = reference.role === 'first_frame' || reference.role === 'last_frame'
      ? reference.role
      : 'reference_image'
    return {
      url: await resolveOwnedImageUrlForGeneration(
        resource.storageKey,
        context.data.userId,
      ),
      role,
      order: index + 1,
      source: 'generated' as const,
    }
  }))
}

async function loadVideoReferences(
  context: TaskExecutionContext,
  input: WorkspaceResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const videoInputs = input.resource.videoInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_VIDEO_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (videoInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId: context.data.userId,
    projectId: context.data.projectId,
    references: videoInputs,
    expectedMediaType: 'video',
  })
  return await Promise.all(resources.map(async (resource) => (
    await resolveOwnedVideoUrlForGeneration(resource.storageKey, context.data.userId)
  )))
}

export async function loadVideoAudioReferences(
  userId: string,
  projectId: string,
  input: WorkspaceResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const audioInputs = input.resource.audioInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_VIDEO_AUDIO_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (audioInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId,
    projectId,
    references: audioInputs,
    expectedMediaType: 'audio',
  })
  return await Promise.all(resources.map(async (resource) => {
    return await resolveOwnedAudioUrlForGeneration(resource.storageKey, userId)
  }))
}

export async function handleWorkspaceResourceVideoTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  if (
    payload.resource.resourceId !== data.targetId
    || payload.resource.mediaType !== 'video'
    || payload.videoModel !== payload.resource.modelKey
  ) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  await reportTaskProgress(context, 20, { stage: 'workspace_resource_prepare' })
  const referenceImages = await loadVideoImageReferences(context, payload)
  const referenceAudios = await loadVideoAudioReferences(data.userId, data.projectId, payload)
  const referenceVideos = await loadVideoReferences(context, payload)
  const options = payload.generationOptions
  const durationSeconds = payload.durationSeconds
  if (!durationSeconds) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_DURATION_REQUIRED:${data.taskId}`)
  }
  await reportTaskProgress(context, 45, { stage: 'workspace_resource_generate' })
  const generated = await resolveVideoSourceFromGeneration(context, {
    userId: data.userId,
    modelId: payload.resource.modelKey,
    referenceImages,
    referenceAudios,
    referenceVideos,
    options: {
      ...frozenVideoOptions(options),
      prompt: payload.resource.prompt,
      duration: durationSeconds,
    },
  })
  const providerRoute = await requireTaskProviderRouteSelection(
    context,
    'media:video:primary',
  )
  await reportTaskProgress(context, 90, { stage: 'workspace_resource_persist' })
  const storageKey = await uploadVideoSourceToStorage(
    generated.url,
    'workspace-resource',
    payload.resource.resourceId,
    generated.downloadHeaders,
    { taskId: data.taskId, artifact: `workspace-resource:${payload.resource.resourceId}` },
  )
  const durationMs = await probeMediaBufferDurationMs({
    buffer: await getObjectBuffer(storageKey),
    extension: 'mp4',
    stage: 'workspace_resource_video_probe_duration',
  })
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: 'video/mp4',
    durationMs,
  })
  return {
    mediaId: media.id,
    videoUrl: media.url,
    storageKey: media.storageKey,
    modelKey: providerRoute.modelKey,
    provider: providerRoute.provider,
    durationMs,
    ...(typeof generated.actualVideoTokens === 'number'
      ? { actualVideoTokens: generated.actualVideoTokens }
      : {}),
  }
}
