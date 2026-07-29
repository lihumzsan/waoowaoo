import type { AgentInputItem, UserMessageItem } from '@openai/agents'
import type { ProjectAssistantMediaAttachment } from './types'

type UnknownObject = { [key: string]: unknown }
type ProjectAssistantImageInputPart = Extract<
  Exclude<UserMessageItem['content'], string>[number],
  { type: 'input_image' }
>

const PROJECT_ASSISTANT_MEDIA_MODEL_MARKER = 'waoowaoo-project-assistant-media'
const PROJECT_ASSISTANT_MEDIA_IMAGE_PREFIX = 'waoowaoo-resource:'

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function buildImageMarker(resourceId: string): string {
  return `${PROJECT_ASSISTANT_MEDIA_IMAGE_PREFIX}${resourceId}`
}

function readMarkedImageResourceId(value: unknown): string | null {
  if (!isRecord(value) || value.type !== 'input_image') return null
  const providerData = isRecord(value.providerData) ? value.providerData : null
  if (providerData?.model !== PROJECT_ASSISTANT_MEDIA_MODEL_MARKER) return null
  const resourceId = typeof providerData.resourceId === 'string'
    ? providerData.resourceId.trim()
    : ''
  return resourceId || null
}

export function mapProjectAssistantModelInputMedia(
  items: readonly AgentInputItem[],
  mapImage: (input: {
    readonly content: UnknownObject
    readonly resourceId: string
  }) => UnknownObject,
): AgentInputItem[] {
  return items.map((item) => {
    const record = item as unknown as UnknownObject
    if (record.role !== 'user' || !Array.isArray(record.content)) return item
    let changed = false
    const content = record.content.map((part) => {
      const resourceId = readMarkedImageResourceId(part)
      if (!resourceId || !isRecord(part)) return part
      changed = true
      return mapImage({ content: part, resourceId })
    })
    return changed
      ? { ...record, content } as unknown as AgentInputItem
      : item
  })
}

export function buildProjectAssistantImageInputParts(
  attachments: readonly ProjectAssistantMediaAttachment[],
): readonly ProjectAssistantImageInputPart[] {
  return attachments.flatMap((attachment) => attachment.mediaType === 'image'
    ? [{
        type: 'input_image',
        image: buildImageMarker(attachment.resourceId),
        detail: 'high',
        providerData: {
          // The Agents AI SDK adapter ignores providerData whose model marker
          // does not match the active provider/model. The marker therefore
          // survives Session persistence without leaking custom provider
          // options into the model request.
          model: PROJECT_ASSISTANT_MEDIA_MODEL_MARKER,
          resourceId: attachment.resourceId,
        },
      }]
    : [])
}

/**
 * Session history owns stable Resource identity, never expiring signed URLs.
 * The SDK persists the filtered model payload, so every Session write passes
 * through this canonicalizer before it reaches the durable history writer.
 */
export function canonicalizeProjectAssistantModelInputMedia(
  items: readonly AgentInputItem[],
): AgentInputItem[] {
  return mapProjectAssistantModelInputMedia(items, ({ content, resourceId }) => ({
    ...content,
    image: buildImageMarker(resourceId),
  }))
}
