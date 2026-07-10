import {
  beforeEach,
  buildGlobalCharacter,
  buildGlobalLocation,
  buildUnifiedCharacter,
  buildUnifiedLocation,
  describe,
  expect,
  it,
  queryKeys,
  resetAssetHubQueryClient,
  useDeleteAssetHubLocation,
  useMutationMock,
  useQueryClientMock,
  useSelectCharacterImage,
  type AssetSummary,
  type DeleteLocationMutation,
  type GlobalCharacter,
  type GlobalLocation,
  type SelectCharacterMutation,
} from './asset-hub-mutations.fixture'

let queryClient = resetAssetHubQueryClient()

describe('asset hub optimistic mutations', () => {
  beforeEach(() => {
    queryClient = resetAssetHubQueryClient()
    useQueryClientMock.mockClear()
    useMutationMock.mockClear()
  })

  it('updates all character query caches optimistically and ignores stale rollback', async () => {
    const allCharactersKey = queryKeys.globalAssets.characters()
    const folderCharactersKey = queryKeys.globalAssets.characters('folder-1')
    const unifiedAssetsKey = queryKeys.assets.list({ scope: 'global' })
    queryClient.seedQuery(allCharactersKey, [buildGlobalCharacter(0)])
    queryClient.seedQuery(folderCharactersKey, [buildGlobalCharacter(0)])
    queryClient.seedQuery(unifiedAssetsKey, [buildUnifiedCharacter(0)])

    const mutation = useSelectCharacterImage() as unknown as SelectCharacterMutation
    const firstVariables = {
      characterId: 'character-1',
      appearanceIndex: 0,
      imageIndex: 1,
    }
    const secondVariables = {
      characterId: 'character-1',
      appearanceIndex: 0,
      imageIndex: 2,
    }

    const firstContext = await mutation.onMutate(firstVariables)
    const afterFirstAll = queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)
    const afterFirstFolder = queryClient.getQueryData<GlobalCharacter[]>(folderCharactersKey)
    const afterFirstUnified = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    expect(afterFirstAll?.[0]?.appearances[0]?.selectedIndex).toBe(1)
    expect(afterFirstFolder?.[0]?.appearances[0]?.selectedIndex).toBe(1)
    expect(afterFirstUnified?.[0]?.kind === 'character' ? afterFirstUnified[0].variants[0]?.selectionState.selectedRenderIndex : null).toBe(1)

    const secondContext = await mutation.onMutate(secondVariables)
    const afterSecondAll = queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)
    const afterSecondUnified = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    expect(afterSecondAll?.[0]?.appearances[0]?.selectedIndex).toBe(2)
    expect(afterSecondUnified?.[0]?.kind === 'character' ? afterSecondUnified[0].variants[0]?.selectionState.selectedRenderIndex : null).toBe(2)

    mutation.onError(new Error('first failed'), firstVariables, firstContext)
    const afterStaleError = queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)
    const unifiedAfterStaleError = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    expect(afterStaleError?.[0]?.appearances[0]?.selectedIndex).toBe(2)
    expect(unifiedAfterStaleError?.[0]?.kind === 'character' ? unifiedAfterStaleError[0].variants[0]?.selectionState.selectedRenderIndex : null).toBe(2)

    mutation.onError(new Error('second failed'), secondVariables, secondContext)
    const afterLatestRollback = queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)
    const unifiedAfterLatestRollback = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    expect(afterLatestRollback?.[0]?.appearances[0]?.selectedIndex).toBe(1)
    expect(unifiedAfterLatestRollback?.[0]?.kind === 'character' ? unifiedAfterLatestRollback[0].variants[0]?.selectionState.selectedRenderIndex : null).toBe(1)
  })

  it('optimistically removes location and restores on error', async () => {
    const allLocationsKey = queryKeys.globalAssets.locations()
    const folderLocationsKey = queryKeys.globalAssets.locations('folder-1')
    const unifiedAssetsKey = queryKeys.assets.list({ scope: 'global' })
    queryClient.seedQuery(allLocationsKey, [buildGlobalLocation('loc-1'), buildGlobalLocation('loc-2')])
    queryClient.seedQuery(folderLocationsKey, [buildGlobalLocation('loc-1')])
    queryClient.seedQuery(unifiedAssetsKey, [buildUnifiedLocation('loc-1'), buildUnifiedLocation('loc-2')])

    const mutation = useDeleteAssetHubLocation() as unknown as DeleteLocationMutation
    const context = await mutation.onMutate('loc-1')

    const afterDeleteAll = queryClient.getQueryData<GlobalLocation[]>(allLocationsKey)
    const afterDeleteFolder = queryClient.getQueryData<GlobalLocation[]>(folderLocationsKey)
    const unifiedAfterDelete = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    expect(afterDeleteAll?.map((item) => item.id)).toEqual(['loc-2'])
    expect(afterDeleteFolder).toEqual([])
    expect(unifiedAfterDelete?.map((item) => item.id)).toEqual(['loc-2'])

    mutation.onError(new Error('delete failed'), 'loc-1', context)

    const rolledBackAll = queryClient.getQueryData<GlobalLocation[]>(allLocationsKey)
    const rolledBackFolder = queryClient.getQueryData<GlobalLocation[]>(folderLocationsKey)
    const unifiedAfterRollback = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    expect(rolledBackAll?.map((item) => item.id)).toEqual(['loc-1', 'loc-2'])
    expect(rolledBackFolder?.map((item) => item.id)).toEqual(['loc-1'])
    expect(unifiedAfterRollback?.map((item) => item.id)).toEqual(['loc-1', 'loc-2'])
  })
})
