import { resolveVideoInputMode } from './input-mode'

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

  images.forEach((image, index) => {
    const url = typeof image.url === 'string' ? image.url.trim() : ''
    if (!url) throw new Error('VIDEO_REFERENCE_IMAGE_URL_REQUIRED')
    const role = image.role

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
  const resolvedMode = resolveVideoInputMode(references.map((reference) => ({
    channel: 'image' as const,
    role: reference.role,
  })))

  const firstFrame = references.find((image) => image.role === 'first_frame')
  const lastFrame = references.find((image) => image.role === 'last_frame')
  const referenceImages = references.filter((image) => image.role === 'reference_image')

  if (resolvedMode.mode === 'first_frame' || resolvedMode.mode === 'first_last_frame') {
    if (!firstFrame) throw new Error('VIDEO_MODEL_FRAME_INPUT_INVALID')
    return {
      imageUrl: firstFrame.url,
      options: {
        ...(lastFrame ? { lastFrameImageUrl: lastFrame.url } : {}),
      },
    }
  }

  if (resolvedMode.mode === 'text_to_video') {
    return { imageUrl: '', options: {} }
  }
  return {
    imageUrl: '',
    options: { referenceImages: referenceImages.map((image) => image.url) },
  }
}
