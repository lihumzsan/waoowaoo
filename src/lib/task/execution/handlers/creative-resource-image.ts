import {
  parseCreativeResourceGenerationTaskPayload,
  type CreativeResourceGenerationTaskPayload,
} from '@/lib/creative-resource/generation-contract'
import { resolveOwnedImageHttpsForGeneration } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import {
  requireTaskProviderRouteSelection,
  resolveImageSourceFromGeneration,
  uploadImageSourceToStorage,
} from '../provider-media'

async function loadImageReferences(
  context: TaskExecutionContext,
  input: CreativeResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const imageInputs = input.resource.imageInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`CREATIVE_RESOURCE_IMAGE_INPUT_POSITION_INVALID:${String(position)}`)
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
  return await Promise.all(imageInputs.map(async (reference) => {
    const resource = byId.get(reference.resourceId)
    if (!resource) throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
    if (resource.userId !== context.data.userId || resource.status !== 'ready') {
      throw new Error(`CREATIVE_RESOURCE_INPUT_CHANGED:${reference.resourceId}`)
    }
    if (resource.mediaType !== 'image' || !resource.media?.storageKey) {
      throw new Error(`CREATIVE_RESOURCE_IMAGE_REFERENCE_REQUIRED:${reference.resourceId}`)
    }
    return await resolveOwnedImageHttpsForGeneration(
      resource.media.storageKey,
      context.data.userId,
    )
  }))
}

export async function handleCreativeResourceImageTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseCreativeResourceGenerationTaskPayload(data.payload ?? {})
  if (
    payload.resource.resourceId !== data.targetId
    || payload.resource.mediaType !== 'image'
    || payload.imageModel !== payload.resource.modelKey
  ) {
    throw new Error(`CREATIVE_RESOURCE_IMAGE_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  await reportTaskProgress(context, 20, { stage: 'creative_resource_prepare' })
  const referenceImages = await loadImageReferences(context, payload)
  await reportTaskProgress(context, 45, { stage: 'creative_resource_generate' })
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
  await reportTaskProgress(context, 90, { stage: 'creative_resource_persist' })
  const storageKey = await uploadImageSourceToStorage(source, 'creative-resource', payload.resource.resourceId, {
    taskId: data.taskId,
    artifact: `creative-resource:${payload.resource.resourceId}`,
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
