import { z } from 'zod'
import {
  MUSIC_KEY_SCALE_VALUES,
  MUSIC_TIME_SIGNATURE_VALUES,
} from './music-parameter-contract'
import {
  musicScoreGenerationOptionsSchema,
  type MusicScoreGenerationOptions,
} from '@/lib/music/score-specification'
import type { AudioGenerationItem } from './generation-request'
import type { WorkspaceResourceJsonValue } from './contracts'

export const audioExecutionModeSchema = z.enum([
  'sound',
  'prompt_music',
  'composition_music',
])

export type AudioExecutionMode = z.infer<typeof audioExecutionModeSchema>

const providerPromptSchema = z.string().min(1).max(100_000)
  .refine((value) => value.trim().length > 0, 'prompt must contain non-whitespace content.')

const negativePromptSchema = z.string().max(100_000)
  .refine((value) => value.trim().length > 0, 'negativePrompt must contain non-whitespace content.')

export const musicLyricsSchema = z.string().min(1).max(100_000)
  .refine((value) => value.trim().length > 0, 'lyrics must contain non-whitespace content.')
  .describe('Exact provider-ready vocal lyrics. The server validates and freezes them verbatim.')

export function validateMusicLyricsContract(
  item: { readonly vocalMode?: 'instrumental' | 'vocal'; readonly lyrics?: string },
  context: z.RefinementCtx,
): void {
  if (item.vocalMode === 'vocal' && !item.lyrics) {
    context.addIssue({ code: 'custom', path: ['lyrics'], message: 'lyrics are required for vocal music.' })
  }
  if (item.vocalMode === 'instrumental' && item.lyrics !== undefined) {
    context.addIssue({ code: 'custom', path: ['lyrics'], message: 'lyrics are forbidden for instrumental music.' })
  }
}

export const soundGenerationOptionsSchema = z.object({
  durationSeconds: z.number().int().min(1).max(30),
  negativePrompt: negativePromptSchema.optional(),
  outputFormat: z.literal('mp3'),
}).strict()

export const promptMusicGenerationOptionsSchema = z.object({
  durationSeconds: z.number().int().min(1).max(600),
  providerDurationSeconds: z.number().int().min(1).max(600).optional(),
  negativePrompt: negativePromptSchema.optional(),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  lyrics: musicLyricsSchema.optional(),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  keyScale: z.enum(MUSIC_KEY_SCALE_VALUES).optional(),
  timeSignature: z.enum(MUSIC_TIME_SIGNATURE_VALUES).optional(),
  outputFormat: z.enum(['mp3', 'wav']),
}).strict().superRefine(validateMusicLyricsContract)

export type SoundGenerationOptions = z.infer<typeof soundGenerationOptionsSchema>
export type PromptMusicGenerationOptions = z.infer<typeof promptMusicGenerationOptionsSchema>

const soundAudioExecutionSchema = z.object({
  mode: z.literal('sound'),
  audioKind: z.literal('sound'),
  prompt: providerPromptSchema,
  durationSeconds: z.number().int().min(1).max(30),
  generationOptions: soundGenerationOptionsSchema,
}).strict().superRefine((execution, context) => {
  if (execution.durationSeconds !== execution.generationOptions.durationSeconds) {
    context.addIssue({
      code: 'custom',
      path: ['durationSeconds'],
      message: 'Sound duration must match frozen generationOptions.',
    })
  }
})

const promptMusicAudioExecutionSchema = z.object({
  mode: z.literal('prompt_music'),
  audioKind: z.literal('music'),
  prompt: providerPromptSchema,
  durationSeconds: z.number().int().min(1).max(600),
  generationOptions: promptMusicGenerationOptionsSchema,
}).strict().superRefine((execution, context) => {
  if (execution.durationSeconds !== execution.generationOptions.durationSeconds) {
    context.addIssue({
      code: 'custom',
      path: ['durationSeconds'],
      message: 'Prompt music duration must match frozen generationOptions.',
    })
  }
})

const compositionMusicAudioExecutionSchema = z.object({
  mode: z.literal('composition_music'),
  audioKind: z.literal('music'),
  prompt: z.null(),
  durationSeconds: z.null(),
  generationOptions: musicScoreGenerationOptionsSchema,
}).strict()

export const frozenAudioExecutionSchema = z.discriminatedUnion('mode', [
  soundAudioExecutionSchema,
  promptMusicAudioExecutionSchema,
  compositionMusicAudioExecutionSchema,
])

export type FrozenAudioExecution = z.infer<typeof frozenAudioExecutionSchema>

export function resolveAudioExecutionMode(item: AudioGenerationItem): AudioExecutionMode {
  if (item.audioKind === 'sound') return 'sound'
  return 'compositionPlan' in item ? 'composition_music' : 'prompt_music'
}

export function musicGenerationModeForAudioExecution(
  mode: AudioExecutionMode,
): 'prompt' | 'composition_plan' | null {
  if (mode === 'prompt_music') return 'prompt'
  if (mode === 'composition_music') return 'composition_plan'
  return null
}

type FrozenAudioExecutionFields = {
  readonly audioExecutionMode: AudioExecutionMode | undefined
  readonly audioKind: 'music' | 'sound' | undefined
  readonly prompt: string | null
  readonly durationSeconds: number | undefined
  readonly generationOptions: Readonly<Record<string, WorkspaceResourceJsonValue>>
}

export function freezeAudioExecution(input: {
  readonly item: AudioGenerationItem
  readonly generationOptions: Readonly<Record<string, WorkspaceResourceJsonValue>>
}): FrozenAudioExecution {
  const mode = resolveAudioExecutionMode(input.item)
  switch (mode) {
    case 'sound': {
      if (input.item.audioKind !== 'sound') {
        throw new Error('AUDIO_EXECUTION_MODE_ITEM_MISMATCH:sound')
      }
      return frozenAudioExecutionSchema.parse({
        mode,
        audioKind: 'sound',
        prompt: input.item.prompt,
        durationSeconds: input.item.durationSeconds,
        generationOptions: input.generationOptions,
      })
    }
    case 'composition_music': {
      if (!('compositionPlan' in input.item)) {
        throw new Error('AUDIO_EXECUTION_MODE_ITEM_MISMATCH:composition_music')
      }
      return frozenAudioExecutionSchema.parse({
        mode,
        audioKind: 'music',
        prompt: null,
        durationSeconds: null,
        generationOptions: input.generationOptions,
      })
    }
    case 'prompt_music': {
      if (input.item.audioKind !== 'music' || 'compositionPlan' in input.item) {
        throw new Error('AUDIO_EXECUTION_MODE_ITEM_MISMATCH:prompt_music')
      }
      return frozenAudioExecutionSchema.parse({
        mode,
        audioKind: 'music',
        prompt: input.item.prompt,
        durationSeconds: input.item.durationSeconds,
        generationOptions: input.generationOptions,
      })
    }
    default: {
      const exhaustive: never = mode
      throw new Error(`AUDIO_EXECUTION_MODE_UNSUPPORTED:${String(exhaustive)}`)
    }
  }
}

export function parseFrozenAudioExecution(input: FrozenAudioExecutionFields): FrozenAudioExecution {
  return frozenAudioExecutionSchema.parse({
    mode: input.audioExecutionMode,
    audioKind: input.audioKind,
    prompt: input.prompt,
    durationSeconds: input.durationSeconds ?? null,
    generationOptions: input.generationOptions,
  })
}

export type { MusicScoreGenerationOptions }
