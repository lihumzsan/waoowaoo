import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestJsonWithErrorMock = vi.hoisted(() => vi.fn(async () => ({ success: true })))
const invalidateQueryTemplatesMock = vi.hoisted(() => vi.fn())
const useMutationMock = vi.fn((options: unknown) => options)

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useMutation: (options: unknown) => useMutationMock(options),
}))

vi.mock('@/lib/query/mutations/mutation-shared', () => ({
  invalidateQueryTemplates: invalidateQueryTemplatesMock,
  requestJsonWithError: requestJsonWithErrorMock,
  requestTaskResponseWithError: vi.fn(),
}))

import { useConfirmProjectCharacterSelection } from '@/lib/query/mutations/character-profile-mutations'

interface ConfirmSelectionMutation {
  mutationFn: (variables: {
    characterId: string
    appearanceId: string
    selectedIndex: number
  }) => Promise<unknown>
}

describe('confirm project character selection mutation', () => {
  beforeEach(() => {
    requestJsonWithErrorMock.mockClear()
    invalidateQueryTemplatesMock.mockClear()
    useMutationMock.mockClear()
  })

  it('forwards selectedIndex in the confirm-selection request body', async () => {
    const mutation = useConfirmProjectCharacterSelection('project-1') as unknown as ConfirmSelectionMutation

    await mutation.mutationFn({
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      selectedIndex: 1,
    })

    expect(requestJsonWithErrorMock).toHaveBeenCalledWith(
      '/api/novel-promotion/project-1/character/confirm-selection',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          characterId: 'character-1',
          appearanceId: 'appearance-1',
          selectedIndex: 1,
        }),
      }),
      expect.any(String),
    )
  })
})
