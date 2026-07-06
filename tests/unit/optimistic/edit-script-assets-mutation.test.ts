import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetOverlayMap } from '@/lib/query/task-target-overlay'
import type { ProjectEditScript } from '@/types/project'

type GenerateEditAssetsMutationResult = {
  readonly editScript: ProjectEditScript
  readonly submittedTasks: readonly {
    readonly taskId: string
    readonly taskType: string
    readonly targetType: 'CharacterAppearance' | 'LocationImage'
    readonly targetId: string
  }[]
}

type GenerateEditAssetsMutation = {
  onSuccess: (
    result: GenerateEditAssetsMutationResult,
    variables: {
      readonly episodeId: string
      readonly editScriptId?: string
      readonly requirementId?: string
    },
  ) => Promise<void>
}

const runtime = vi.hoisted(() => ({
  queryClient: null as QueryClient | null,
  mutationOptions: null as unknown,
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: () => {
      if (!runtime.queryClient) throw new Error('query client not initialized')
      return runtime.queryClient
    },
    useMutation: (options: unknown) => {
      runtime.mutationOptions = options
      return options
    },
  }
})

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: vi.fn(),
}))

function readOverlay(queryClient: QueryClient, projectId: string): TaskTargetOverlayMap {
  return queryClient.getQueryData<TaskTargetOverlayMap>(
    queryKeys.tasks.targetStateOverlay(projectId),
  ) || {}
}

function buildEditScript(): ProjectEditScript {
  return {
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'prompt',
    styleBible: null,
    bibleText: null,
    durationSec: 30,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [],
    requirements: [
      {
        id: 'req-character',
        kind: 'character',
        name: 'Pilot',
        description: 'Pilot description',
        shotIds: ['shot-1'],
        status: 'generating',
        targetId: 'character-1',
        taskTargetType: 'CharacterAppearance',
        taskTargetId: 'appearance-1',
        errorMessage: null,
        previewImageUrl: null,
      },
    ],
  }
}

describe('edit script asset generation mutation task state', () => {
  beforeEach(() => {
    runtime.queryClient = new QueryClient()
    runtime.mutationOptions = null
    vi.clearAllMocks()
  })

  it('writes generating editScript cache and submitted asset task overlay immediately', async () => {
    const { useGenerateProjectEditScriptAssets } = await import('@/lib/query/hooks/useProjectEditScript')
    const queryClient = runtime.queryClient
    if (!queryClient) throw new Error('query client not initialized')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const mutation = useGenerateProjectEditScriptAssets('project-1') as unknown as GenerateEditAssetsMutation
    const editScript = buildEditScript()
    await mutation.onSuccess({
      editScript,
      submittedTasks: [{
        taskId: 'task-character-image-1',
        taskType: 'image_character',
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
      }],
    }, {
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
    })

    const cached = queryClient.getQueryData<ProjectEditScript>(
      queryKeys.project.editScript('project-1', 'episode-1'),
    )
    expect(cached?.requirements[0]?.status).toBe('generating')

    const overlay = readOverlay(queryClient, 'project-1')
    expect(overlay['CharacterAppearance:appearance-1']?.runningTaskId).toBe('task-character-image-1')
    expect(overlay['CharacterAppearance:appearance-1']?.runningTaskType).toBe('image_character')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.tasks.targetStatesAll('project-1'),
      exact: false,
    })
  })
})
