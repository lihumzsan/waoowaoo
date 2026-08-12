export const MOSS_TTS_REFERENCE_AUDIO_MAX_BYTES = 15 * 1024 * 1024

export const MOSS_TTS_REFERENCE_AUDIO_SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/flac',
])

const MOSS_TTS_REFERENCE_AUDIO_MIME_ALIASES: Readonly<Record<string, string>> = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-flac': 'audio/flac',
}

export function normalizeMossTtsReferenceAudioMimeType(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return MOSS_TTS_REFERENCE_AUDIO_MIME_ALIASES[normalized] ?? normalized
}

export function validateMossTtsReferenceAudioMetadata(input: {
  readonly mimeType: string | null | undefined
  readonly sizeBytes: bigint | number | null | undefined
}): { readonly mimeType: string; readonly sizeBytes: number } {
  if (typeof input.mimeType !== 'string' || !input.mimeType.trim()) {
    throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_MIME_TYPE_MISSING')
  }
  const mimeType = normalizeMossTtsReferenceAudioMimeType(input.mimeType)
  if (!MOSS_TTS_REFERENCE_AUDIO_SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_MIME_TYPE_UNSUPPORTED')
  }
  if (input.sizeBytes === null || input.sizeBytes === undefined) {
    throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_SIZE_BYTES_MISSING')
  }
  const sizeBytes = typeof input.sizeBytes === 'bigint'
    ? input.sizeBytes
    : Number.isSafeInteger(input.sizeBytes) ? BigInt(input.sizeBytes) : null
  if (sizeBytes === null || sizeBytes <= BigInt(0)) {
    throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_SIZE_BYTES_INVALID')
  }
  if (sizeBytes > BigInt(MOSS_TTS_REFERENCE_AUDIO_MAX_BYTES)) {
    throw new Error('COMFYUI_MOSS_TTS_REFERENCE_AUDIO_TOO_LARGE')
  }
  return { mimeType, sizeBytes: Number(sizeBytes) }
}
