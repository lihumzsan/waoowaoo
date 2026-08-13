import { z } from 'zod'
import { MUSIC_KEY_SCALE_VALUES, MUSIC_TIME_SIGNATURE_VALUES } from './music-parameter-contract'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { musicScoreCueRequestSchema } from '@/lib/music/score-specification'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from './generation-contract'
import {
  WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  WORKSPACE_RESOURCE_SCHEMA,
} from './schema-registry'
export {
  VOCAL_PERFORMANCE_MODES,
  vocalPerformanceModeSchema,
  resolveVideoVocalPerformanceMode,
  assertVocalPerformancePrompt,
  type VocalPerformanceMode,
} from './vocal-performance-contract'
import { vocalPerformanceModeSchema } from './vocal-performance-contract'

const finalPromptSchema = z.string().min(1).max(100_000)
  .refine((value) => value.trim().length > 0, 'prompt must contain non-whitespace content.')
  .describe('Complete final provider-ready creative prompt. The server validates and freezes it verbatim.')

const resourceNameSchema = z.string().trim().min(1).max(300)
  .describe('User-visible resource name. The server derives the canonical WorkspaceResource path.')

const folderPathSchema = z.string().trim().min(1).max(512).nullable().optional()
  .describe('Optional project-relative destination folder path. Omit or use null for the project root; missing folders are created atomically with the output Resources.')

export const generationReferenceSchema = z.object({
  resourceId: z.string().trim().min(1).max(32)
    .describe('Canonical ready WorkspaceResource identity.'),
  contentVersion: z.number().int().positive()
    .describe('Exact immutable input version.'),
  role: z.string().trim().min(1).max(64),
  channel: z.enum(['context', 'image', 'audio', 'video']),
}).strict().describe('One ordered reference. Array order is authoritative; the server assigns frozen internal positions.')

export const videoGenerationReferenceSchema = z.discriminatedUnion('channel', [
  generationReferenceSchema.extend({
    channel: z.literal('context'),
  }).strict(),
  generationReferenceSchema.extend({
    channel: z.literal('image'),
    role: z.enum(['first_frame', 'last_frame', 'reference_image']),
  }).strict(),
  generationReferenceSchema.extend({
    channel: z.literal('audio'),
    role: z.literal('reference_audio'),
  }).strict(),
  generationReferenceSchema.extend({
    channel: z.literal('video'),
    role: z.literal('reference_video'),
  }).strict(),
])

const commonItemShape = {
  itemId: z.string().trim().min(1).max(191),
  name: resourceNameSchema,
  folderPath: folderPathSchema,
  count: z.number().int().min(1).max(6).default(1),
} as const

const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

export const imageGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('image'),
  prompt: finalPromptSchema,
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image),
  assetKind: z.enum(['character', 'location', 'prop']).nullable().default(null),
  references: z.array(generationReferenceSchema.extend({
    channel: z.enum(['context', 'image']),
  }).strict()).max(16).optional(),
  aliases: textList(64, 300).optional(),
  stableDescription: z.string().trim().min(1).max(16_000).optional(),
  consumedByShots: textList(512, 512).optional(),
}).strict().superRefine((item, context) => {
  const expectedSchema = item.assetKind === 'character'
    ? WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE
    : item.assetKind === 'location'
      ? WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE
      : item.assetKind === 'prop'
        ? WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE
        : null
  if (expectedSchema !== null && item.schemaId !== expectedSchema) {
    context.addIssue({ code: 'custom', path: ['schemaId'], message: `schemaId must match assetKind ${item.assetKind}.` })
  }
  const assetSchemaIds: readonly string[] = [
    WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
  ]
  if (item.assetKind === null && assetSchemaIds.includes(item.schemaId)) {
    context.addIssue({ code: 'custom', path: ['assetKind'], message: 'assetKind is required for a reusable asset image schema.' })
  }
})

export const promptMusicGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('audio'),
  audioKind: z.literal('music'),
  prompt: finalPromptSchema.describe('Complete final provider-ready music prompt. The server freezes it verbatim.'),
  schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO),
  references: z.array(generationReferenceSchema.extend({
    channel: z.enum(['context', 'video']),
  }).strict()).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: z.enum(['instrumental', 'vocal']).default('instrumental'),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  keyScale: z.enum(MUSIC_KEY_SCALE_VALUES).optional(),
  timeSignature: z.enum(MUSIC_TIME_SIGNATURE_VALUES).optional(),
  startSeconds: z.number().finite().nonnegative().optional(),
  purpose: z.string().trim().min(1).max(4_000).optional(),
  musicalDirection: z.string().trim().min(1).max(8_000).optional(),
  dialogueSafety: z.string().trim().min(1).max(2_000).nullable().optional(),
}).strict()

export const compositionPlanMusicGenerationItemSchema = musicScoreCueRequestSchema.safeExtend({
  ...commonItemShape,
  mediaType: z.literal('audio'),
  audioKind: z.literal('music'),
  prompt: z.string().optional(),
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio),
  references: z.array(generationReferenceSchema.extend({
    channel: z.literal('context'),
    role: z.literal('score_timeline'),
  }).strict()).length(1),
}).strict()

export const musicGenerationItemSchema = z.union([
  promptMusicGenerationItemSchema,
  compositionPlanMusicGenerationItemSchema,
])

