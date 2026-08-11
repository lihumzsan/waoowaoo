import { z } from 'zod'
import {
  musicCompositionPlanDurationMs,
  musicCompositionPlanSchema,
} from './composition-plan'

const cueMixShape = {
  fadeInMs: z.number().int().nonnegative(),
  fadeOutMs: z.number().int().nonnegative(),
  gainDb: z.number().finite().min(-60).max(12),
} as const

export const musicScoreCueRequestSchema = z.object({
  compositionPlan: musicCompositionPlanSchema,
  startMs: z.number().int().nonnegative(),
  ...cueMixShape,
}).strict().superRefine((cue, context) => {
  const durationMs = musicCompositionPlanDurationMs(cue.compositionPlan)
  if (cue.fadeInMs > durationMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fadeInMs'],
      message: 'fadeInMs cannot exceed the cue duration.',
    })
  }
  if (cue.fadeOutMs > durationMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fadeOutMs'],
      message: 'fadeOutMs cannot exceed the cue duration.',
    })
  }
})

export const musicScoreGenerationOptionsSchema = z.object({
  kind: z.literal('music_score_v1'),
  compositionPlan: musicCompositionPlanSchema,
  startMs: z.number().int().nonnegative(),
  ...cueMixShape,
  timelineInputPosition: z.number().int().nonnegative(),
  outputFormat: z.literal('mp3'),
}).strict().superRefine((specification, context) => {
  const durationMs = musicCompositionPlanDurationMs(specification.compositionPlan)
  if (specification.fadeInMs > durationMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fadeInMs'],
      message: 'fadeInMs cannot exceed the cue duration.',
    })
  }
  if (specification.fadeOutMs > durationMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fadeOutMs'],
      message: 'fadeOutMs cannot exceed the cue duration.',
    })
  }
})

export type MusicScoreGenerationOptions = z.infer<typeof musicScoreGenerationOptionsSchema>

export function musicScoreCueEndMs(specification: MusicScoreGenerationOptions): number {
  return specification.startMs + musicCompositionPlanDurationMs(specification.compositionPlan)
}
