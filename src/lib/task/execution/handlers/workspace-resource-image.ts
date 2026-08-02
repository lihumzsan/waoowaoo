import {
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { resolveOwnedImageHttpsForGeneration } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import {
  requireTaskProviderRouteSelection,
  resolveImageSourceFromGeneration,
  uploadImageSourceToStorage,
} from '../provider-media'

async function loadImageReferences(
  context: TaskExecutionContext,
  input: WorkspaceResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const imageInputs = input.resource.imageInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_IMAGE_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (imageInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId: context.data.userId,
    projectId: context.data.projectId,
    references: imageInputs,
    expectedMediaType: 'image',
  })
  return await Promise.all(resources.map(async (resource) => {
    return await resolveOwnedImageHttpsForGeneration(
      resource.storageKey,
      context.data.userId,
    )
  }))
}

export async function handleWorkspaceResourceImageTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  if (
    payload.resource.resourceId !== data.targetId
    || payload.resource.mediaType !== 'image'
    || payload.imageModel !== payload.resource.modelKey
  ) {
    throw new Error(`WORKSPACE_RESOURCE_IMAGE_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  await reportTaskProgress(context, 20, { stage: 'workspace_resource_prepare' })
  const referenceImages = await loadImageReferences(context, payload)
  await reportTaskProgress(context, 45, { stage: 'workspace_resource_generate' })
  const source = await resolveImageSourceFromGeneration(context, {
    userId: data.userId,
    modelId: payload.resource.modelKey,
    prompt: payload.resource.prompt,
    options: {
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
      ...(typeof payload.generationOptions.aspectRatio === 'string'
        ? { aspectRatio: payload.generationOptions.aspectRatio }
        : {}),
      ...(typeof payload.generationOptions.resolution === 'string'
        ? { resolution: payload.generationOptions.resolution }
        : {}),
      ...(typeof payload.generationOptions.quality === 'string'
        ? { quality: payload.generationOptions.quality }
        : {}),
      ...(typeof payload.generationOptions.size === 'string'
        ? { size: payload.generationOptions.size }
        : {}),
    },
  })
  const providerRoute = await requireTaskProviderRouteSelection(
    context,
    'media:image:primary',
  )
  await reportTaskProgress(context, 90, { stage: 'workspace_resource_persist' })
  const storageKey = await uploadImageSourceToStorage(source, 'workspace-resource', payload.resource.resourceId, {
    taskId: data.taskId,
    artifact: `workspace-resource:${payload.resource.resourceId}`,
  })
  const media = await ensureMediaObjectFromStorageKey(storageKey)
  return {
    mediaId: media.id,
    imageUrl: media.url,
    storageKey: media.storageKey,
    modelKey: providerRoute.modelKey,
    provider: providerRoute.provider,
  }
}
