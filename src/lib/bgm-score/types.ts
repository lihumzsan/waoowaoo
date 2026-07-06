import { z } from 'zod'

export const BGM_SCORE_STATUS = {
  PENDING: 'pending',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type BgmScoreStatus = (typeof BGM_SCORE_STATUS)[keyof typeof BGM_SCORE_STATUS]

const optionalTimedSectionFields = {
  startSec: z.number().min(0).optional().nullable(),
  endSec: z.number().positive().optional().nullable(),
} as const

function validateOptionalTimeRange(
  value: { readonly startSec?: number | null; readonly endSec?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (typeof value.startSec === 'number' && typeof value.endSec === 'number' && value.endSec <= value.startSec) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endSec'],
      message: 'BGM_SCORE_DESIGN_SECTION_INVALID_TIME_RANGE',
    })
  }
}

export const bgmScoreDesignSectionSchema = z.object({
  category: z.string().trim().min(1),
  title: z.string().trim().min(1),
  purpose: z.string().trim().min(1).optional().nullable(),
  ...optionalTimedSectionFields,
  content: z.string().trim().min(1),
}).superRefine(validateOptionalTimeRange)

export const bgmScorePromptSectionSchema = z.object({
  title: z.string().trim().min(1),
  purpose: z.string().trim().min(1).optional().nullable(),
  ...optionalTimedSectionFields,
  content: z.string().trim().min(1),
}).superRefine(validateOptionalTimeRange)

export const bgmScoreVirtualLayerSchema = z.object({
  name: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  content: z.string().trim().min(1),
})

export const bgmScorePlanSchema = z.object({
  durationSeconds: z.number().positive().max(600),
  creativeBrief: z.object({
    cueType: z.string().trim().min(1),
    genre: z.string().trim().min(1),
    mood: z.string().trim().min(1),
    narrativeFunction: z.string().trim().min(1),
  }),
  scoreDesign: z.object({
    overview: z.string().trim().min(1),
    sections: z.array(bgmScoreDesignSectionSchema).min(1).max(48),
  }),
  virtualLayers: z.array(bgmScoreVirtualLayerSchema).min(1).max(16),
  promptSections: z.array(bgmScorePromptSectionSchema).min(1).max(32),
  finalPrompt: z.string().trim().min(80),
}).superRefine((plan, ctx) => {
  const checkTimedSection = (
    path: Array<string | number>,
    startSec: number | null | undefined,
    endSec: number | null | undefined,
  ) => {
    if (typeof startSec === 'number' && startSec > plan.durationSeconds + 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: 'BGM_SCORE_DESIGN_TIMING_OUT_OF_RANGE',
      })
    }
    if (typeof endSec === 'number' && endSec > plan.durationSeconds + 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: 'BGM_SCORE_DESIGN_TIMING_OUT_OF_RANGE',
      })
    }
  }

  plan.scoreDesign.sections.forEach((section, index) => {
    checkTimedSection(['scoreDesign', 'sections', index, 'endSec'], section.startSec, section.endSec)
  })
  plan.promptSections.forEach((section, index) => {
    checkTimedSection(['promptSections', index, 'endSec'], section.startSec, section.endSec)
  })
})

export type BgmScorePlan = z.infer<typeof bgmScorePlanSchema>
export type BgmScoreDesignSection = z.infer<typeof bgmScoreDesignSectionSchema>
export type BgmScorePromptSection = z.infer<typeof bgmScorePromptSectionSchema>
export type BgmScoreVirtualLayer = z.infer<typeof bgmScoreVirtualLayerSchema>

export interface BgmScoreMix {
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
}

export interface BgmScoreCue {
  readonly cueId: string
  readonly index: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly durationSeconds: number
  readonly sourceClipOrders: readonly number[]
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly prompt: string
}

export interface BgmScoreProjectData {
  readonly schemaVersion: 2
  readonly status: BgmScoreStatus
  readonly taskId: string
  readonly editScriptId: string
  readonly timelineSignature: string
  readonly durationSeconds: number
  readonly musicModel: string
  readonly plan?: BgmScorePlan
  readonly cues?: readonly BgmScoreCue[]
  readonly mix?: BgmScoreMix
  readonly errorMessage?: string | null
}
