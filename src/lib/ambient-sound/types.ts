import { z } from 'zod'

export const AMBIENT_SOUND_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type AmbientSoundStatus = (typeof AMBIENT_SOUND_STATUS)[keyof typeof AMBIENT_SOUND_STATUS]

export const AMBIENT_SOUND_MAX_SOURCE_COUNT = 12
export const AMBIENT_SOUND_MAX_SOURCE_DURATION_SECONDS = 30
export const AMBIENT_SOUND_OUTPUT_FORMAT = 'mp3_44100_128'

export const ambientSoundPerspectiveSchema = z.enum([
  'exterior_near',
  'exterior_far',
  'interior',
  'interior_behind_window',
])

export const ambientSoundIntensitySchema = z.enum(['low', 'medium', 'high'])
export const ambientSoundTransitionSchema = z.enum(['cut', 'fade', 'crossfade'])

export const ambientSoundPlanSourceSchema = z.object({
  sourceId: z.string().trim().min(1),
  environmentFingerprint: z.string().trim().min(1),
  prompt: z.string().trim().min(20),
  loopDurationSeconds: z.number().min(0.5).max(AMBIENT_SOUND_MAX_SOURCE_DURATION_SECONDS),
  promptInfluence: z.number().min(0).max(1),
}).strict()

export const ambientSoundPlanSectionSchema = z.object({
  sourceId: z.string().trim().min(1),
  fromShotId: z.string().trim().min(1),
  toShotId: z.string().trim().min(1),
  perspective: ambientSoundPerspectiveSchema,
  intensity: ambientSoundIntensitySchema,
  transitionIn: ambientSoundTransitionSchema,
  transitionOut: ambientSoundTransitionSchema,
}).strict()

export const ambientSoundRawPlanSectionSchema = z.object({
  sourceId: z.string().trim().min(1),
  fromClipOrder: z.number().int().positive(),
  toClipOrder: z.number().int().positive(),
  perspective: ambientSoundPerspectiveSchema,
  intensity: ambientSoundIntensitySchema,
  transitionIn: ambientSoundTransitionSchema,
  transitionOut: ambientSoundTransitionSchema,
}).strict()

function createAmbientSoundPlanSchema<TSection extends z.ZodTypeAny>(sectionSchema: TSection) {
  return z.object({
  decision: z.enum(['ambient_sound', 'none_needed']),
  sources: z.array(ambientSoundPlanSourceSchema).max(AMBIENT_SOUND_MAX_SOURCE_COUNT),
  sections: z.array(sectionSchema).max(96),
  }).strict().superRefine((plan, ctx) => {
  const sourceIds = new Set<string>()
  const fingerprints = new Set<string>()
  for (const [index, source] of plan.sources.entries()) {
    if (sourceIds.has(source.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources', index, 'sourceId'],
        message: 'AMBIENT_SOUND_SOURCE_ID_DUPLICATE',
      })
    }
    sourceIds.add(source.sourceId)

    if (fingerprints.has(source.environmentFingerprint)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources', index, 'environmentFingerprint'],
        message: 'AMBIENT_SOUND_ENVIRONMENT_FINGERPRINT_DUPLICATE',
      })
    }
    fingerprints.add(source.environmentFingerprint)
  }

  if (plan.decision === 'none_needed') {
    if (plan.sources.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'AMBIENT_SOUND_NONE_NEEDED_SOURCES_NOT_ALLOWED',
      })
    }
    if (plan.sections.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections'],
        message: 'AMBIENT_SOUND_NONE_NEEDED_SECTIONS_NOT_ALLOWED',
      })
    }
    return
  }

  if (plan.sources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sources'],
      message: 'AMBIENT_SOUND_SOURCES_REQUIRED',
    })
  }
  if (plan.sections.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sections'],
      message: 'AMBIENT_SOUND_SECTIONS_REQUIRED',
    })
  }

  for (const [index, section] of plan.sections.entries()) {
    const sourceId = (section as { readonly sourceId: string }).sourceId
    if (!sourceIds.has(sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sections', index, 'sourceId'],
        message: 'AMBIENT_SOUND_SECTION_SOURCE_UNKNOWN',
      })
    }
  }
  })
}

export const ambientSoundPlanSchema = createAmbientSoundPlanSchema(ambientSoundPlanSectionSchema)
export const ambientSoundRawPlanSchema = createAmbientSoundPlanSchema(ambientSoundRawPlanSectionSchema)

export type AmbientSoundPlan = z.infer<typeof ambientSoundPlanSchema>
export type AmbientSoundPlanSource = z.infer<typeof ambientSoundPlanSourceSchema>
export type AmbientSoundPlanSection = z.infer<typeof ambientSoundPlanSectionSchema>
export type AmbientSoundRawPlan = z.infer<typeof ambientSoundRawPlanSchema>
export type AmbientSoundRawPlanSection = z.infer<typeof ambientSoundRawPlanSectionSchema>
export type AmbientSoundPerspective = z.infer<typeof ambientSoundPerspectiveSchema>
export type AmbientSoundIntensity = z.infer<typeof ambientSoundIntensitySchema>
export type AmbientSoundTransition = z.infer<typeof ambientSoundTransitionSchema>

export interface AmbientSoundSourceAsset {
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

export interface AmbientSoundMix {
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
}

export interface AmbientSoundProjectData {
  readonly status: AmbientSoundStatus
  readonly taskId: string
  readonly planTaskId?: string
  readonly timelineSignature: string
  readonly durationSeconds: number
  readonly soundEffectModel: string
  readonly plan?: AmbientSoundPlan
  readonly sources?: readonly AmbientSoundSourceAsset[]
  readonly mix?: AmbientSoundMix
  readonly errorMessage?: string | null
}
