import { MAX_VIDEO_BYTES } from '@/lib/http/body-limits'
import { resolveOwnedMediaForGeneration } from '@/lib/media/outbound-owned-media'

const SUPPORTED_PROVIDER_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

export async function resolveOwnedVideoUrlForGeneration(
  input: string,
  userId: string,
): Promise<string> {
  const media = await resolveOwnedMediaForGeneration(input, userId, {
    maxBytes: MAX_VIDEO_BYTES,
    label: 'owned outbound video reference',
    supportedMimeTypes: SUPPORTED_PROVIDER_VIDEO_MIME_TYPES,
  })
  return media.url
}
