import type { AssetCapabilityMap, AssetFamily, AssetKind } from '@/lib/assets/contracts'

export type AssetKindRegistration = {
  kind: AssetKind
  family: AssetFamily
  supportsMultipleVariants: boolean
  editorSchema: AssetKind
  promptAssembler: AssetKind
  capabilities: AssetCapabilityMap
}

const assetKindRegistryMap: Record<AssetKind, AssetKindRegistration> = {
  character: {
    kind: 'character',
    family: 'visual',
    supportsMultipleVariants: true,
    editorSchema: 'character',
    promptAssembler: 'character',
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canCopyFromGlobal: true,
    },
  },
  location: {
    kind: 'location',
    family: 'visual',
    supportsMultipleVariants: true,
    editorSchema: 'location',
    promptAssembler: 'location',
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canCopyFromGlobal: true,
    },
  },
  prop: {
    kind: 'prop',
    family: 'visual',
    supportsMultipleVariants: true,
    editorSchema: 'prop',
    promptAssembler: 'prop',
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canCopyFromGlobal: true,
    },
  },
}

export const assetKindRegistry = Object.freeze(assetKindRegistryMap)

export function getAssetKindRegistration(kind: AssetKind): AssetKindRegistration {
  return assetKindRegistry[kind]
}
