import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  useQueryClientMock,
  useMutationMock,
  requestJsonWithErrorMock,
} = vi.hoisted(() => ({
  useQueryClientMock: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  useMutationMock: vi.fn((options: unknown) => options),
  requestJsonWithErrorMock: vi.fn(),
}))

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
    invalidateQueryTemplates: vi.fn(),
    requestJsonWithError: requestJsonWithErrorMock,
  }
})

import { useConfirmProjectLocationSelection } from '@/lib/query/mutations/location-management-mutations'

interface ConfirmLocationSelectionMutation {
  mutationFn: (variables: { locationId: string }) => Promise<unknown>
}

describe('project location-backed confirm mutations', () => {
  beforeEach(() => {
    useQueryClientMock.mockClear()
    useMutationMock.mockClear()
    requestJsonWithErrorMock.mockReset()
    requestJsonWithErrorMock.mockResolvedValue({ success: true })
  })

  it('routes prop confirmation to the unified asset select-render endpoint', async () => {
    const mutation = useConfirmProjectLocationSelection('project-1', 'prop') as unknown as ConfirmLocationSelectionMutation

    await mutation.mutationFn({ locationId: 'prop-1' })

    expect(requestJsonWithErrorMock).toHaveBeenCalledTimes(1)
    expect(requestJsonWithErrorMock).toHaveBeenCalledWith(
      '/api/assets/prop-1/select-render',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          kind: 'prop',
          projectId: 'project-1',
          confirm: true,
        }),
      },
      '确认选择失败',
    )
  })
})