export const soundGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('audio'),
  audioKind: z.literal('sound'),
  prompt: finalPromptSchema.describe('Complete final provider-ready environmental sound prompt. The server freezes it verbatim.'),
  schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO),
  durationSeconds: z.number().int().min(1).max(30),
  negativePrompt: z.string().max(100_000)
    .refine((value) => value.trim().length > 0, 'negativePrompt must contain non-whitespace content.')
    .optional(),
}).strict()

export const audioGenerationItemSchema = z.union([
  musicGenerationItemSchema,
  soundGenerationItemSchema,
])

export type AudioGenerationKind = 'music' | 'sound'

export const videoGenerationItemSchema = z.object({
  ...commonItemShape,
  mediaType: z.literal('video'),
  prompt: finalPromptSchema,
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video),
  references: z.array(videoGenerationReferenceSchema).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS),
  vocalPerformanceMode: vocalPerformanceModeSchema.optional(),
}).strict()

export const videoGenerationRevisionItemSchema = z.object({
  resourceId: z.string().trim().min(1).max(32)
    .describe('Exact failed or canceled video Resource to regenerate in place. Its canonical identity, name, path, and schema are preserved.'),
  prompt: finalPromptSchema,
  references: z.array(videoGenerationReferenceSchema).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS),
  vocalPerformanceMode: vocalPerformanceModeSchema.optional(),
}).strict()

function validateGenerationItems(
  value: { readonly items: readonly { readonly itemId: string; readonly count: number }[] },
  context: z.RefinementCtx,
): void {
  if (new Set(value.items.map((item) => item.itemId)).size !== value.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'itemId values must be unique.' })
  }
  const taskCount = value.items.reduce((total, item) => total + item.count, 0)
  if (taskCount > OPERATION_EXECUTION_MAX_TASKS) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: `The expanded batch may contain at most ${String(OPERATION_EXECUTION_MAX_TASKS)} tasks.`,
    })
  }
}

const batchCommonShape = {
  kind: z.literal('new'),
} as const

export const imageGenerationBatchSchema = z.object({
  ...batchCommonShape,
  items: z.array(imageGenerationItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
}).strict().superRefine(validateGenerationItems)

export const audioGenerationBatchSchema = z.object({
  ...batchCommonShape,
  items: z.array(audioGenerationItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
}).strict().superRefine(validateGenerationItems)

export const videoGenerationBatchSchema = z.object({
  ...batchCommonShape,
  items: z.array(videoGenerationItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
}).strict().superRefine(validateGenerationItems)

export const videoGenerationRevisionBatchSchema = z.object({
  kind: z.literal('revise_failed'),
  items: z.array(videoGenerationRevisionItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
}).strict().superRefine((batch, context) => {
  if (new Set(batch.items.map((item) => item.resourceId)).size !== batch.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'resourceId values must be unique.' })
  }
})

export type GenerationItem =
  | z.infer<typeof imageGenerationItemSchema>
  | z.infer<typeof audioGenerationItemSchema>
  | z.infer<typeof videoGenerationItemSchema>

const assetGenerationItemSchema = imageGenerationItemSchema.safeExtend({
  assetKind: z.enum(['character', 'location', 'prop']),
  aliases: textList(64, 300),
  stableDescription: z.string().trim().min(1).max(16_000),
  consumedByShots: textList(512, 512),
}).strict()

export const assetGenerationBatchOutputSchema = z.object({
  schemaVersion: z.literal(2),
  outputKind: z.literal('asset_generation_batch'),
  batchId: z.string().trim().min(1).max(191),
  decision: z.enum(['produce', 'no_assets']),
  overview: z.string().trim().min(1).max(8_000),
  items: z.array(assetGenerationItemSchema).max(OPERATION_EXECUTION_MAX_TASKS),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict().superRefine((batch, context) => {
  if (batch.decision === 'produce' && batch.items.length === 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=produce requires at least one item.' })
  }
  if (batch.decision === 'no_assets' && batch.items.length !== 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=no_assets requires items to be empty.' })
  }
  validateGenerationItems(batch, context)
})

export const videoGenerationBatchOutputSchema = z.object({
  schemaVersion: z.literal(2),
  outputKind: z.literal('video_generation_batch'),
  batchId: z.string().trim().min(1).max(191),
  overview: z.string().trim().min(1).max(8_000),
  items: z.array(videoGenerationItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict().superRefine(validateGenerationItems)

export const audioGenerationBatchOutputSchema = z.object({
  schemaVersion: z.literal(3),
  outputKind: z.literal('audio_generation_batch'),
  batchId: z.string().trim().min(1).max(191),
  decision: z.enum(['produce', 'no_audio']),
  overview: z.string().trim().min(1).max(12_000),
  items: z.array(audioGenerationItemSchema).max(OPERATION_EXECUTION_MAX_TASKS),
  globalContinuity: z.string().trim().max(8_000),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict().superRefine((batch, context) => {
  if (batch.decision === 'produce' && batch.items.length === 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=produce requires at least one item.' })
  }
  if (batch.decision === 'no_audio' && batch.items.length !== 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=no_audio requires items to be empty.' })
  }
  let previousEnd = 0
  batch.items.filter((item): item is z.infer<typeof promptMusicGenerationItemSchema> => (
    item.audioKind === 'music' && 'startSeconds' in item
  )).forEach((item, index) => {
    const start = item.startSeconds ?? previousEnd
    if (start < previousEnd) {
      context.addIssue({ code: 'custom', path: ['items', index, 'startSeconds'], message: 'Music cues must not overlap.' })
    }
    previousEnd = start + item.durationSeconds
  })
  validateGenerationItems(batch, context)
})
