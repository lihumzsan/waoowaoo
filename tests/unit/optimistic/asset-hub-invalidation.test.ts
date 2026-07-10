import {
  beforeEach,
  describe,
  expect,
  invalidateGlobalCharacters,
  it,
  queryKeys,
  resetAssetHubQueryClient,
  useMutationMock,
  useQueryClientMock,
  type QueryClient,
} from './asset-hub-mutations.fixture'

let queryClient = resetAssetHubQueryClient()

describe('asset hub optimistic mutations', () => {
  beforeEach(() => {
    queryClient = resetAssetHubQueryClient()
    useQueryClientMock.mockClear()
    useMutationMock.mockClear()
  })

  it('global asset invalidation refreshes unified asset queries and legacy character queries', () => {
    invalidateGlobalCharacters(queryClient as unknown as QueryClient)

    expect(queryClient.invalidations.some((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.assets.all('global')[0]
        && key[1] === 'unified'
    })).toBe(true)

    expect(queryClient.invalidations.some((arg) => {
      const key = arg.queryKey || []
      return Array.isArray(key)
        && key[0] === queryKeys.globalAssets.characters()[0]
        && key[1] === 'characters'
    })).toBe(true)
  })
})
