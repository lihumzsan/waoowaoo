import { describe, expect, it } from 'vitest'
import { inspectAssetScopeOwnershipContract } from '../../../scripts/guards/asset-scope-ownership-guard.mjs'

const valid = {
  authority: [
    'requireOwnedAssetProject',
    'requireOwnedAssetTarget',
    'requireOwnedAssetVariant',
    'requireAssetBodyVariantOwnership',
    'project: { userId: input.access.userId }',
    'assetKind: input.kind',
  ].join('\n'),
  actions: [
    'await requireAssetBodyVariantOwnership(input)',
    'await requireAssetBodyVariantOwnership(input, client)',
    'await requireOwnedAssetTarget(input)',
    'await requireOwnedAssetVariant(input)',
    'await requireOwnedAssetProject(input.access)',
    'export async function copyAssetFromGlobal() {',
    'requireOwnedAssetTarget(source)',
    'requireOwnedAssetTarget(target)',
    '}',
    'async function copyCharacterFromGlobal() {}',
    'deleteProjectLocationBackedAsset(input.assetId)',
    'deleteGlobalLocationBackedAsset(input.assetId)',
  ].join('\n'),
  upload: 'await requireOwnedAssetTarget(target)\nawait uploadObject(bytes)',
  apiOperations: [
    'api_assets_copy_from_global: defineOperation({',
    'executeInTransaction: async () => {}',
    '})',
    'api_assets_update_variant: defineOperation({})',
  ].join('\n'),
  locationBackedCallers: ['src/lib/assets/services/asset-actions.ts'],
}

describe('asset scope ownership architecture guard', () => {
  it('accepts the single scoped authority and atomic copy path', () => {
    expect(inspectAssetScopeOwnershipContract(valid)).toEqual([])
  })

  it('rejects a missing target check, non-transactional copy, and destructive bypass', () => {
    const violations = inspectAssetScopeOwnershipContract({
      ...valid,
      actions: valid.actions.replace('requireOwnedAssetTarget(target)', 'rawTargetLookup(target)'),
      apiOperations: valid.apiOperations.replace('executeInTransaction:', 'execute:'),
      locationBackedCallers: [
        'src/lib/assets/services/asset-actions.ts',
        'src/lib/operations/unsafe-delete.ts',
      ],
    })
    expect(violations).toContain('copyAssetFromGlobal must authorize exactly one global source and one project target')
    expect(violations).toContain('copy operation must validate and replace inside one transaction')
    expect(violations).toContain('location-backed destructive helpers must only be called through scoped asset actions')
  })
})

