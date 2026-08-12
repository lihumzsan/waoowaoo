import {
  createHomeProjectLaunch,
  writeHomeAssistantAutoStartDraft,
  type CreateHomeProjectLaunchParams,
  type CreateHomeProjectLaunchResult,
  type HomeWorkspaceLaunchTarget,
} from './create-project-launch'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'
import { uploadProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments/client'
import type { ProjectVideoRatio } from '@/lib/projects/video-ratio'

type CreateHomeProjectLaunch = (
  params: CreateHomeProjectLaunchParams,
) => Promise<CreateHomeProjectLaunchResult>

type WriteHomeAssistantAutoStartMessage = (input: {
  readonly projectId: string
  readonly message: string
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments?: readonly ProjectAssistantMediaAttachment[]
}) => void

type UploadHomeMediaAttachment = (params: {
  readonly projectId: string
  readonly file: File
}) => Promise<ProjectAssistantMediaAttachment>

export interface SubmitHomeQuickStartLaunchParams {
  readonly inputValue: string
  readonly videoRatio: ProjectVideoRatio
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
  readonly mediaFiles?: readonly File[]
  readonly isSubmitting: boolean
  readonly apiFetch: CreateHomeProjectLaunchParams['apiFetch']
  readonly projectName: string
  readonly setSubmitting: (submitting: boolean) => void
  readonly setError: (message: string | null) => void
  readonly navigate: (target: HomeWorkspaceLaunchTarget) => void
  readonly resolveErrorMessage: (error: unknown) => string
  readonly createProjectLaunch?: CreateHomeProjectLaunch
  readonly writeAutoStartMessage?: WriteHomeAssistantAutoStartMessage
  readonly uploadMediaAttachment?: UploadHomeMediaAttachment
}

export async function submitHomeQuickStartLaunch({
  inputValue,
  videoRatio,
  attachments,
  mediaFiles,
  isSubmitting,
  apiFetch,
  projectName,
  setSubmitting,
  setError,
  navigate,
  resolveErrorMessage,
  createProjectLaunch = createHomeProjectLaunch,
  writeAutoStartMessage = writeHomeAssistantAutoStartDraft,
  uploadMediaAttachment = uploadProjectAssistantMediaAttachment,
}: SubmitHomeQuickStartLaunchParams): Promise<void> {
  const storyText = inputValue.trim()
  const draftAttachments = attachments ?? []
  const draftMediaFiles = mediaFiles ?? []
  if ((!storyText && draftAttachments.length === 0 && draftMediaFiles.length === 0) || isSubmitting) return

  setError(null)
  setSubmitting(true)

  try {
    const result = await createProjectLaunch({
      apiFetch,
      projectName,
      storyText,
      videoRatio,
      hasAssistantDraftContent: storyText.length > 0
        || draftAttachments.length > 0
        || draftMediaFiles.length > 0,
    })

    // Media picked on Home is held as raw files until now: uploads are
    // project-scoped, so they can only materialize once the project exists.
    const mediaAttachments: ProjectAssistantMediaAttachment[] = []
    for (const file of draftMediaFiles) {
      mediaAttachments.push(await uploadMediaAttachment({
        projectId: result.projectId,
        file,
      }))
    }

    writeAutoStartMessage({
      projectId: result.projectId,
      message: storyText,
      attachments: draftAttachments,
      mediaAttachments,
    })
    navigate(result.target)
  } catch (error) {
    setError(resolveErrorMessage(error))
    setSubmitting(false)
  }
}
