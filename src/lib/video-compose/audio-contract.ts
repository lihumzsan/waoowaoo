import { z } from 'zod'
import { workspaceResourceReferenceSchema } from '@/lib/workspace-resource/reference-contract'

export const VIDEO_MERGE_AUDIO_MODES = [
  'preserve',
  'mix',
  'replace',
  'mute',
] as const
export const videoMergeAudioModeSchema = z.enum(VIDEO_MERGE_AUDIO_MODES)
export type VideoMergeAudioMode = z.infer<typeof videoMergeAudioModeSchema>

const cueTimingSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    fadeInMs: z.number().int().nonnegative(),
    fadeOutMs: z.number().int().nonnegative(),
    gainDb: z.number().finite().min(-60).max(12),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.fadeInMs > cue.durationMs)
      context.addIssue({
        code: 'custom',
        path: ['fadeInMs'],
        message: 'fadeInMs exceeds cue duration.',
      })
    if (cue.fadeOutMs > cue.durationMs)
      context.addIssue({
        code: 'custom',
        path: ['fadeOutMs'],
        message: 'fadeOutMs exceeds cue duration.',
      })
  })

export const videoMergeTimedCueInputSchema = cueTimingSchema.safeExtend(
  workspaceResourceReferenceSchema.shape,
)
export const videoMergeCuePlacementSchema = cueTimingSchema.safeExtend({
  inputPosition: z.number().int().nonnegative(),
})
export type VideoMergeTimedCueInput = z.infer<
  typeof videoMergeTimedCueInputSchema
>
export type VideoMergeCuePlacement = z.infer<
  typeof videoMergeCuePlacementSchema
>

export const compositionAudioSchema = z
  .object({
    mode: videoMergeAudioModeSchema,
    backgroundMusic: workspaceResourceReferenceSchema.optional(),
    replacementAudio: workspaceResourceReferenceSchema.optional(),
    musicCues: z.array(videoMergeTimedCueInputSchema).max(50),
    soundCues: z.array(videoMergeTimedCueInputSchema).max(50),
  })
  .strict()
  .superRefine((audio, context) => {
    const hasCues = audio.musicCues.length + audio.soundCues.length > 0
    const valid =
      audio.mode === 'mix'
        ? Boolean(audio.backgroundMusic) && !audio.replacementAudio && !hasCues
        : audio.mode === 'replace'
          ? Boolean(audio.replacementAudio) &&
            !audio.backgroundMusic &&
            !hasCues
          : !audio.backgroundMusic &&
            !audio.replacementAudio &&
            (!hasCues || audio.mode === 'preserve')
    if (!valid)
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message:
          'Audio inputs must match the declared mode; timed cues require preserve.',
      })
    const identities = [...audio.musicCues, ...audio.soundCues].map(
      (cue) => `${cue.resourceId}:${cue.contentVersion}`,
    )
    if (
      identities.length > 50 ||
      new Set(identities).size !== identities.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['musicCues'],
        message:
          'Timed cues must have unique exact references and cannot exceed 50.',
      })
    }
  })
