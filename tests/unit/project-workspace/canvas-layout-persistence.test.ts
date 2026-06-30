import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import type {
  ProjectCanvasLayoutSnapshot,
  UpsertCanvasLayoutInput,
} from '@/lib/project-canvas/layout/canvas-layout-contract'

interface CapturedMutationOptions {
  readonly onMutate?: (input?: UpsertCanvasLayoutInput) => Promise<unknown>
  readonly onSuccess?: (
    data: ProjectCanvasLayoutSnapshot | undefined,
    variables: UpsertCanvasLayoutInput | undefined,
    context: unknown,
  ) => void
  readonly onError?: (
    error: unknown,
    variables: UpsertCanvasLayoutInput | undefined,
    context: unknown,
  ) => void
}

const reactQueryMock = vi.hoisted(() => {
  const mutations: CapturedMutationOptions[] = []
  const queryClient = {
    cancelQueries: vi.fn(async () => undefined),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    removeQueries: vi.fn(),
  }
  return {
    mutations,
    queryClient,
    useMutation: vi.fn((options: CapturedMutationOptions) => {
      mutations.push(options)
      return {
        mutateAsync: vi.fn(),
        isPending: false,
        error: null,
      }
    }),
    useQuery: vi.fn(() => ({
      data: null,
      isLoading: false,
      error: null,
    })),
    useQueryClient: vi.fn(() => queryClient),
  }
})

vi.mock('@tanstack/react-query', () => ({
  useMutation: reactQueryMock.useMutation,
  useQuery: reactQueryMock.useQuery,
  useQueryClient: reactQueryMock.useQueryClient,
}))

function layoutInput(): UpsertCanvasLayoutInput {
  return {
    episodeId: 'episode-1',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodeLayouts: [{
      nodeKey: 'shot:panel-1',
      nodeType: 'shot',
      targetType: 'panel',
      targetId: 'panel-1',
      x: 120,
      y: 240,
      width: 320,
      height: 420,
      zIndex: 0,
      locked: false,
      collapsed: false,
    }],
  }
}

describe('workspace canvas layout persistence', () => {
  beforeEach(() => {
    reactQueryMock.mutations.splice(0)
    vi.clearAllMocks()
  })

  it('writes dragged layout into the canvas layout query cache before projection rebuilds', async () => {
    const previous = { layout: null, warningCode: null }
    reactQueryMock.queryClient.getQueryData.mockReturnValueOnce(previous)
    const { useCanvasLayoutPersistence } = await import('@/features/project-workspace/canvas/hooks/useCanvasLayoutPersistence')
    useCanvasLayoutPersistence({ projectId: 'project-1', episodeId: 'episode-1' })
    const mutation = reactQueryMock.mutations[0]
    const input = layoutInput()

    const context = await mutation?.onMutate?.(input)

    const layoutKey = queryKeys.project.canvasLayout('project-1', 'episode-1')
    expect(reactQueryMock.queryClient.cancelQueries).toHaveBeenCalledWith({ queryKey: layoutKey })
    expect(reactQueryMock.queryClient.setQueryData).toHaveBeenLastCalledWith(layoutKey, {
      layout: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        schemaVersion: 1,
        viewport: input.viewport,
        nodeLayouts: input.nodeLayouts,
      },
      warningCode: null,
    })
    expect(context).toEqual({ previous })
  })

  it('confirms canvas layout cache from the saved server snapshot', async () => {
    const { useCanvasLayoutPersistence } = await import('@/features/project-workspace/canvas/hooks/useCanvasLayoutPersistence')
    useCanvasLayoutPersistence({ projectId: 'project-1', episodeId: 'episode-1' })
    const mutation = reactQueryMock.mutations[0]
    const input = layoutInput()
    const savedLayout: ProjectCanvasLayoutSnapshot = {
      projectId: 'project-1',
      episodeId: 'episode-1',
      schemaVersion: 1,
      viewport: input.viewport,
      nodeLayouts: input.nodeLayouts,
    }

    mutation?.onSuccess?.(savedLayout, input, { previous: null })

    expect(reactQueryMock.queryClient.setQueryData).toHaveBeenLastCalledWith(
      queryKeys.project.canvasLayout('project-1', 'episode-1'),
      { layout: savedLayout, warningCode: null },
    )
  })

  it('clears canvas layout cache when layout reset succeeds', async () => {
    const { useCanvasLayoutPersistence } = await import('@/features/project-workspace/canvas/hooks/useCanvasLayoutPersistence')
    useCanvasLayoutPersistence({ projectId: 'project-1', episodeId: 'episode-1' })
    const resetMutation = reactQueryMock.mutations[1]

    resetMutation?.onSuccess?.(undefined, undefined, { previous: null })

    expect(reactQueryMock.queryClient.setQueryData).toHaveBeenLastCalledWith(
      queryKeys.project.canvasLayout('project-1', 'episode-1'),
      { layout: null, warningCode: null },
    )
  })
})
