import { z } from 'zod'
import { editSourceAnchorSchema } from '@/lib/edit-source-document/anchors'
import { editSourceRangeSchema } from '@/lib/edit-source-document/schemas'
import { ledgerEventBaseSchema, ledgerSchema } from '@/lib/edit-ledger/schemas'
import { CREATIVE_CHAPTER_MAX_DURATION_SECONDS } from './constraints'
import { editBibleCharacterVoiceProfileSchema } from './voice-profile'

export const editBibleEntityBaseSchema = z.object({
  entityId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().trim().min(1),
})

export const editBibleEntitySchema = editBibleEntityBaseSchema

export const editBibleCharacterSchema = editBibleEntityBaseSchema.extend({
  voiceProfile: editBibleCharacterVoiceProfileSchema,
})

export const rawEditBibleEntitySchema = editBibleEntitySchema

export const rawEditBibleCharacterSchema = editBibleCharacterSchema

export const editBibleStyleGuideSchema = z.object({
  visualTone: z.string().trim().min(1),
  cameraLanguage: z.string().trim().min(1),
  editingLanguage: z.string().trim().min(1),
  colorAndLighting: z.string().trim().min(1),
}).partial().default({})

export const editBibleSchema = z.object({
  title: z.string().trim().min(1).optional(),
  logline: z.string().trim().min(1).optional(),
  synopsis: z.string().trim().min(1),
  characters: z.array(editBibleCharacterSchema).default([]),
  locations: z.array(editBibleEntitySchema).default([]),
  worldRules: z.array(z.string().trim().min(1)).default([]),
  styleGuide: editBibleStyleGuideSchema,
})

export type EditBible = z.infer<typeof editBibleSchema>

export const rawEditBibleSchema = editBibleSchema.extend({
  characters: z.array(rawEditBibleCharacterSchema).default([]),
  locations: z.array(rawEditBibleEntitySchema).default([]),
})

export type RawEditBible = z.infer<typeof rawEditBibleSchema>

export const editBibleBeatBaseSchema = z.object({
  beatId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  estimatedDurationSec: z.number().int().positive(),
})

export const editBibleBeatSchema = editSourceRangeSchema.safeExtend(editBibleBeatBaseSchema.shape)

export const editBibleBeatSheetSchema = z.object({
  beats: z.array(editBibleBeatSchema).min(1),
})

export type EditBibleBeat = z.infer<typeof editBibleBeatSchema>
export type EditBibleBeatSheet = z.infer<typeof editBibleBeatSheetSchema>

export const rawEditBibleBeatSchema = editBibleBeatBaseSchema.extend({
  sourceAnchor: editSourceAnchorSchema,
})

export const rawEditBibleBeatSheetSchema = z.object({
  beats: z.array(rawEditBibleBeatSchema).min(1),
})

export type RawEditBibleBeatSheet = z.infer<typeof rawEditBibleBeatSheetSchema>

export const editBibleEmotionalCueBaseSchema = z.object({
  cueId: z.string().trim().min(1),
  mood: z.string().trim().min(1),
  intensity: z.number().min(0).max(1),
  musicPolicy: z.enum(['none', 'underscore', 'theme', 'transition']),
  note: z.string().trim().min(1).optional(),
})

export const editBibleEmotionalCueSchema = editSourceRangeSchema.safeExtend(editBibleEmotionalCueBaseSchema.shape)

export const editBibleEmotionalCurveSchema = z.object({
  cues: z.array(editBibleEmotionalCueSchema),
})

export type EditBibleEmotionalCue = z.infer<typeof editBibleEmotionalCueSchema>
export type EditBibleEmotionalCurve = z.infer<typeof editBibleEmotionalCurveSchema>

export const rawEditBibleEmotionalCueSchema = editBibleEmotionalCueBaseSchema.extend({
  sourceAnchor: editSourceAnchorSchema,
})

export const rawEditBibleEmotionalCurveSchema = z.object({
  cues: z.array(rawEditBibleEmotionalCueSchema),
})

export type RawEditBibleEmotionalCurve = z.infer<typeof rawEditBibleEmotionalCurveSchema>

export const rawEditBibleLedgerEventSchema = ledgerEventBaseSchema.extend({
  beatId: z.string().trim().min(1),
})

export const rawEditBibleLedgerSchema = z.object({
  events: z.array(rawEditBibleLedgerEventSchema),
})

export type RawEditBibleLedger = z.infer<typeof rawEditBibleLedgerSchema>

export const rawEditBibleBundleSchema = z.object({
  bible: rawEditBibleSchema,
  beatSheet: rawEditBibleBeatSheetSchema,
  ledger: rawEditBibleLedgerSchema,
  emotionalCurve: rawEditBibleEmotionalCurveSchema,
}).strict()

export type RawEditBibleBundle = z.infer<typeof rawEditBibleBundleSchema>

export const editBibleBundleSchema = z.object({
  bible: editBibleSchema,
  beatSheet: editBibleBeatSheetSchema,
  ledger: ledgerSchema,
  emotionalCurve: editBibleEmotionalCurveSchema,
})

export type EditBibleBundle = z.infer<typeof editBibleBundleSchema>

export const creativeChapterPlanItemSchema = editSourceRangeSchema.extend({
  chapterIndex: z.number().int().min(0),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  targetDurationSec: z.number().int().positive(),
}).strict()

export type CreativeChapterPlanItem = z.infer<typeof creativeChapterPlanItemSchema>

export const creativeChapterPlanOutputSchema = z.object({
  kind: z.literal('chapter_plan'),
  rationale: z.string().trim().min(1).max(12_000),
  chapters: z.array(creativeChapterPlanItemSchema.safeExtend({
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(8_000),
    targetDurationSec: z.number().int().positive().max(CREATIVE_CHAPTER_MAX_DURATION_SECONDS),
  }).strict()).min(1).max(128),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(64),
  warnings: z.array(z.string().trim().min(1).max(2_000)).max(64),
}).strict().superRefine((output, context) => {
  let previousEnd = -1
  for (const [index, chapter] of output.chapters.entries()) {
    if (chapter.chapterIndex !== index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters', index, 'chapterIndex'],
        message: 'CREATIVE_CHAPTER_PLAN_INDEX_NOT_CONTIGUOUS',
      })
    }
    if (chapter.sourceStart < previousEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters', index, 'sourceStart'],
        message: 'CREATIVE_CHAPTER_PLAN_RANGE_OVERLAP',
      })
    }
    previousEnd = chapter.sourceEnd
  }
})

export type CreativeChapterPlanOutput = z.infer<typeof creativeChapterPlanOutputSchema>

export const getEditBibleInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const getEditChaptersInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})
