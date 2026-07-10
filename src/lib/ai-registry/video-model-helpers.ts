import { resolveBuiltinCapabilitiesByModelKey } from './capabilities-catalog'

export function supportsAssetReferenceMultiReferenceVideoModel(modelKey: string): boolean {
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  return capabilities?.video?.assetReferenceMultiReference === true
}
