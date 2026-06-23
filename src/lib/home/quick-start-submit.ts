import {
  createHomeProjectLaunch,
  writeHomeAssistantAutoStartMessage,
  type CreateHomeProjectLaunchParams,
  type CreateHomeProjectLaunchResult,
  type HomeWorkspaceLaunchTarget,
} from './create-project-launch'

type CreateHomeProjectLaunch = (
  params: CreateHomeProjectLaunchParams,
) => Promise<CreateHomeProjectLaunchResult>

type WriteHomeAssistantAutoStartMessage = (input: {
  readonly projectId: string
  readonly episodeId: string
  readonly message: string
}) => void

export interface SubmitHomeQuickStartLaunchParams {
  readonly inputValue: string
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
  isSubmitting,
  apiFetch,
  projectName,
  episodeName,
  setSubmitting,
  setError,
  navigate,
  resolveErrorMessage,
  createProjectLaunch = createHomeProjectLaunch,
  writeAutoStartMessage = writeHomeAssistantAutoStartMessage,
}: SubmitHomeQuickStartLaunchParams): Promise<void> {
  const storyText = inputValue.trim()
  if (!storyText || isSubmitting) return

  setError(null)
  setSubmitting(true)

  try {
    const result = await createProjectLaunch({
      apiFetch,
      projectName,
      storyText,
      episodeName,
    })

    writeAutoStartMessage({
      projectId: result.projectId,
      episodeId: result.episodeId,
      message: storyText,
    })
    navigate(result.target)
  } catch (error) {
    setError(resolveErrorMessage(error))
    setSubmitting(false)
  }
}
