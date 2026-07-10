import {
  beforeEach,
  buildGlobalCharacter,
  buildUnifiedCharacter,
  describe,
  expect,
  it,
  queryKeys,
  resetAssetHubQueryClient,
  useCreateAssetHubCharacter,
  useGenerateCharacterImage,
  useMutationMock,
  useQueryClientMock,
  type AssetSummary,
  type CreateCharacterMutation,
  type GenerateCharacterMutation,
  type GlobalCharacter,
} from './asset-hub-mutations.fixture'

let queryClient = resetAssetHubQueryClient()

describe('asset hub optimistic mutations', () => {
  beforeEach(() => {
    queryClient = resetAssetHubQueryClient()
    useQueryClientMock.mockClear()
    useMutationMock.mockClear()
  })

  it('seeds created global characters into unified asset caches before refetch', () => {
    const allCharactersKey = queryKeys.globalAssets.characters()
    const folderCharactersKey = queryKeys.globalAssets.characters('folder-1')
    const otherFolderCharactersKey = queryKeys.globalAssets.characters('folder-2')
    const unifiedAssetsKey = queryKeys.assets.list({ scope: 'global' })
    const folderUnifiedAssetsKey = queryKeys.assets.list({ scope: 'global', folderId: 'folder-1' })
    const locationsUnifiedAssetsKey = queryKeys.assets.list({ scope: 'global', kind: 'location' })

    queryClient.seedQuery(allCharactersKey, [])
    queryClient.seedQuery(folderCharactersKey, [])
    queryClient.seedQuery(otherFolderCharactersKey, [])
    queryClient.seedQuery(unifiedAssetsKey, [])
    queryClient.seedQuery(folderUnifiedAssetsKey, [])
    queryClient.seedQuery(locationsUnifiedAssetsKey, [])

    const mutation = useCreateAssetHubCharacter() as unknown as CreateCharacterMutation
    mutation.onSuccess(
      { character: buildGlobalCharacter(null) },
      { name: 'Hero', description: 'desc', folderId: 'folder-1' },
    )

    expect(queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)?.[0]?.id).toBe('character-1')
    expect(queryClient.getQueryData<GlobalCharacter[]>(folderCharactersKey)?.[0]?.id).toBe('character-1')
    expect(queryClient.getQueryData<GlobalCharacter[]>(otherFolderCharactersKey)).toEqual([])
    expect(queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)?.[0]?.id).toBe('character-1')
    expect(queryClient.getQueryData<AssetSummary[]>(folderUnifiedAssetsKey)?.[0]?.id).toBe('character-1')
    expect(queryClient.getQueryData<AssetSummary[]>(locationsUnifiedAssetsKey)).toEqual([])
  })

  it('does not fabricate a reference-to-character task overlay without a returned taskId', () => {
    const unifiedAssetsKey = queryKeys.assets.list({ scope: 'global' })
    queryClient.seedQuery(unifiedAssetsKey, [])

    const mutation = useCreateAssetHubCharacter() as unknown as CreateCharacterMutation
    mutation.onSuccess(
      { character: buildGlobalCharacter(null) },
      {
        name: 'Hero',
        description: 'desc',
        folderId: 'folder-1',
        generateFromReference: true,
      },
    )

    const unified = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    const overlay = queryClient.getQueryData<Record<string, { phase: string; runningTaskType: string | null }>>(
      queryKeys.tasks.targetStateOverlay('global-asset-hub'),
    )
    const variantTaskTypes = unified?.[0]?.kind === 'character'
      ? unified[0].variants[0]?.taskRefs[0]?.types
      : []
    expect(variantTaskTypes).toContain('asset_hub_reference_to_character')
    expect(overlay?.['GlobalCharacterAppearance:appearance-1']).toBeUndefined()
  })

  it('waits for the real character image taskId before exposing running state', async () => {
    const allCharactersKey = queryKeys.globalAssets.characters()
    const unifiedAssetsKey = queryKeys.assets.list({ scope: 'global' })
    queryClient.seedQuery(allCharactersKey, [buildGlobalCharacter(null)])
    queryClient.seedQuery(unifiedAssetsKey, [buildUnifiedCharacter(null)])

    const mutation = useGenerateCharacterImage() as unknown as GenerateCharacterMutation
    const context = await mutation.onMutate({
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      appearanceIndex: 0,
    })

    const afterLegacy = queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)
    const afterUnified = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    const overlay = queryClient.getQueryData<Record<string, { phase: string }>>(
      queryKeys.tasks.targetStateOverlay('global-asset-hub'),
    )
    expect(afterLegacy?.[0]?.appearances[0]?.imageTaskRunning).toBe(false)
    expect(afterUnified?.[0]?.taskState.isRunning).toBe(false)
    expect(afterUnified?.[0]?.kind === 'character' ? afterUnified[0].variants[0]?.taskState.isRunning : true).toBe(false)
    expect(overlay?.['GlobalCharacterAppearance:appearance-1']).toBeUndefined()

    mutation.onSuccess({ taskId: 'task-1' }, { appearanceId: 'appearance-1' })

    const confirmedOverlay = queryClient.getQueryData<Record<string, { runningTaskId: string | null; runningTaskType: string | null }>>(
      queryKeys.tasks.targetStateOverlay('global-asset-hub'),
    )
    expect(confirmedOverlay?.['GlobalCharacterAppearance:appearance-1']?.runningTaskId).toBe('task-1')
    expect(confirmedOverlay?.['GlobalCharacterAppearance:appearance-1']?.runningTaskType).toBe('asset_hub_image')

    mutation.onError(new Error('generate failed'), { appearanceId: 'appearance-1' }, context)

    const rolledBackLegacy = queryClient.getQueryData<GlobalCharacter[]>(allCharactersKey)
    const rolledBackUnified = queryClient.getQueryData<AssetSummary[]>(unifiedAssetsKey)
    const rolledBackOverlay = queryClient.getQueryData<Record<string, unknown>>(
      queryKeys.tasks.targetStateOverlay('global-asset-hub'),
    )
    expect(rolledBackLegacy?.[0]?.appearances[0]?.imageTaskRunning).toBe(false)
    expect(rolledBackUnified?.[0]?.taskState.isRunning).toBe(false)
    expect(rolledBackOverlay?.['GlobalCharacterAppearance:appearance-1']).toBeUndefined()
  })
})
