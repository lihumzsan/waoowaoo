import {
  createHomeProjectLaunch,
  writeHomeAssistantAutoStartDraft,
  type CreateHomeProjectLaunchParams,
  type CreateHomeProjectLaunchResult,
  type HomeWorkspaceLaunchTarget,
} from './create-project-launch'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectVideoRatio } from '@/lib/projects/video-ratio'

type CreateHomeProjectLaunch = (
  params: CreateHomeProjectLaunchParams,
) => Promise<CreateHomeProjectLaunchResult>

type WriteHomeAssistantAutoStartMessage = (input: {
  readonly projectId: string
  readonly episodeId: string
  readonly message: string
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
}) => void

export interface SubmitHomeQuickStartLaunchParams {
  readonly inputValue: string
  readonly videoRatio: ProjectVideoRatio
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
  readonly isSubmitting: boolean
  readonly apiFetch: CreateHomeProjectLaunchParams['apiFetch']
  readonly projectName: string
  readonly episodeName: string
  readonly setSubmitting: (submitting: boolean) => void
  readonly setError: (message: string | null) => void
  readonly navigate: (target: HomeWorkspaceLaunchTarget) => void
  readonly resolveErrorMessage: (error: unknown) => string
  readonly createProjectLaunch?: CreateHomeProjectLaunch
  readonly writeAutoStartMessage?: WriteHomeAssistantAutoStartMessage
}

export async function submitHomeQuickStartLaunch({
  inputValue,
  videoRatio,
  attachments,
  isSubmitting,
  apiFetch,
  projectName,
  episodeName,
  setSubmitting,
  setError,
  navigate,
  resolveErrorMessage,
  createProjectLaunch = createHomeProjectLaunch,
  writeAutoStartMessage = writeHomeAssistantAutoStartDraft,
}: SubmitHomeQuickStartLaunchParams): Promise<void> {
  const storyText = inputValue.trim()
  const draftAttachments = attachments ?? []
  if ((!storyText && draftAttachments.length === 0) || isSubmitting) return

  setError(null)
  setSubmitting(true)

  try {
    const result = await createProjectLaunch({
      apiFetch,
      projectName,
      storyText,
      videoRatio,
      episodeName,
      hasAssistantDraftContent: storyText.length > 0 || draftAttachments.length > 0,
    })

    writeAutoStartMessage({
      projectId: result.projectId,
      episodeId: result.episodeId,
      message: storyText,
      attachments: draftAttachments,
    })
    navigate(result.target)
  } catch (error) {
    setError(resolveErrorMessage(error))
    setSubmitting(false)
  }
}
