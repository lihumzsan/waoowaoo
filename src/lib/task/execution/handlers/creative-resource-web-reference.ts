import {
  parseCreativeResourceWebReferenceTaskPayload,
  readWebReferenceImageUrl,
} from '@/lib/creative-resource/web-reference-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { uploadImageSourceToStorage } from '../provider-media'

/**
 * Import one third-party web image into owned storage.
 *
 * The external URL never reaches a generation provider: it is fetched through
 * the shared outbound image boundary, which enforces the http(s) scheme, refuses
 * private and loopback destinations, bounds redirects and caps the byte size.
 * Only the resulting owned media becomes a Resource, which is what
 * downstream image and video references consume.
 */
export async function handleCreativeResourceWebReferenceTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseCreativeResourceWebReferenceTaskPayload(data.payload ?? {})
  if (payload.resource.resourceId !== data.targetId) {
    throw new Error(`CREATIVE_RESOURCE_WEB_REFERENCE_TASK_CONTRACT_INVALID:${data.taskId}`)
  }

  await reportTaskProgress(context, 20, { stage: 'creative_resource_prepare' })
  const dataUrl = await normalizeToBase64ForGeneration(
    readWebReferenceImageUrl(payload.resource.generationOptions),
  )

  await reportTaskProgress(context, 70, { stage: 'creative_resource_persist' })
  const storageKey = await uploadImageSourceToStorage(
    dataUrl,
    'web-reference',
    payload.resource.resourceId,
    {
      taskId: data.taskId,
      artifact: `creative-resource:${payload.resource.resourceId}`,
    },
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey)
  return {
    mediaId: media.id,
    imageUrl: media.url,
    storageKey: media.storageKey,
  }
}
