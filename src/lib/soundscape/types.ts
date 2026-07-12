import { z } from 'zod'

export const SOUNDSCAPE_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type SoundscapeStatus = (typeof SOUNDSCAPE_STATUS)[keyof typeof SOUNDSCAPE_STATUS]

export const SOUNDSCAPE_MAX_SOURCE_COUNT = 12
export const SOUNDSCAPE_MAX_SOURCE_DURATION_SECONDS = 30
export const SOUNDSCAPE_OUTPUT_FORMAT = 'mp3_44100_128'

export const soundscapePerspectiveSchema = z.enum([
  'exterior_near',
  'exterior_far',
  'interior',
  'interior_behind_window',
])

export const soundscapeIntensitySchema = z.enum(['low', 'medium', 'high'])
export const soundscapeTransitionSchema = z.enum(['cut', 'fade', 'crossfade'])

export const soundscapePlanSourceSchema = z.object({
  sourceId: z.string().trim().min(1),
  environmentFingerprint: z.string().trim().min(1),
  prompt: z.string().trim().min(20),
  loopDurationSeconds: z.number().min(0.5).max(SOUNDSCAPE_MAX_SOURCE_DURATION_SECONDS),
  promptInfluence: z.number().min(0).max(1),
}).strict()

export const soundscapePlanSectionSchema = z.object({
  sourceId: z.string().trim().min(1),
  fromShotId: z.string().trim().min(1),
  toShotId: z.string().trim().min(1),
  perspective: soundscapePerspectiveSchema,
  intensity: soundscapeIntensitySchema,
  transitionIn: soundscapeTransitionSchema,
  transitionOut: soundscapeTransitionSchema,
}).strict()

export const soundscapeRawPlanSectionSchema = z.object({
  sourceId: z.string().trim().min(1),
  fromClipOrder: z.number().int().positive(),
  toClipOrder: z.number().int().positive(),
  perspective: soundscapePerspectiveSchema,
  intensity: soundscapeIntensitySchema,
  transitionIn: soundscapeTransitionSchema,
  transitionOut: soundscapeTransitionSchema,
}).strict()

function createSoundscapePlanSchema<TSection extends z.ZodTypeAny>(sectionSchema: TSection) {
  return z.object({
  decision: z.enum(['soundscape', 'none_needed']),
  sources: z.array(soundscapePlanSourceSchema).max(SOUNDSCAPE_MAX_SOURCE_COUNT),
  sections: z.array(sectionSchema).max(96),
  }).strict().superRefine((plan, ctx) => {
  const sourceIds = new Set<string>()
  const fingerprints = new Set<string>()
  for (const [index, source] of plan.sources.entries()) {
    if (sourceIds.has(source.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources', index, 'sourceId'],
        message: 'SOUNDSCAPE_SOURCE_ID_DUPLICATE',
      })
    }
    sourceIds.add(source.sourceId)

    if (fingerprints.has(source.environmentFingerprint)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources', index, 'environmentFingerprint'],
        message: 'SOUNDSCAPE_ENVIRONMENT_FINGERPRINT_DUPLICATE',
      })
    }
    fingerprints.add(source.environmentFingerprint)
  }

  if (plan.decision === 'none_needed') {
    if (plan.sources.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'SOUNDSCAPE_NONE_NEEDED_SOURCES_NOT_ALLOWED',
      })
    }
    if (plan.sections.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections'],
        message: 'SOUNDSCAPE_NONE_NEEDED_SECTIONS_NOT_ALLOWED',
      })
    }
    return
  }

  if (plan.sources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sources'],
      message: 'SOUNDSCAPE_SOURCES_REQUIRED',
    })
  }
  if (plan.sections.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: 'SOUNDSCAPE_SECTIONS_REQUIRED',
    })
  }

  for (const [index, section] of plan.sections.entries()) {
    const sourceId = (section as { readonly sourceId: string }).sourceId
    if (!sourceIds.has(sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index, 'sourceId'],
        message: 'SOUNDSCAPE_SECTION_SOURCE_UNKNOWN',
      })
    }
  }
  })
}

export const soundscapePlanSchema = createSoundscapePlanSchema(soundscapePlanSectionSchema)
export const soundscapeRawPlanSchema = createSoundscapePlanSchema(soundscapeRawPlanSectionSchema)

export type SoundscapePlan = z.infer<typeof soundscapePlanSchema>
export type SoundscapePlanSource = z.infer<typeof soundscapePlanSourceSchema>
export type SoundscapePlanSection = z.infer<typeof soundscapePlanSectionSchema>
export type SoundscapeRawPlan = z.infer<typeof soundscapeRawPlanSchema>
export type SoundscapeRawPlanSection = z.infer<typeof soundscapeRawPlanSectionSchema>
export type SoundscapePerspective = z.infer<typeof soundscapePerspectiveSchema>
export type SoundscapeIntensity = z.infer<typeof soundscapeIntensitySchema>
export type SoundscapeTransition = z.infer<typeof soundscapeTransitionSchema>

export interface SoundscapeSourceAsset {
  readonly sourceId: string
  readonly environmentFingerprint: string
  readonly prompt: string
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
  readonly loopDurationSeconds: number
  readonly promptInfluence: number
  readonly soundEffectModel: string
}

export interface SoundscapeMix {
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
}

export interface SoundscapeProjectData {
  readonly status: SoundscapeStatus
  readonly taskId: string
  readonly timelineSignature: string
  readonly durationSeconds: number
  readonly soundEffectModel: string
  readonly plan?: SoundscapePlan
  readonly sources?: readonly SoundscapeSourceAsset[]
  readonly mix?: SoundscapeMix
  readonly errorMessage?: string | null
}
