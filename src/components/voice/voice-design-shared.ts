export const DEFAULT_VOICE_SCHEME_COUNT = 3
export const MIN_VOICE_SCHEME_COUNT = 1
export const MAX_VOICE_SCHEME_COUNT = 10

export type VoiceDesignMutationPayload = {
  voicePrompt: string
  previewText: string
  preferredName: string
  language: 'zh'
  characterId?: string
}

export type VoiceDesignMutationResult = {
  voiceId?: string
  audioBase64?: string
  responseFormat?: string
  detail?: string
  finalPrompt?: string
  normalizedVoicePrompt?: string
}

export type GeneratedVoice = {
  voiceId: string
  audioBase64: string
  audioUrl: string
}

export function normalizeVoiceSchemeCount(input: string | number | undefined): number {
  const rawValue = typeof input === 'number' ? input : Number.parseInt(input ?? '', 10)
  if (!Number.isFinite(rawValue)) return DEFAULT_VOICE_SCHEME_COUNT
  return Math.min(MAX_VOICE_SCHEME_COUNT, Math.max(MIN_VOICE_SCHEME_COUNT, rawValue))
}

export function createVoiceDesignPreferredName(index: number, now: () => number = Date.now): string {
  return `voice_${now().toString(36)}_${index + 1}`.slice(0, 16)
}

function inferAudioMimeType(audioBase64: string, mimeHint?: string): string {
  const normalizedHint = mimeHint?.split(';')[0]?.trim().toLowerCase()
  if (normalizedHint?.startsWith('audio/')) return normalizedHint

  try {
    const compact = audioBase64.replace(/^data:[^,]+,/, '').replace(/\s/g, '')
    const binary = atob(compact.slice(0, 48))
    const bytes = Array.from(binary, (char) => char.charCodeAt(0))
    const ascii = String.fromCharCode(...bytes.slice(0, 12))

    if (ascii.startsWith('fLaC')) return 'audio/flac'
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav'
    if (ascii.startsWith('OggS')) return 'audio/ogg'
    if (ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  } catch {
    // Fall through to the legacy default if the preview payload cannot be sniffed.
  }

  return 'audio/wav'
}

interface GenerateVoiceDesignOptionsParams {
  count: string | number | undefined
  voicePrompt: string
  previewText: string
  defaultPreviewText: string
  language?: 'zh'
  onDesignVoice: (payload: VoiceDesignMutationPayload) => Promise<VoiceDesignMutationResult>
  createPreferredName?: (index: number) => string
  onVoiceGenerated?: (voice: GeneratedVoice, meta: { index: number; total: number }) => void
}

export async function generateVoiceDesignOptions({
  count,
  voicePrompt,
  previewText,
  defaultPreviewText,
  language = 'zh',
  onDesignVoice,
  createPreferredName = (index) => createVoiceDesignPreferredName(index),
  onVoiceGenerated,
}: GenerateVoiceDesignOptionsParams): Promise<GeneratedVoice[]> {
  const trimmedPrompt = voicePrompt.trim()
  if (!trimmedPrompt) throw new Error('VOICE_PROMPT_REQUIRED')

  const resolvedPreviewText = previewText.trim() || defaultPreviewText
  const resolvedCount = normalizeVoiceSchemeCount(count)
  const voices: GeneratedVoice[] = []

  for (let index = 0; index < resolvedCount; index += 1) {
    const result = await onDesignVoice({
      voicePrompt: trimmedPrompt,
      previewText: resolvedPreviewText,
      preferredName: createPreferredName(index),
      language,
    })

    if (!result.audioBase64) continue
    if (typeof result.voiceId !== 'string' || result.voiceId.length === 0) {
      throw new Error('VOICE_DESIGN_INVALID_RESPONSE: missing voiceId')
    }

    const voice = {
      voiceId: result.voiceId,
      audioBase64: result.audioBase64,
      audioUrl: `data:${inferAudioMimeType(result.audioBase64, result.responseFormat)};base64,${result.audioBase64}`,
    }
    voices.push(voice)
    onVoiceGenerated?.(voice, {
      index,
      total: resolvedCount,
    })
  }

  if (voices.length === 0) throw new Error('VOICE_DESIGN_EMPTY_RESULT')

  return voices
}
