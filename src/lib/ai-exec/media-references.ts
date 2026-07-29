type MediaReferenceOptions = {
  readonly referenceImages?: unknown
  readonly referenceAudios?: unknown
  readonly lastFrameImageUrl?: unknown
  readonly referenceVideoUrl?: unknown
}

function assertHttpsMediaUrl(value: unknown, field: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_HTTPS_REQUIRED:${field}`)
  }
}

function assertHttpsMediaArray(value: unknown, field: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`PROVIDER_MEDIA_REFERENCE_INVALID:${field}`)
  }
  value.forEach((item, index) => assertHttpsMediaUrl(item, `${field}[${String(index)}]`))
}

export function assertImageMediaReferencesUseHttps(options: unknown): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return
  const mediaOptions = options as MediaReferenceOptions
  assertHttpsMediaArray(mediaOptions.referenceImages, 'referenceImages')
}

export function assertVideoMediaReferencesUseHttps(input: {
  readonly imageUrl: string
  readonly options?: unknown
}): void {
  if (input.imageUrl) assertHttpsMediaUrl(input.imageUrl, 'imageUrl')
  if (!input.options || typeof input.options !== 'object' || Array.isArray(input.options)) return
  const mediaOptions = input.options as MediaReferenceOptions
  assertHttpsMediaArray(mediaOptions.referenceImages, 'referenceImages')
  assertHttpsMediaArray(mediaOptions.referenceAudios, 'referenceAudios')
  if (mediaOptions.lastFrameImageUrl !== undefined) {
    assertHttpsMediaUrl(mediaOptions.lastFrameImageUrl, 'lastFrameImageUrl')
  }
}

export function assertMusicMediaReferencesUseHttps(options: unknown): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return
  const mediaOptions = options as MediaReferenceOptions
  if (mediaOptions.referenceVideoUrl !== undefined) {
    assertHttpsMediaUrl(mediaOptions.referenceVideoUrl, 'referenceVideoUrl')
  }
}
