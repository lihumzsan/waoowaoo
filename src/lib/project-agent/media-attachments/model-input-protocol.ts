import type { AgentInputItem, UserMessageItem } from '@openai/agents'
import type { ProjectAssistantMediaAttachment } from './types'

type UnknownObject = { [key: string]: unknown }
type ProjectAssistantImageInputPart = Extract<
  Exclude<UserMessageItem['content'], string>[number],
  { type: 'input_image' }
>

const PROJECT_ASSISTANT_MEDIA_MODEL_MARKER = 'waoowaoo-project-assistant-media'
const PROJECT_ASSISTANT_MEDIA_IMAGE_PREFIX = 'waoowaoo-attachment:'
const PROJECT_ASSISTANT_MEDIA_LEGACY_IMAGE_PREFIX = 'waoowaoo-resource:'

/**
 * One marked image part in canonical Session history.
 * - `attachment`: current protocol — the part carries the signed registration
 *   token; every model request re-verifies it and projects bytes on demand.
 * - `legacy_resource`: retired resource-backed protocol — recognized only so
 *   canonicalization stays idempotent and the model-input runtime can replace
 *   the part with an explicit typed placeholder. It is never resolved to
 *   media again.
 */
export type ProjectAssistantMarkedImage =
  | { readonly kind: 'attachment'; readonly attachmentToken: string; readonly resourceId: string }
  | { readonly kind: 'legacy_resource'; readonly resourceId: string }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function buildImageMarker(resourceId: string): string {
  return `${PROJECT_ASSISTANT_MEDIA_IMAGE_PREFIX}${resourceId}`
}

function buildLegacyImageMarker(resourceId: string): string {
  return `${PROJECT_ASSISTANT_MEDIA_LEGACY_IMAGE_PREFIX}${resourceId}`
}

function readMarkedImage(value: unknown): ProjectAssistantMarkedImage | null {
  if (!isRecord(value) || value.type !== 'input_image') return null
  const providerData = isRecord(value.providerData) ? value.providerData : null
  if (providerData?.model !== PROJECT_ASSISTANT_MEDIA_MODEL_MARKER) return null
  const resourceId = typeof providerData.resourceId === 'string'
    ? providerData.resourceId.trim()
    : ''
  if (!resourceId) return null
  const attachmentToken = typeof providerData.attachmentToken === 'string'
    ? providerData.attachmentToken.trim()
    : ''
  return attachmentToken
    ? { kind: 'attachment', attachmentToken, resourceId }
    : { kind: 'legacy_resource', resourceId }
}

export function mapProjectAssistantModelInputMedia(
  items: readonly AgentInputItem[],
  mapImage: (input: {
    readonly content: UnknownObject
    readonly marker: ProjectAssistantMarkedImage
  }) => UnknownObject,
): AgentInputItem[] {
  return items.map((item) => {
    const record = item as unknown as UnknownObject
    if (record.role !== 'user' || !Array.isArray(record.content)) return item
    let changed = false
    const content = record.content.map((part) => {
      const marker = readMarkedImage(part)
      if (!marker || !isRecord(part)) return part
      changed = true
      return mapImage({ content: part, marker })
    })
    return changed
      ? { ...record, content } as unknown as AgentInputItem
      : item
  })
}

export function buildProjectAssistantImageInputParts(
  attachments: readonly ProjectAssistantMediaAttachment[],
): readonly ProjectAssistantImageInputPart[] {
  return attachments.flatMap((attachment) => {
    if (attachment.mediaType !== 'image') return []
    if (!attachment.attachmentToken) {
      // Accepted messages always carry tokens; a null token here would mean a
      // legacy ref slipped past message acceptance. Fail closed.
      throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_TOKEN_REQUIRED:${attachment.resourceId}`)
    }
    return [{
      type: 'input_image',
      image: buildImageMarker(attachment.resourceId),
      detail: 'high',
      providerData: {
        // The Agents AI SDK adapter ignores providerData whose model marker
        // does not match the active provider/model. The marker therefore
        // survives Session persistence without leaking custom provider
        // options into the model request.
        model: PROJECT_ASSISTANT_MEDIA_MODEL_MARKER,
        attachmentToken: attachment.attachmentToken,
        resourceId: attachment.resourceId,
      },
    }]
  })
}

/**
 * Session history owns stable attachment identity, never expiring signed URLs.
 * The SDK persists the filtered model payload, so every Session write passes
 * through this canonicalizer before it reaches the durable history writer.
 * Legacy marked parts are restored to their original marker string only for
 * idempotence; they are never resolved to media again.
 */
export function canonicalizeProjectAssistantModelInputMedia(
  items: readonly AgentInputItem[],
): AgentInputItem[] {
  return mapProjectAssistantModelInputMedia(items, ({ content, marker }) => ({
    ...content,
    image: marker.kind === 'attachment'
      ? buildImageMarker(marker.resourceId)
      : buildLegacyImageMarker(marker.resourceId),
  }))
}
