export type VideoReferenceImageRole = 'reference_image' | 'first_frame' | 'last_frame'

export type VideoReferenceImageSource = 'asset' | 'upload' | 'generated'

export interface VideoReferenceImageInput {
  readonly url: string
  readonly role: VideoReferenceImageRole
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
    if (!url) throw new Error('VIDEO_REFERENCE_IMAGE_URL_REQUIRED')
    const role = image.role

    if (role === 'first_frame') {
      if (firstFrameSeen) throw new Error('VIDEO_REFERENCE_FIRST_FRAME_DUPLICATE')
      firstFrameSeen = true
    }
    if (role === 'last_frame') {
      if (lastFrameSeen) throw new Error('VIDEO_REFERENCE_LAST_FRAME_DUPLICATE')
      lastFrameSeen = true
    }
    if (role === 'reference_image') {
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

/**
 * Converts already-explicit Workspace video roles into the provider-neutral
 * transport fields. No reference is ever promoted to a frame by count.
 */
export function resolveProviderVideoReferencePayload(input: {
  readonly referenceImages: readonly VideoReferenceImageInput[]
}): ProviderVideoReferencePayload {
  const references = normalizeVideoReferenceImages(input.referenceImages)
  if (references.length === 0) {
    return { imageUrl: '', options: {} }
  }

  const firstFrame = references.find((image) => image.role === 'first_frame')
  const lastFrame = references.find((image) => image.role === 'last_frame')
  const referenceImages = references.filter((image) => image.role === 'reference_image')

  if (firstFrame || lastFrame) {
    if (!firstFrame) throw new Error('VIDEO_REFERENCE_FIRST_FRAME_REQUIRED')
    if (referenceImages.length > 0) throw new Error('VIDEO_REFERENCE_MODE_CONFLICT')
    return {
      imageUrl: firstFrame.url,
      options: {
        ...(lastFrame ? { lastFrameImageUrl: lastFrame.url } : {}),
      },
    }
  }

  if (referenceImages.length === 0) {
    throw new Error('VIDEO_REFERENCE_IMAGE_REQUIRED')
  }
  return {
    imageUrl: '',
    options: { referenceImages: referenceImages.map((image) => image.url) },
  }
}
