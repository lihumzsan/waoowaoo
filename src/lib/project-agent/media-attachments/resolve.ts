import { readProjectCreativeResourceLinkViews } from '@/lib/creative-resource/assistant-link-view'
import type { ProjectAssistantMediaAttachment } from './types'

/**
 * Server-side authority for message media attachments: every ref is resolved
 * against the owned, ready Resource revision, and the returned name and
 * mediaType come from the database, never from the client payload. Missing,
 * foreign, pending or non-media refs fail closed.
 */
export async function resolveProjectAssistantMediaAttachments(input: {
  readonly userId: string
  readonly projectId: string
  readonly refs: readonly { readonly resourceId: string; readonly revisionId: string }[]
}): Promise<ProjectAssistantMediaAttachment[]> {
  if (input.refs.length === 0) return []
  const views = await readProjectCreativeResourceLinkViews({
    projectId: input.projectId,
    userId: input.userId,
    refs: input.refs,
  })
  return views.map((view) => {
    if (view.mediaType !== 'image' && view.mediaType !== 'audio') {
      throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MEDIA_TYPE_INVALID:${view.revisionId}`)
    }
    return {
      resourceId: view.resourceId,
      revisionId: view.revisionId,
      mediaType: view.mediaType,
      name: view.resourceName,
    }
  })
}
