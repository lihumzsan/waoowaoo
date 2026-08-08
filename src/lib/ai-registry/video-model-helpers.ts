import { resolveBuiltinCapabilitiesByModelKey } from './capabilities-catalog'

export function supportsAssetReferenceMultiReferenceVideoModel(modelKey: string): boolean {
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  return capabilities?.video?.assetReferenceMultiReference === true
}

export function requireVideoModelMaxReferenceImages(modelKey: string): number {
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  const limit = capabilities?.video?.maxReferenceImages
  if (!Number.isInteger(limit) || !limit || limit <= 0) {
    throw new Error(`VIDEO_MODEL_MAX_REFERENCE_IMAGES_REQUIRED:${modelKey}`)
  }
  return limit
}
