import type { Job } from 'bullmq'
import {
  parseCreativeResourceGenerationTaskPayload,
  type CreativeResourceGenerationTaskPayload,
} from '@/lib/creative-resource/generation-contract'
import { normalizeOwnedMediaToBase64ForGeneration } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { readTaskProviderInvocationRouteSelection } from '@/lib/task/provider-invocation'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '@/lib/workers/utils'

async function loadImageReferences(
  job: Job<TaskJobData>,
  input: CreativeResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const imageInputs = input.resource.imageInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`CREATIVE_RESOURCE_IMAGE_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (imageInputs.length === 0) return []
  const revisions = await prisma.creativeResourceRevision.findMany({
    where: { id: { in: imageInputs.map((reference) => reference.revisionId) } },
    select: {
      id: true,
      media: { select: { storageKey: true } },
      resource: { select: { userId: true, mediaType: true, status: true } },
    },
  })
  const byId = new Map(revisions.map((revision) => [revision.id, revision]))
  return await Promise.all(imageInputs.map(async (reference) => {
    const revision = byId.get(reference.revisionId)
    if (!revision) throw new Error(`CREATIVE_RESOURCE_INPUT_REVISION_NOT_FOUND:${reference.revisionId}`)
    if (
      revision.resource.userId !== job.data.userId
      || revision.resource.status !== 'ready'
    ) {
      throw new Error(`CREATIVE_RESOURCE_INPUT_REVISION_CHANGED:${reference.revisionId}`)
    }
    if (revision.resource.mediaType !== 'image' || !revision.media?.storageKey) {
      throw new Error(`CREATIVE_RESOURCE_IMAGE_REFERENCE_REQUIRED:${reference.revisionId}`)
    }
    return await normalizeOwnedMediaToBase64ForGeneration(revision.media.storageKey, job.data.userId)
  }))
}

export async function handleCreativeResourceImageTask(job: Job<TaskJobData>) {
  if (job.data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${job.data.targetType}`)
  }
  const payload = parseCreativeResourceGenerationTaskPayload(job.data.payload ?? {})
  if (
    payload.resource.resourceId !== job.data.targetId
    || payload.resource.mediaType !== 'image'
    || payload.imageModel !== payload.resource.modelKey
  ) {
    throw new Error(`CREATIVE_RESOURCE_IMAGE_TASK_CONTRACT_INVALID:${job.data.taskId}`)
  }
  await reportTaskProgress(job, 20, { stage: 'creative_resource_prepare' })
  const referenceImages = await loadImageReferences(job, payload)
  await reportTaskProgress(job, 45, { stage: 'creative_resource_generate' })
  const source = await resolveImageSourceFromGeneration(job, {
    userId: job.data.userId,
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
  const providerRoute = await readTaskProviderInvocationRouteSelection({
    taskId: job.data.taskId,
    invocation: { key: 'media:image:primary' },
  })
  if (!providerRoute) {
    throw new Error(`CREATIVE_RESOURCE_IMAGE_PROVIDER_ROUTE_MISSING:${job.data.taskId}`)
  }
  await reportTaskProgress(job, 90, { stage: 'creative_resource_persist' })
  const storageKey = await uploadImageSourceToCos(source, 'creative-resource', payload.resource.resourceId, {
    taskId: job.data.taskId,
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
