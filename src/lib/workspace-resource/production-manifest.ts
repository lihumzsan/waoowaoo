import { z } from 'zod'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from './generation-contract'
import { workspaceResourceInputRefSchema } from './generation-contract'
import {
  WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  WORKSPACE_RESOURCE_SCHEMA,
} from './schema-registry'

const productionReferenceSchema = workspaceResourceInputRefSchema.extend({
  channel: z.enum(['context', 'image', 'audio', 'video']),
}).strict()

const productionOutputPathSchema = z.string().trim().min(1).max(512)
  .regex(/\.resource$/u, 'Media outputPath must end in .resource.')

const finalPromptSchema = z.string().trim().min(1).max(100_000)
  .describe('Complete final provider-ready creative prompt. The server validates and freezes it verbatim and never appends creative instructions.')

const aspectRatioSchema = z.string().trim().min(3).max(20)
  .regex(/^\d+:\d+$/u, 'aspectRatio must use W:H form.')

const commonShape = {
  itemId: z.string().trim().min(1).max(191),
  outputPath: productionOutputPathSchema,
  prompt: finalPromptSchema,
} as const

const manifestImageItemSchema = z.object({
  ...commonShape,
  mediaType: z.literal('image'),
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image),
  assetKind: z.enum(['character', 'location', 'prop']).nullable(),
  aspectRatio: aspectRatioSchema,
  references: z.array(productionReferenceSchema.extend({
    channel: z.enum(['context', 'image']),
  }).strict()).max(16).optional(),
}).strict().superRefine((item, context) => {
  const expectedSchema = item.assetKind === 'character'
    ? WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE
    : item.assetKind === 'location'
      ? WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE
      : item.assetKind === 'prop'
        ? WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE
        : null
  if (expectedSchema !== null && item.schemaId !== expectedSchema) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schemaId'],
      message: `schemaId must match assetKind ${item.assetKind}.`,
    })
  }
  const assetSchemaIds: readonly string[] = [
    WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
  ]
  if (item.assetKind === null && assetSchemaIds.includes(item.schemaId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetKind'],
      message: 'assetKind is required for a reusable asset image schema.',
    })
  }
  if (item.assetKind !== null && item.aspectRatio !== '4:3') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['aspectRatio'],
      message: 'Reusable asset images must declare aspectRatio 4:3.',
    })
  }
})

const manifestAudioItemSchema = z.object({
  ...commonShape,
  mediaType: z.literal('audio'),
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio),
  references: z.array(productionReferenceSchema.extend({
    channel: z.enum(['context', 'video']),
  }).strict()).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: z.enum(['instrumental', 'vocal']),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
}).strict()

const manifestVideoItemSchema = z.object({
  ...commonShape,
  mediaType: z.literal('video'),
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video),
  aspectRatio: aspectRatioSchema,
  references: z.array(productionReferenceSchema.extend({
    channel: z.enum(['context', 'image', 'audio']),
  }).strict()).max(16).optional(),
  durationSeconds: z.number().int().min(1).max(CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS),
}).strict()

export const productionManifestItemSchema = z.discriminatedUnion('mediaType', [
  manifestImageItemSchema,
  manifestAudioItemSchema,
  manifestVideoItemSchema,
])

export const productionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  manifestId: z.string().trim().min(1).max(191),
  items: z.array(productionManifestItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
}).strict().superRefine((manifest, context) => {
  const itemIds = new Set(manifest.items.map((item) => item.itemId))
  if (itemIds.size !== manifest.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'itemId values must be unique.' })
  }
  const paths = new Set(manifest.items.map((item) => item.outputPath))
  if (paths.size !== manifest.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'outputPath values must be unique.' })
  }
  manifest.items.forEach((item, index) => {
    const positions = item.references?.map((reference) => reference.position) ?? []
    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'references'],
        message: 'Reference positions must be unique.',
      })
    }
  })
})

export type ProductionManifest = z.infer<typeof productionManifestSchema>
export type ProductionManifestItem = z.infer<typeof productionManifestItemSchema>

export const submitProductionManifestInputSchema = z.object({
  manifestPath: z.string().trim().min(1).max(512)
    .regex(/\.json$/u, 'Production manifest must be a JSON workspace file.'),
  maxBudgetCredits: z.number().finite().positive().optional(),
}).strict()
