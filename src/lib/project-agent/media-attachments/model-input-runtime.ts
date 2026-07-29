import type { AgentInputItem } from '@openai/agents'
import { resolveOwnedImageHttpsForGeneration } from '@/lib/media/outbound-image'
import {
  canonicalizeProjectAssistantModelInputMedia,
  mapProjectAssistantModelInputMedia,
} from './model-input-protocol'
import { resolveProjectAssistantMediaAttachments } from './resolve'

/**
 * The only bridge from an attached Resource identity to model-visible image
 * bytes. Every model request revalidates owner/project/ready facts and then
 * uses the shared outbound-image authority to produce a provider-safe URL.
 *
 * This server runtime is shared by Next commands and Outbox continuations.
 * It must not import Next-only boundary markers such as `server-only`.
 */
export async function resolveProjectAssistantModelInputMedia(input: {
  readonly items: readonly AgentInputItem[]
  readonly userId: string
  readonly projectId: string
}): Promise<AgentInputItem[]> {
  const canonicalItems = canonicalizeProjectAssistantModelInputMedia(input.items)
  const resourceIds: string[] = []
  mapProjectAssistantModelInputMedia(canonicalItems, ({ content, resourceId }) => {
    if (!resourceIds.includes(resourceId)) resourceIds.push(resourceId)
    return content
  })
  if (resourceIds.length === 0) return canonicalItems

  const attachments = await resolveProjectAssistantMediaAttachments({
    userId: input.userId,
    projectId: input.projectId,
    refs: resourceIds.map((resourceId) => ({ resourceId })),
  })
  const imageUrlByResourceId = new Map<string, string>()
  await Promise.all(attachments.map(async (attachment) => {
    if (attachment.mediaType !== 'image' || !attachment.href) {
      throw new Error(
        `PROJECT_ASSISTANT_MODEL_INPUT_IMAGE_RESOURCE_INVALID:${attachment.resourceId}`,
      )
    }
    imageUrlByResourceId.set(
      attachment.resourceId,
      await resolveOwnedImageHttpsForGeneration(attachment.href, input.userId),
    )
  }))

  return mapProjectAssistantModelInputMedia(canonicalItems, ({ content, resourceId }) => {
    const image = imageUrlByResourceId.get(resourceId)
    if (!image) {
      throw new Error(`PROJECT_ASSISTANT_MODEL_INPUT_IMAGE_URL_MISSING:${resourceId}`)
    }
    return { ...content, image }
  })
}
