import { z } from 'zod'
import { editSourceAnchorSchema } from '@/lib/edit-source-document/anchors'
import { editSourceRangeSchema } from '@/lib/edit-source-document/schemas'
import { ledgerEventBaseSchema, ledgerSchema } from '@/lib/edit-ledger/schemas'
import { CREATIVE_CHAPTER_MAX_DURATION_SECONDS } from './constraints'
import { storyCanonCharacterVoiceProfileSchema } from './voice-profile'

export const storyCanonEntityBaseSchema = z.object({
  entityId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().trim().min(1),
})

export const storyCanonEntitySchema = storyCanonEntityBaseSchema

export const storyCanonCharacterSchema = storyCanonEntityBaseSchema.extend({
  voiceProfile: storyCanonCharacterVoiceProfileSchema,
})

export const rawStoryCanonEntitySchema = storyCanonEntitySchema

export const rawStoryCanonCharacterSchema = storyCanonCharacterSchema

export const storyCanonSchema = z.object({
  title: z.string().trim().min(1).optional(),
  logline: z.string().trim().min(1).optional(),
  synopsis: z.string().trim().min(1),
  characters: z.array(storyCanonCharacterSchema).default([]),
  locations: z.array(storyCanonEntitySchema).default([]),
  worldRules: z.array(z.string().trim().min(1)).default([]),
}).strict()

export type StoryCanon = z.infer<typeof storyCanonSchema>

export const rawStoryCanonSchema = storyCanonSchema.extend({
  characters: z.array(rawStoryCanonCharacterSchema).default([]),
  locations: z.array(rawStoryCanonEntitySchema).default([]),
})

export type RawStoryCanon = z.infer<typeof rawStoryCanonSchema>

export const storyCanonBeatBaseSchema = z.object({
  beatId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  estimatedDurationSec: z.number().int().positive(),
})

export const storyCanonBeatSchema = editSourceRangeSchema.safeExtend(storyCanonBeatBaseSchema.shape)

export const storyCanonBeatSheetSchema = z.object({
  beats: z.array(storyCanonBeatSchema).min(1),
})

export type StoryCanonBeat = z.infer<typeof storyCanonBeatSchema>
export type StoryCanonBeatSheet = z.infer<typeof storyCanonBeatSheetSchema>

export const rawStoryCanonBeatSchema = storyCanonBeatBaseSchema.extend({
  sourceAnchor: editSourceAnchorSchema,
})

export const rawStoryCanonBeatSheetSchema = z.object({
  beats: z.array(rawStoryCanonBeatSchema).min(1),
})

export type RawStoryCanonBeatSheet = z.infer<typeof rawStoryCanonBeatSheetSchema>

export const storyCanonEmotionalCueBaseSchema = z.object({
  cueId: z.string().trim().min(1),
  mood: z.string().trim().min(1),
  intensity: z.number().min(0).max(1),
  musicPolicy: z.enum(['none', 'underscore', 'theme', 'transition']),
  note: z.string().trim().min(1).optional(),
})

export const storyCanonEmotionalCueSchema = editSourceRangeSchema.safeExtend(storyCanonEmotionalCueBaseSchema.shape)

export const storyCanonEmotionalCurveSchema = z.object({
  cues: z.array(storyCanonEmotionalCueSchema),
})

export type StoryCanonEmotionalCue = z.infer<typeof storyCanonEmotionalCueSchema>
export type StoryCanonEmotionalCurve = z.infer<typeof storyCanonEmotionalCurveSchema>

export const rawStoryCanonEmotionalCueSchema = storyCanonEmotionalCueBaseSchema.extend({
  sourceAnchor: editSourceAnchorSchema,
})

export const rawStoryCanonEmotionalCurveSchema = z.object({
  cues: z.array(rawStoryCanonEmotionalCueSchema),
})

export type RawStoryCanonEmotionalCurve = z.infer<typeof rawStoryCanonEmotionalCurveSchema>

export const rawStoryCanonLedgerEventSchema = ledgerEventBaseSchema.extend({
  beatId: z.string().trim().min(1),
})

export const rawStoryCanonLedgerSchema = z.object({
  events: z.array(rawStoryCanonLedgerEventSchema),
})

export type RawStoryCanonLedger = z.infer<typeof rawStoryCanonLedgerSchema>

export const rawStoryCanonBundleSchema = z.object({
  storyCanon: rawStoryCanonSchema,
  beatSheet: rawStoryCanonBeatSheetSchema,
  ledger: rawStoryCanonLedgerSchema,
  emotionalCurve: rawStoryCanonEmotionalCurveSchema,
}).strict()

export type RawStoryCanonBundle = z.infer<typeof rawStoryCanonBundleSchema>

export const storyCanonBundleSchema = z.object({
  storyCanon: storyCanonSchema,
  beatSheet: storyCanonBeatSheetSchema,
  ledger: ledgerSchema,
  emotionalCurve: storyCanonEmotionalCurveSchema,
})

export type StoryCanonBundle = z.infer<typeof storyCanonBundleSchema>

export const chapterContinuityPlanItemSchema = editSourceRangeSchema.extend({
  chapterIndex: z.number().int().min(0),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  targetDurationSec: z.number().int().positive(),
}).strict()

export type ChapterContinuityPlanItem = z.infer<typeof chapterContinuityPlanItemSchema>

export const chapterContinuityPlanOutputSchema = z.object({
  kind: z.literal('chapter_continuity_plan'),
  storyCanon: rawStoryCanonBundleSchema
    .describe('The single global Story Canon and continuity ledger shared by every Chapter in this plan.'),
  rationale: z.string().trim().min(1).max(12_000),
  chapters: z.array(chapterContinuityPlanItemSchema.safeExtend({
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(8_000),
    targetDurationSec: z.number().int().positive().max(CREATIVE_CHAPTER_MAX_DURATION_SECONDS),
  }).strict()).min(2).max(128),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(64),
  warnings: z.array(z.string().trim().min(1).max(2_000)).max(64),
}).strict().superRefine((output, context) => {
  let previousEnd = -1
  for (const [index, chapter] of output.chapters.entries()) {
    if (chapter.chapterIndex !== index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters', index, 'chapterIndex'],
        message: 'CHAPTER_CONTINUITY_PLAN_INDEX_NOT_CONTIGUOUS',
      })
    }
    if (chapter.sourceStart < previousEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters', index, 'sourceStart'],
        message: 'CHAPTER_CONTINUITY_PLAN_RANGE_OVERLAP',
      })
    }
    previousEnd = chapter.sourceEnd
  }
})

export type ChapterContinuityPlanOutput = z.infer<typeof chapterContinuityPlanOutputSchema>

export const getStoryCanonInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const getEditChaptersInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})
