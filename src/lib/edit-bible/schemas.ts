import { z } from 'zod'
import { editSourceAnchorSchema, editSourcePointAnchorSchema, editSourceRangeSchema } from '@/lib/edit-source-document'
import { ledgerEventBaseSchema, ledgerSchema } from '@/lib/edit-ledger'
import { EDIT_BIBLE_STATUS } from './constraints'
import { editBibleCharacterVoiceProfileSchema } from './voice-profile'

export const editBibleStatusSchema = z.enum([
  EDIT_BIBLE_STATUS.PENDING,
  EDIT_BIBLE_STATUS.GENERATING,
  EDIT_BIBLE_STATUS.READY_FOR_REVIEW,
  EDIT_BIBLE_STATUS.CONFIRMED,
  EDIT_BIBLE_STATUS.FAILED,
])

export const editBibleEntityBaseSchema = z.object({
  entityId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().trim().min(1),
  firstSourceStart: z.number().int().min(0).optional(),
})

export const editBibleEntitySchema = editBibleEntityBaseSchema

export const editBibleCharacterSchema = editBibleEntityBaseSchema.extend({
  voiceProfile: editBibleCharacterVoiceProfileSchema,
})

export const rawEditBibleEntitySchema = editBibleEntityBaseSchema
  .omit({ firstSourceStart: true })
  .extend({
    firstEvidence: editSourcePointAnchorSchema.optional(),
  })

export const rawEditBibleCharacterSchema = editBibleCharacterSchema
  .omit({ firstSourceStart: true })
  .extend({
    firstEvidence: editSourcePointAnchorSchema.optional(),
  })

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
  persistentFactsIntroduced: z.array(z.string().trim().min(1)).default([]),
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

export type EditBibleEmotionalCurve = z.infer<typeof editBibleEmotionalCurveSchema>

export const rawEditBibleEmotionalCueSchema = editBibleEmotionalCueBaseSchema.extend({
  sourceAnchor: editSourceAnchorSchema,
})

export const rawEditBibleEmotionalCurveSchema = z.object({
  cues: z.array(rawEditBibleEmotionalCueSchema),
})

export type RawEditBibleEmotionalCurve = z.infer<typeof rawEditBibleEmotionalCurveSchema>

export const rawEditBibleLedgerEventSchema = ledgerEventBaseSchema.extend({
  sourceAnchor: editSourceAnchorSchema,
})

export const rawEditBibleLedgerSchema = z.object({
  events: z.array(rawEditBibleLedgerEventSchema),
})

export type RawEditBibleLedger = z.infer<typeof rawEditBibleLedgerSchema>

export const editBibleBundleSchema = z.object({
  bible: editBibleSchema,
  beatSheet: editBibleBeatSheetSchema,
  ledger: ledgerSchema,
  emotionalCurve: editBibleEmotionalCurveSchema,
})

export type EditBibleBundle = z.infer<typeof editBibleBundleSchema>

export const editBibleDiagnosticsSchema = z.object({
  bible: z.unknown().optional(),
  beatSheet: z.unknown().optional(),
  ledger: z.unknown().optional(),
  emotionalCurve: z.unknown().optional(),
  error: z.string().optional(),
}).passthrough()

export type EditBibleDiagnostics = z.infer<typeof editBibleDiagnosticsSchema>

export const editBibleChapterPlanSchema = editSourceRangeSchema.extend({
  chapterIndex: z.number().int().min(0),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  targetDurationSec: z.number().int().positive(),
  beatIds: z.array(z.string().trim().min(1)),
  eventIds: z.array(z.string().trim().min(1)),
})

export type EditBibleChapterPlan = z.infer<typeof editBibleChapterPlanSchema>

export const ingestEditBibleScriptInputSchema = z.object({
  episodeId: z.string().trim().min(1),
  sourceKind: z.enum(['upload', 'paste', 'prompt_generated_outline']),
  text: z.string().min(1),
  rawFileMediaId: z.string().trim().min(1).optional(),
  confirmed: z.boolean().optional(),
})

export const reviseEditBibleInputSchema = z.object({
  episodeId: z.string().trim().min(1),
  bible: editBibleSchema.optional(),
  beatSheet: editBibleBeatSheetSchema.optional(),
  ledger: ledgerSchema.optional(),
  emotionalCurve: editBibleEmotionalCurveSchema.optional(),
})

export const confirmEditBibleInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const getEditBibleInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})

export const getEditChaptersInputSchema = z.object({
  episodeId: z.string().trim().min(1),
})
