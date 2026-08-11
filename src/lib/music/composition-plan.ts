import { z } from 'zod'

export const MUSIC_COMPOSITION_PLAN_LIMITS = {
  maxChunks: 30,
  minChunkDurationMs: 3_000,
  maxChunkDurationMs: 120_000,
  minPlanDurationMs: 3_000,
  maxPlanDurationMs: 600_000,
  maxPositiveStyles: 50,
  maxNegativeStyles: 50,
} as const

const musicStyleSchema = z.string().trim().min(1)

export const musicCompositionChunkSchema = z.object({
  text: z.string().trim().min(1),
  durationMs: z.number().int()
    .min(MUSIC_COMPOSITION_PLAN_LIMITS.minChunkDurationMs)
    .max(MUSIC_COMPOSITION_PLAN_LIMITS.maxChunkDurationMs),
  positiveStyles: z.array(musicStyleSchema)
    .max(MUSIC_COMPOSITION_PLAN_LIMITS.maxPositiveStyles),
  negativeStyles: z.array(musicStyleSchema)
    .max(MUSIC_COMPOSITION_PLAN_LIMITS.maxNegativeStyles),
  contextAdherence: z.enum(['low', 'medium', 'high']),
}).strict()

export const musicCompositionPlanSchema = z.object({
  chunks: z.array(musicCompositionChunkSchema)
    .min(1)
    .max(MUSIC_COMPOSITION_PLAN_LIMITS.maxChunks),
}).strict().superRefine((plan, context) => {
  const durationMs = plan.chunks.reduce((total, chunk) => total + chunk.durationMs, 0)
  if (
    durationMs < MUSIC_COMPOSITION_PLAN_LIMITS.minPlanDurationMs
    || durationMs > MUSIC_COMPOSITION_PLAN_LIMITS.maxPlanDurationMs
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chunks'],
      message: `Composition Plan total duration must be ${String(MUSIC_COMPOSITION_PLAN_LIMITS.minPlanDurationMs)}-${String(MUSIC_COMPOSITION_PLAN_LIMITS.maxPlanDurationMs)}ms.`,
    })
  }
})

export type MusicCompositionPlan = z.infer<typeof musicCompositionPlanSchema>

export function musicCompositionPlanDurationMs(plan: MusicCompositionPlan): number {
  return plan.chunks.reduce((total, chunk) => total + chunk.durationMs, 0)
}

export function toElevenLabsCompositionPlan(plan: MusicCompositionPlan): {
  readonly chunks: ReadonlyArray<{
    readonly text: string
    readonly duration_ms: number
    readonly positive_styles: readonly string[]
    readonly negative_styles: readonly string[]
    readonly context_adherence: 'low' | 'medium' | 'high'
  }>
} {
  return {
    chunks: plan.chunks.map((chunk) => ({
      text: chunk.text,
      duration_ms: chunk.durationMs,
      positive_styles: chunk.positiveStyles,
      negative_styles: chunk.negativeStyles,
      context_adherence: chunk.contextAdherence,
    })),
  }
}
