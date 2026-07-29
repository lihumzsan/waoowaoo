import { detectMimeFromBuffer, resolveMediaMimeType } from '@/lib/media/media-mime'
import { readOwnedMediaForGeneration } from '@/lib/media/outbound-owned-media'

const MAX_VIDEO_REFERENCE_AUDIO_BYTES = 15 * 1024 * 1024
const SUPPORTED_VIDEO_REFERENCE_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
])

export type OutboundAudioNormalizeErrorCode =
  | 'OUTBOUND_AUDIO_EMPTY_INPUT'
  | 'OUTBOUND_AUDIO_FORMAT_UNSUPPORTED'

export class OutboundAudioNormalizeError extends Error {
  readonly code: OutboundAudioNormalizeErrorCode
  readonly input: string

  constructor(input: {
    code: OutboundAudioNormalizeErrorCode
    mediaInput: string
    message: string
  }) {
    super(input.message)
    this.name = 'OutboundAudioNormalizeError'
    this.code = input.code
    this.input = input.mediaInput
  }
}

function normalizeAudioMimeType(mimeType: string): string {
  if (mimeType === 'audio/mp3') return 'audio/mpeg'
  if (mimeType === 'audio/x-wav' || mimeType === 'audio/wave') return 'audio/wav'
  return mimeType
}

export async function normalizeOwnedAudioToBase64ForGeneration(
  input: string,
  userId: string,
): Promise<string> {
  const normalizedInput = input.trim()
  if (!normalizedInput) {
    throw new OutboundAudioNormalizeError({
      code: 'OUTBOUND_AUDIO_EMPTY_INPUT',
      mediaInput: normalizedInput,
      message: 'outbound audio input is empty',
    })
  }

  const media = await readOwnedMediaForGeneration(normalizedInput, userId, {
    maxBytes: MAX_VIDEO_REFERENCE_AUDIO_BYTES,
    label: 'owned outbound video reference audio',
  })
  const detectedMimeType = detectMimeFromBuffer(media.buffer)
  const mimeType = normalizeAudioMimeType(
    detectedMimeType
      ?? resolveMediaMimeType(media.storageKey, media.declaredContentType, media.buffer),
  )
  if (!SUPPORTED_VIDEO_REFERENCE_AUDIO_MIME_TYPES.has(mimeType)) {
    throw new OutboundAudioNormalizeError({
      code: 'OUTBOUND_AUDIO_FORMAT_UNSUPPORTED',
      mediaInput: normalizedInput,
      message: `video reference audio must be MP3 or WAV, received ${mimeType}`,
    })
  }

  return `data:${mimeType};base64,${media.buffer.toString('base64')}`
}
