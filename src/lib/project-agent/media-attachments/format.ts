import type { ProjectAssistantMediaAttachment } from './types'

function escapeTagAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function formatProjectAssistantMediaAttachmentsForModel(input: {
  readonly attachments: readonly ProjectAssistantMediaAttachment[]
}): string {
  if (input.attachments.length === 0) return ''
  const blocks = input.attachments.map((attachment, index) => {
    if (!attachment.attachmentToken) {
      throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_TOKEN_REQUIRED:${attachment.resourceId}`)
    }
    const tag = `<uploaded_media name="${escapeTagAttribute(attachment.name)}" mediaType="${attachment.mediaType}" attachmentToken="${escapeTagAttribute(attachment.attachmentToken)}" />`
    return `Uploaded media ${String(index + 1)}:\n${tag}`
  })
  const hint = 'These are chat-scoped uploaded attachments, not project Resources yet. Attached images are already visible to you in this conversation for viewing and discussion. To use one as a production input, first call register_uploaded_media with the exact attachmentToken and a project-relative outputPath ending in .resource, then wait until that pointer is ready. Give the ready project-relative pointer path and its intended role to the exact fixed professional Subagent; that Subagent must write the returned Resource identity, content version, channel, and position into its Production Manifest. You may submit that authored Manifest by path, but you must not author or rewrite its professional prompt or reference choices. Follow the live tool schema exactly; never invent or reuse tokens or Resource identities.'
  return [...blocks, hint].join('\n\n')
}

export function appendProjectAssistantMediaAttachmentsToUserText(input: {
  readonly userText: string
  readonly attachments: readonly ProjectAssistantMediaAttachment[]
}): string {
  const attachmentText = formatProjectAssistantMediaAttachmentsForModel({
    attachments: input.attachments,
  })
  return [input.userText.trim(), attachmentText].filter(Boolean).join('\n\n')
}
