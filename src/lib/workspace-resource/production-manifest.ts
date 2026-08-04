import { z } from 'zod'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from './generation-contract'
import { workspaceResourceInputRefSchema } from './generation-contract'
import {
  validateWorkspaceResourceFilePath,
  WorkspaceResourcePathError,
} from './path'
import {
  WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  WORKSPACE_RESOURCE_SCHEMA,
} from './schema-registry'

const projectRelativePathPrefixSchema = z.string().min(1).max(512)
  .regex(
    /^(?!\/)(?!\.\.?\/)(?!.*\/\.\.?(?:\/|$))(?!.*\\)(?!system(?:\/|$))(?!\.wao(?:\/|$)).+$/u,
    'Path must be project-relative and stay inside the user workspace.',
  )

function workspaceFilePathSchema(extension: '.json' | '.resource', label: string): z.ZodType<string> {
  return projectRelativePathPrefixSchema
    .regex(new RegExp(`\\${extension}$`, 'u'), `${label} must end in ${extension}.`)
    .superRefine((value, context) => {
      try {
        validateWorkspaceResourceFilePath(value)
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof WorkspaceResourcePathError
            ? error.message
            : `${label} is not a valid project-relative workspace path.`,
        })
      }
    })
    .describe(`${label}: a normalized project-relative workspace path ending in ${extension}; absolute Runtime paths, ./, ../, system/, .wao/, backslashes, and hidden segments are forbidden.`)
}

const workspaceReferencePathSchema = projectRelativePathPrefixSchema
  .superRefine((value, context) => {
    try {
      validateWorkspaceResourceFilePath(value)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof WorkspaceResourcePathError
          ? error.message
          : 'Reference workspacePath is not a valid project-relative file path.',
      })
    }
  })
  .describe('Current normalized project-relative path of the referenced WorkspaceResource file.')

const productionReferenceSchema = workspaceResourceInputRefSchema.extend({
  workspacePath: workspaceReferencePathSchema,
  channel: z.enum(['context', 'image', 'audio', 'video']),
}).strict()

const productionOutputPathSchema = workspaceFilePathSchema('.resource', 'outputPath')

const finalPromptSchema = z.string().min(1).max(100_000)
  .refine((value) => value.trim().length > 0, 'prompt must contain non-whitespace content.')
  .describe('Complete final provider-ready creative prompt. The server validates and freezes it verbatim and never appends creative instructions.')

const aspectRatioSchema = z.string().trim().min(3).max(20)
  .regex(/^\d+:\d+$/u, 'aspectRatio must use W:H form.')

const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

const commonShape = {
  itemId: z.string().trim().min(1).max(191),
  outputPath: productionOutputPathSchema,
  prompt: finalPromptSchema,
} as const

const executionImageItemSchema = z.object({
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

const executionAudioItemSchema = z.object({
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

const executionVideoItemSchema = z.object({
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
  executionImageItemSchema,
  executionAudioItemSchema,
  executionVideoItemSchema,
])

const assetIdentityShape = {
  canonicalName: z.string().trim().min(1).max(300),
  aliases: textList(64, 300),
  stableDescription: z.string().trim().min(1).max(16_000)
    .describe('Stable visible identity and reusable physical design only; exclude framing, layout, provider parameters, and transient action.'),
  consumedByShots: textList(512, 512)
    .describe('Project-relative screenplay, unit, or shot identities that actually reuse this asset.'),
} as const

const assetItemCommonShape = {
  ...commonShape,
  ...assetIdentityShape,
  mediaType: z.literal('image'),
  aspectRatio: z.literal('4:3'),
  references: z.array(productionReferenceSchema.extend({
    channel: z.enum(['context', 'image']),
  }).strict()).max(16).optional(),
} as const

const assetManifestItemSchema = z.discriminatedUnion('assetKind', [
  z.object({
    ...assetItemCommonShape,
    assetKind: z.literal('character'),
    schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE),
  }).strict(),
  z.object({
    ...assetItemCommonShape,
    assetKind: z.literal('location'),
    schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE),
  }).strict(),
  z.object({
    ...assetItemCommonShape,
    assetKind: z.literal('prop'),
    schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE),
  }).strict(),
])

export const assetManifestOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('asset_manifest'),
  manifestId: z.string().trim().min(1).max(191),
  decision: z.enum(['produce', 'no_assets'])
    .describe('Use produce with one or more items. Use no_assets only when no reusable asset is justified, with items empty.'),
  overview: z.string().trim().min(1).max(8_000),
  items: z.array(assetManifestItemSchema).max(OPERATION_EXECUTION_MAX_TASKS),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict().superRefine((manifest, context) => {
  if (manifest.decision === 'produce' && manifest.items.length === 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=produce requires at least one asset item.' })
  }
  if (manifest.decision === 'no_assets' && manifest.items.length !== 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=no_assets requires items to be empty.' })
  }
})

export const videoPromptSetOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('video_prompt_set'),
  manifestId: z.string().trim().min(1).max(191),
  overview: z.string().trim().min(1).max(8_000),
  items: z.array(executionVideoItemSchema).min(1).max(OPERATION_EXECUTION_MAX_TASKS),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const musicCueItemSchema = z.object({
  ...commonShape,
  mediaType: z.literal('audio'),
  schemaId: z.literal(WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO),
  references: z.array(productionReferenceSchema.extend({
    channel: z.enum(['context', 'video']),
  }).strict()).max(16).optional(),
  startSeconds: z.number().finite().nonnegative(),
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: z.literal('instrumental'),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  purpose: z.string().trim().min(1).max(4_000),
  musicalDirection: z.string().trim().min(1).max(8_000),
  dialogueSafety: z.string().trim().min(1).max(2_000).nullable(),
}).strict()

export const musicDirectionOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('music_direction'),
  manifestId: z.string().trim().min(1).max(191),
  decision: z.enum(['produce', 'no_music'])
    .describe('Use produce with one or more cues. Use no_music only for an intentional no-score decision, with items empty.'),
  overview: z.string().trim().min(1).max(12_000),
  items: z.array(musicCueItemSchema).max(8),
  globalContinuity: z.string().trim().max(8_000),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict().superRefine((manifest, context) => {
  if (manifest.decision === 'produce' && manifest.items.length === 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=produce requires at least one music cue.' })
  }
  if (manifest.decision === 'no_music' && manifest.items.length !== 0) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'decision=no_music requires items to be empty.' })
  }
  let previousEnd = 0
  manifest.items.forEach((item, index) => {
    if (item.startSeconds < previousEnd) {
      context.addIssue({ code: 'custom', path: ['items', index, 'startSeconds'], message: 'Music cues must be ordered and must not overlap.' })
    }
    previousEnd = item.startSeconds + item.durationSeconds
  })
})

const productionManifestSchemas = [
  assetManifestOutputSchema,
  videoPromptSetOutputSchema,
  musicDirectionOutputSchema,
] as const

export const productionManifestSchema = z.discriminatedUnion('outputKind', productionManifestSchemas)
  .superRefine((manifest, context) => {
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
  manifestPath: workspaceFilePathSchema('.json', 'manifestPath'),
  maxBudgetCredits: z.number().finite().positive().optional(),
}).strict()
