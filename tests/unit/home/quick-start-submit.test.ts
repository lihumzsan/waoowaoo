import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOME_ASSISTANT_AUTOSTART_QUERY,
  HOME_ASSISTANT_AUTOSTART_VALUE,
  type CreateHomeProjectLaunchParams,
  type CreateHomeProjectLaunchResult,
  type HomeWorkspaceLaunchTarget,
} from '@/lib/home/create-project-launch'
import { submitHomeQuickStartLaunch } from '@/lib/home/quick-start-submit'

function buildLaunchResult(): CreateHomeProjectLaunchResult {
  return {
    projectId: 'project-1',
    episodeId: 'episode-1',
    target: {
      pathname: '/workspace/project-1',
      query: {
        episode: 'episode-1',
        [HOME_ASSISTANT_AUTOSTART_QUERY]: HOME_ASSISTANT_AUTOSTART_VALUE,
      },
    },
  }
}

describe('submitHomeQuickStartLaunch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps quick-start loading active after successful navigation starts', async () => {
    const apiFetch = vi.fn<CreateHomeProjectLaunchParams['apiFetch']>()
    const createProjectLaunch = vi
      .fn<(params: CreateHomeProjectLaunchParams) => Promise<CreateHomeProjectLaunchResult>>()
      .mockResolvedValue(buildLaunchResult())
    const writeAutoStartMessage = vi.fn<(input: {
      readonly projectId: string
      readonly episodeId: string
      readonly message: string
    }) => void>()
    const navigate = vi.fn<(target: HomeWorkspaceLaunchTarget) => void>()
    const submittingEvents: boolean[] = []
    const errorEvents: Array<string | null> = []

    await submitHomeQuickStartLaunch({
      inputValue: '  第一章内容  ',
      isSubmitting: false,
      apiFetch,
      projectName: '项目名',
      episodeName: '第 1 集',
      setSubmitting: (submitting) => {
        submittingEvents.push(submitting)
      },
      setError: (message) => {
        errorEvents.push(message)
      },
      navigate,
      resolveErrorMessage: (error) => error instanceof Error ? error.message : 'create failed',
      createProjectLaunch,
      writeAutoStartMessage,
    })

    expect(submittingEvents).toEqual([true])
    expect(errorEvents).toEqual([null])
    expect(createProjectLaunch).toHaveBeenCalledWith({
      apiFetch,
      projectName: '项目名',
      storyText: '第一章内容',
      episodeName: '第 1 集',
    })
    expect(writeAutoStartMessage).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      message: '第一章内容',
    })
    expect(navigate).toHaveBeenCalledWith(buildLaunchResult().target)
  })

  it('restores quick-start loading when project launch fails before navigation', async () => {
    const apiFetch = vi.fn<CreateHomeProjectLaunchParams['apiFetch']>()
    const createProjectLaunch = vi
      .fn<(params: CreateHomeProjectLaunchParams) => Promise<CreateHomeProjectLaunchResult>>()
      .mockRejectedValue(new Error('create failed explicitly'))
    const writeAutoStartMessage = vi.fn<(input: {
      readonly projectId: string
      readonly episodeId: string
      readonly message: string
    }) => void>()
    const navigate = vi.fn<(target: HomeWorkspaceLaunchTarget) => void>()
    const submittingEvents: boolean[] = []
    const errorEvents: Array<string | null> = []

    await submitHomeQuickStartLaunch({
      inputValue: '第一章内容',
      isSubmitting: false,
      apiFetch,
      projectName: '项目名',
      episodeName: '第 1 集',
      setSubmitting: (submitting) => {
        submittingEvents.push(submitting)
      },
      setError: (message) => {
        errorEvents.push(message)
      },
      navigate,
      resolveErrorMessage: (error) => error instanceof Error ? error.message : 'create failed',
      createProjectLaunch,
      writeAutoStartMessage,
    })

    expect(submittingEvents).toEqual([true, false])
    expect(errorEvents).toEqual([null, 'create failed explicitly'])
    expect(writeAutoStartMessage).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
