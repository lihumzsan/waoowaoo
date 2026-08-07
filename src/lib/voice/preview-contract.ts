import type { VOICE_DESIGN_LANGUAGE_OPTIONS } from '@/lib/ai-registry/voice-design-contract'

export const VOICE_PREVIEW_TARGET_MIN_SECONDS = 5
export const VOICE_PREVIEW_TARGET_MAX_SECONDS = 8

const MIN_CJK_PREVIEW_CHARACTERS = 24
const MIN_WORD_BASED_PREVIEW_WORDS = 12
const CJK_LANGUAGES = new Set<VoiceDesignLanguage>(['Chinese', 'Japanese', 'Korean'])
const CJK_CHARACTER_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const SIGNIFICANT_CHARACTER_PATTERN = /[\p{L}\p{N}]/u
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu

type VoiceDesignLanguage = typeof VOICE_DESIGN_LANGUAGE_OPTIONS[number]

export function voicePreviewTargetIssue(input: {
  readonly previewText: string
  readonly language: VoiceDesignLanguage
}): string | null {
  const text = input.previewText.trim()
  const usesCjkTarget = CJK_LANGUAGES.has(input.language) || CJK_CHARACTER_PATTERN.test(text)
  if (usesCjkTarget) {
    const characters = Array.from(text).filter((character) => SIGNIFICANT_CHARACTER_PATTERN.test(character)).length
    return characters >= MIN_CJK_PREVIEW_CHARACTERS
      ? null
      : `previewText must contain at least ${String(MIN_CJK_PREVIEW_CHARACTERS)} meaningful CJK characters to target approximately ${String(VOICE_PREVIEW_TARGET_MIN_SECONDS)}-${String(VOICE_PREVIEW_TARGET_MAX_SECONDS)} seconds.`
  }
  const words = text.match(WORD_PATTERN)?.length ?? 0
  return words >= MIN_WORD_BASED_PREVIEW_WORDS
    ? null
    : `previewText must contain at least ${String(MIN_WORD_BASED_PREVIEW_WORDS)} words to target approximately ${String(VOICE_PREVIEW_TARGET_MIN_SECONDS)}-${String(VOICE_PREVIEW_TARGET_MAX_SECONDS)} seconds.`
}
