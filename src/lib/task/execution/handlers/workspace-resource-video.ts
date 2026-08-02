import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { supportsTextToVideoModel } from '@/lib/ai-registry/video-model-helpers'
import {
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { resolveOwnedAudioHttpsForGeneration } from '@/lib/media/outbound-audio'
import { resolveOwnedImageHttpsForGeneration } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import {
  requireTaskProviderRouteSelection,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToStorage,
} from '../provider-media'

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
    const role: 'first_frame' | 'last_frame' | 'reference' = reference.role === 'first_frame' || reference.role === 'last_frame'
      ? reference.role
      : 'reference'
    return {
      url: await resolveOwnedImageHttpsForGeneration(
        resource.storageKey,
        context.data.userId,
      ),
      role,
      order: index + 1,
      source: 'generated' as const,
    }
  }))
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
    return await resolveOwnedAudioHttpsForGeneration(resource.storageKey, userId)
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
  await reportTaskProgress(context, 45, { stage: 'workspace_resource_generate' })
  const generated = await resolveVideoSourceFromGeneration(context, {
    userId: data.userId,
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
  const durationSeconds = typeof options.duration === 'number' ? options.duration : null
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: 'video/mp4',
    ...(durationSeconds ? { durationMs: durationSeconds * 1000 } : {}),
  })
  return {
    mediaId: media.id,
    videoUrl: media.url,
    storageKey: media.storageKey,
    modelKey: providerRoute.modelKey,
    provider: providerRoute.provider,
    ...(durationSeconds ? { durationMs: durationSeconds * 1000 } : {}),
    ...(typeof generated.actualVideoTokens === 'number'
      ? { actualVideoTokens: generated.actualVideoTokens }
      : {}),
  }
}
