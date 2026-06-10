import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetOverlayMap } from '@/lib/query/task-target-overlay'
import { MockQueryClient } from '../../helpers/mock-query-client'

const mutationSharedMock = vi.hoisted(() => ({
  invalidateQueryTemplates: vi.fn(async () => undefined),
  requestJsonWithError: vi.fn(async () => ({ success: true })),
}))

let queryClient = new MockQueryClient()
const useQueryClientMock = vi.fn(() => queryClient)
const useMutationMock = vi.fn((options: unknown) => options)

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => useQueryClientMock(),
  useMutation: (options: unknown) => useMutationMock(options),
}))

vi.mock('@/lib/query/mutations/mutation-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/mutations/mutation-shared')>(
    '@/lib/query/mutations/mutation-shared',
  )
  return {
    ...actual,
    invalidateQueryTemplates: mutationSharedMock.invalidateQueryTemplates,
    requestJsonWithError: mutationSharedMock.requestJsonWithError,
  }
})

import {
  useRegenerateCharacterGroup,
  useRegenerateSingleCharacterImage,
} from '@/lib/query/mutations/character-image-ops-mutations'
import {
  useRegenerateLocationGroup,
  useRegenerateSingleLocationImage,
} from '@/lib/query/mutations/location-image-mutations'

interface RegenerateMutation<TVariables> {
  mutationFn: (variables: TVariables) => Promise<unknown>
  onMutate: (variables: TVariables) => void
  onSettled?: (
    data: unknown,
    error: unknown,
    variables: TVariables,
    context: unknown,
  ) => void | Promise<void>
}

function getOverlay(projectId: string, key: string) {
  const map = queryClient.getQueryData<TaskTargetOverlayMap>(
    queryKeys.tasks.targetStateOverlay(projectId),
  ) || {}
  return map[key] || null
}

async function finishSubmit<TVariables>(
  mutation: RegenerateMutation<TVariables>,
  variables: TVariables,
) {
  mutation.onMutate(variables)
  const result = await mutation.mutationFn(variables)
  await mutation.onSettled?.(result, null, variables, undefined)
}

describe('regenerate image mutations', () => {
  beforeEach(() => {
    queryClient = new MockQueryClient()
    useQueryClientMock.mockClear()
    useMutationMock.mockClear()
    mutationSharedMock.invalidateQueryTemplates.mockClear()
    mutationSharedMock.requestJsonWithError.mockClear()
    mutationSharedMock.requestJsonWithError.mockResolvedValue({ success: true })
  })

  it('keeps character single-image regenerate loading without immediate asset invalidation', async () => {
    const projectId = 'project-1'
    const mutation = useRegenerateSingleCharacterImage(projectId) as unknown as RegenerateMutation<{
      characterId: string
      appearanceId: string
      imageIndex: number
    }>

    await finishSubmit(mutation, {
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      imageIndex: 2,
    })

    expect(getOverlay(projectId, 'CharacterAppearance:appearance-1')?.intent).toBe('regenerate')
    expect(mutationSharedMock.invalidateQueryTemplates).not.toHaveBeenCalledWith(
      queryClient,
      [queryKeys.projectAssets.all(projectId)],
    )
  })

  it('keeps character group regenerate loading without immediate asset invalidation', async () => {
    const projectId = 'project-1'
    const mutation = useRegenerateCharacterGroup(projectId) as unknown as RegenerateMutation<{
      characterId: string
      appearanceId: string
      count?: number
    }>

    await finishSubmit(mutation, {
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      count: 3,
    })

    expect(getOverlay(projectId, 'CharacterAppearance:appearance-1')?.intent).toBe('regenerate')
    expect(mutationSharedMock.invalidateQueryTemplates).not.toHaveBeenCalledWith(
      queryClient,
      [queryKeys.projectAssets.all(projectId)],
    )
  })

  it('keeps location single-image regenerate loading without immediate asset invalidation', async () => {
    const projectId = 'project-1'
    const mutation = useRegenerateSingleLocationImage(projectId) as unknown as RegenerateMutation<{
      locationId: string
      imageIndex: number
    }>

    await finishSubmit(mutation, {
      locationId: 'location-1',
      imageIndex: 1,
    })

    expect(getOverlay(projectId, 'LocationImage:location-1')?.intent).toBe('regenerate')
    expect(mutationSharedMock.invalidateQueryTemplates).not.toHaveBeenCalledWith(
      queryClient,
      [queryKeys.projectAssets.all(projectId)],
    )
  })

  it('keeps location group regenerate loading without immediate asset invalidation', async () => {
    const projectId = 'project-1'
    const mutation = useRegenerateLocationGroup(projectId) as unknown as RegenerateMutation<{
      locationId: string
      count?: number
    }>

    await finishSubmit(mutation, {
      locationId: 'location-1',
      count: 3,
    })

    expect(getOverlay(projectId, 'LocationImage:location-1')?.intent).toBe('regenerate')
    expect(mutationSharedMock.invalidateQueryTemplates).not.toHaveBeenCalledWith(
      queryClient,
      [queryKeys.projectAssets.all(projectId)],
    )
  })
})
