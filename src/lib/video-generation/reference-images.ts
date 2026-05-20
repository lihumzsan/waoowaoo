export type VideoReferenceImageRole = 'reference' | 'first_frame' | 'last_frame'

export type VideoReferenceImageSource = 'storyboard' | 'asset' | 'upload' | 'generated'

export interface VideoReferenceImageInput {
  readonly url: string
  readonly role?: VideoReferenceImageRole
  readonly order?: number
  readonly source?: VideoReferenceImageSource
}

export interface VideoReferenceImage {
  readonly url: string
  readonly role: VideoReferenceImageRole
  readonly order: number
  readonly source?: VideoReferenceImageSource
}

export interface ProviderVideoReferencePayload {
  readonly imageUrl: string
  readonly options: {
    readonly referenceImages?: string[]
    readonly lastFrameImageUrl?: string
  }
}

function validOrder(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeVideoReferenceImages(
  images: readonly VideoReferenceImageInput[],
): readonly VideoReferenceImage[] {
  const result: VideoReferenceImage[] = []
  const seenReferenceUrls = new Set<string>()
  let firstFrameSeen = false
  let lastFrameSeen = false

  images.forEach((image, index) => {
    const url = typeof image.url === 'string' ? image.url.trim() : ''
    if (!url) return
    const role = image.role ?? 'reference'

    if (role === 'first_frame') {
      if (firstFrameSeen) throw new Error('VIDEO_REFERENCE_FIRST_FRAME_DUPLICATE')
      firstFrameSeen = true
    }
    if (role === 'last_frame') {
      if (lastFrameSeen) throw new Error('VIDEO_REFERENCE_LAST_FRAME_DUPLICATE')
      lastFrameSeen = true
    }
    if (role === 'reference') {
      if (seenReferenceUrls.has(url)) return
      seenReferenceUrls.add(url)
    }

    result.push({
      url,
      role,
      order: validOrder(image.order, index + 1),
      ...(image.source ? { source: image.source } : {}),
    })
  })

  return result.sort((left, right) => left.order - right.order)
}

export function resolveProviderVideoReferencePayload(input: {
  readonly referenceImages?: readonly VideoReferenceImageInput[]
  readonly imageUrl?: string
  readonly legacyReferenceImages?: readonly string[]
  readonly legacyLastFrameImageUrl?: string
}): ProviderVideoReferencePayload {
  const unifiedReferences = normalizeVideoReferenceImages(input.referenceImages ?? [])
  const legacyReferences = normalizeVideoReferenceImages([
    ...(input.imageUrl ? [{ url: input.imageUrl, role: input.legacyLastFrameImageUrl ? 'first_frame' as const : 'reference' as const, order: 1 }] : []),
    ...(input.legacyLastFrameImageUrl ? [{ url: input.legacyLastFrameImageUrl, role: 'last_frame' as const, order: 2 }] : []),
    ...(input.legacyReferenceImages ?? []).map((url, index) => ({ url, role: 'reference' as const, order: index + 3 })),
  ])
  const references = unifiedReferences.length > 0 ? unifiedReferences : legacyReferences
  if (references.length === 0) throw new Error('VIDEO_REFERENCE_IMAGE_REQUIRED')

  const firstFrame = references.find((image) => image.role === 'first_frame')
  const lastFrame = references.find((image) => image.role === 'last_frame')
  if (lastFrame) {
    const firstFrameUrl = firstFrame?.url ?? references.find((image) => image.role === 'reference')?.url
    if (!firstFrameUrl) throw new Error('VIDEO_REFERENCE_FIRST_FRAME_REQUIRED')
    return {
      imageUrl: firstFrameUrl,
      options: { lastFrameImageUrl: lastFrame.url },
    }
  }

  const normalReferences = references.filter((image) => image.role === 'reference')
  const primaryReference = normalReferences[0]
  if (!primaryReference) throw new Error('VIDEO_REFERENCE_IMAGE_REQUIRED')
  if (normalReferences.length === 1) {
    return {
      imageUrl: primaryReference.url,
      options: {},
    }
  }
  return {
    imageUrl: primaryReference.url,
    options: { referenceImages: normalReferences.map((image) => image.url) },
  }
}
