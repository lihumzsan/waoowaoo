import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetOverlayMap } from '@/lib/query/task-target-overlay'

type RegeneratePanelImageVariables = {
  panelId: string
  count?: number
}

type RegeneratePanelImageMutation = {
  onMutate: (variables: RegeneratePanelImageVariables) => void
  onSuccess: (payload: unknown, variables: RegeneratePanelImageVariables) => void
  onSettled: () => Promise<unknown>
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

describe('storyboard panel image mutation task state', () => {
  beforeEach(() => {
    runtime.queryClient = new QueryClient()
    runtime.mutationOptions = null
    vi.clearAllMocks()
  })

  it('records image_panel task state only after submission returns a real taskId', async () => {
    const { useRegenerateProjectPanelImage } = await import('@/lib/query/mutations/storyboard-panel-mutations')
    const queryClient = runtime.queryClient
    if (!queryClient) throw new Error('query client not initialized')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const mutation = useRegenerateProjectPanelImage('project-1', 'episode-1') as unknown as RegeneratePanelImageMutation

    mutation.onMutate({ panelId: 'panel-1', count: 1 })

    const optimisticOverlay = readOverlay(queryClient, 'project-1')
    expect(optimisticOverlay['ProjectPanel:panel-1']).toBeUndefined()

    mutation.onSuccess({ taskId: 'task-panel-image-1' }, { panelId: 'panel-1', count: 1 })

    const submittedOverlay = readOverlay(queryClient, 'project-1')
    expect(submittedOverlay['ProjectPanel:panel-1']?.runningTaskId).toBe('task-panel-image-1')
    expect(submittedOverlay['ProjectPanel:panel-1']?.runningTaskType).toBe('image_panel')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.tasks.targetStatesAll('project-1'),
      exact: false,
    })
  })
})
