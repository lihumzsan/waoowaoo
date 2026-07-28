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
    const tag = `<uploaded_media name="${escapeTagAttribute(attachment.name)}" mediaType="${attachment.mediaType}" resourceId="${escapeTagAttribute(attachment.resourceId)}" />`
    return `Uploaded media ${String(index + 1)}:\n${tag}`
  })
  const hint = 'These are ready Resources owned by the user. To use one in generation, pass its resourceId into the matching typed reference parameter (for example create_video.imageReferences, create_video.audioReferences, create_audio.videoReference, or create_image.imageReferences).'
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
