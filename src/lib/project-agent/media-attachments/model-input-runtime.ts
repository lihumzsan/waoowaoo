import type { AgentInputItem } from '@openai/agents'
import { createScopedLogger } from '@/lib/logging/core'
import { MAX_IMAGE_BYTES } from '@/lib/http/body-limits'
import { normalizeToOriginalMediaUrl } from '@/lib/media/outbound-image'
import {
  canonicalizeProjectAssistantModelInputMedia,
  mapProjectAssistantModelInputMedia,
} from './model-input-protocol'
import { resolveProjectAssistantAttachmentRegistration } from './resolve'

const logger = createScopedLogger({
  module: 'project-agent.media-attachments',
})

const PROVIDER_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

/**
 * Replaces one retired-protocol image part in the outgoing payload only. The
 * canonical Session keeps the original marked part untouched; this text is the
 * explicit, model-visible fact that the pixels are no longer reachable.
 */
const LEGACY_ATTACHMENT_PLACEHOLDER_TEXT = '[uploaded image unavailable: this attachment was sent under a retired attachment protocol and its pixels can no longer be projected; ask the user to re-upload the file if it is still needed]'

/**
 * The only bridge from a chat attachment identity to model-visible image
 * bytes. Every model request re-verifies the signed registration token against
 * the authoritative user/project scope, re-reads the registered MediaObject,
 * and then uses the shared outbound-image authority to produce a
 * provider-safe URL. Legacy resource-backed markers are protocol-incompatible:
 * they are replaced with an explicit placeholder and logged, never resolved
 * and never silently dropped.
 *
 * This server runtime is shared by Next command validation and the Temporal
 * Agent Turn Activity. It must not import Next-only boundary markers such as
 * `server-only`.
 */
export async function resolveProjectAssistantModelInputMedia(input: {
  readonly items: readonly AgentInputItem[]
  readonly userId: string
  readonly projectId: string
}): Promise<AgentInputItem[]> {
  const canonicalItems = canonicalizeProjectAssistantModelInputMedia(input.items)
  const attachmentTokens: string[] = []
  const legacyResourceIds: string[] = []
  mapProjectAssistantModelInputMedia(canonicalItems, ({ content, marker }) => {
    if (marker.kind === 'attachment') {
      if (!attachmentTokens.includes(marker.attachmentToken)) {
        attachmentTokens.push(marker.attachmentToken)
      }
    } else if (!legacyResourceIds.includes(marker.resourceId)) {
      legacyResourceIds.push(marker.resourceId)
    }
    return content
  })
  if (attachmentTokens.length === 0 && legacyResourceIds.length === 0) return canonicalItems

  if (legacyResourceIds.length > 0) {
    logger.warn({
      action: 'assistant.media_attachment.legacy_marker_placeholder',
      message: 'legacy resource-backed attachment markers replaced with typed placeholder',
      details: {
        projectId: input.projectId,
        resourceIds: legacyResourceIds,
      },
    })
  }

  const imageUrlByToken = new Map<string, string>()
  await Promise.all(attachmentTokens.map(async (attachmentToken) => {
    const registration = await resolveProjectAssistantAttachmentRegistration({
      userId: input.userId,
      projectId: input.projectId,
      attachmentToken,
    })
    if (registration.payload.mediaType !== 'image') {
      throw new Error(
        `PROJECT_ASSISTANT_MODEL_INPUT_IMAGE_ATTACHMENT_INVALID:${registration.payload.resourceId}`,
      )
    }
    const mimeType = registration.media.mimeType?.toLowerCase() ?? ''
    if (!PROVIDER_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(
        `PROJECT_ASSISTANT_MODEL_INPUT_IMAGE_MIME_UNSUPPORTED:${registration.payload.resourceId}`,
      )
    }
    if (
      registration.media.sizeBytes !== null
      && registration.media.sizeBytes > MAX_IMAGE_BYTES
    ) {
      throw new Error(
        `PROJECT_ASSISTANT_MODEL_INPUT_IMAGE_SIZE_EXCEEDED:${registration.payload.resourceId}`,
      )
    }
    imageUrlByToken.set(
      attachmentToken,
      await normalizeToOriginalMediaUrl(registration.media.storageKey),
    )
  }))

  return mapProjectAssistantModelInputMedia(canonicalItems, ({ content, marker }) => {
    if (marker.kind === 'legacy_resource') {
      return {
        type: 'input_text',
        text: LEGACY_ATTACHMENT_PLACEHOLDER_TEXT,
      }
    }
    const image = imageUrlByToken.get(marker.attachmentToken)
    if (!image) {
      throw new Error(`PROJECT_ASSISTANT_MODEL_INPUT_IMAGE_URL_MISSING:${marker.resourceId}`)
    }
    return { ...content, image }
  })
}
