type MediaReferenceOptions = {
  readonly referenceImages?: unknown
  readonly referenceAudios?: unknown
  readonly referenceVideos?: unknown
  readonly lastFrameImageUrl?: unknown
}
type MediaRequestIdentityInput = {
  readonly modality?: unknown
  readonly imageUrl?: unknown
  readonly options?: unknown
  readonly [key: string]: unknown
}

function stableMediaUrl(value: unknown, field: string): unknown {
  if (typeof value !== 'string' || !value) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

function stableMediaUrlArray(value: unknown, field: string): unknown {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  }
  return value.map((item, index) => stableMediaUrl(item, `${field}[${String(index)}]`))
}

/**
 * Builds the durable identity input for a media provider request. Signed S3
 * query credentials are transport capabilities and can change between Task
 * attempts; the object origin/path and every non-media option remain
 * identity-bearing. The original request object is never mutated and remains
 * the wire input used by the adapter.
 */
export function createMediaProviderRequestIdentity<T extends MediaRequestIdentityInput>(
  input: T,
): T {
  const rawOptions = input.options
  const options = rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)
    ? { ...(rawOptions as Record<string, unknown>) }
    : rawOptions
  const result: Record<string, unknown> = { ...input }
  if (input.modality === 'video' && input.imageUrl) {
    result.imageUrl = stableMediaUrl(input.imageUrl, 'imageUrl')
  }
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    if ('referenceImages' in options) {
      options.referenceImages = stableMediaUrlArray(options.referenceImages, 'referenceImages')
    }
    if ('referenceAudios' in options) {
      options.referenceAudios = stableMediaUrlArray(options.referenceAudios, 'referenceAudios')
    }
    if ('referenceVideos' in options) {
      options.referenceVideos = stableMediaUrlArray(options.referenceVideos, 'referenceVideos')
    }
    if ('lastFrameImageUrl' in options && options.lastFrameImageUrl !== undefined) {
      options.lastFrameImageUrl = stableMediaUrl(options.lastFrameImageUrl, 'lastFrameImageUrl')
    }
    result.options = options
  }
  return result as T
}
export function assertImageMediaReferencesUseAbsoluteHttpUrls(options: unknown): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return
  const mediaOptions = options as MediaReferenceOptions
  assertAbsoluteHttpMediaArray(mediaOptions.referenceImages, 'referenceImages')
}

export function assertVideoMediaReferencesUseAbsoluteHttpUrls(input: {
  readonly imageUrl: string
  readonly options?: unknown
}): void {
  if (input.imageUrl) assertAbsoluteHttpMediaUrl(input.imageUrl, 'imageUrl')
  if (!input.options || typeof input.options !== 'object' || Array.isArray(input.options)) return
  const mediaOptions = input.options as MediaReferenceOptions
  assertAbsoluteHttpMediaArray(mediaOptions.referenceImages, 'referenceImages')
  assertAbsoluteHttpMediaArray(mediaOptions.referenceAudios, 'referenceAudios')
  assertAbsoluteHttpMediaArray(mediaOptions.referenceVideos, 'referenceVideos')
  if (mediaOptions.lastFrameImageUrl !== undefined) {
    assertAbsoluteHttpMediaUrl(mediaOptions.lastFrameImageUrl, 'lastFrameImageUrl')
  }
}

function assertAbsoluteHttpMediaUrl(value: unknown, field: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  }
  if (url.username || url.password) {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_CREDENTIALS_FORBIDDEN:${field}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_SCHEME_UNSUPPORTED:${field}`)
  }
}

function assertAbsoluteHttpMediaArray(value: unknown, field: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  value.forEach((item, index) => assertAbsoluteHttpMediaUrl(item, `${field}[${String(index)}]`))
}
