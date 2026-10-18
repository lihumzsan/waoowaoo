import { z } from 'zod'

/** Exact character source; context lineage only, never Qwen media conditioning. */
export const VOICE_CHARACTER_REFERENCE_ROLE = 'voice_character'

export const VOICE_DESIGN_LANGUAGE_OPTIONS = [
  'Auto', 'Chinese', 'English', 'Japanese', 'Korean', 'German',
  'French', 'Russian', 'Portuguese', 'Spanish', 'Italian',
] as const

export const VOICE_DESIGN_DESCRIPTION_MAX_CHARS = 4_000
export const VOICE_DESIGN_TEXT_MAX_CHARS = 10_000

export const voiceDesignDescriptionSchema = z.string().min(1).max(VOICE_DESIGN_DESCRIPTION_MAX_CHARS)
  .refine((value) => value.trim().length > 0, 'prompt must contain non-whitespace content.')

export const voiceDesignGenerationOptionsSchema = z.object({
  previewText: z.string().min(1).max(VOICE_DESIGN_TEXT_MAX_CHARS)
    .refine((value) => value.trim().length > 0, 'previewText must contain non-whitespace content.'),
  language: z.enum(VOICE_DESIGN_LANGUAGE_OPTIONS),
  outputFormat: z.literal('wav'),
}).strict()

export type VoiceDesignGenerationOptions = z.infer<typeof voiceDesignGenerationOptionsSchema>
