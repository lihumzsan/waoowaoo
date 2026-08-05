import { z } from 'zod'
import { creativeDirectionSchema } from '@/lib/creative-direction/contracts'
import {
  assetGenerationBatchOutputSchema,
  audioGenerationBatchOutputSchema,
  videoGenerationBatchOutputSchema,
} from '@/lib/workspace-resource/generation-request'
import {
  WORKSPACE_RESOURCE_SCHEMA,
  type WorkspaceResourceSchemaId,
} from '@/lib/workspace-resource/schema-registry'
import type {
  CreativeOutputKind,
  CreativeSkillId,
  CreativeDomainKind,
} from './types'

const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

export const screenplayOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('screenplay'),
  title: z.string().trim().min(1).max(300),
  logline: z.string().trim().max(2_000).nullable(),
  synopsis: z.string().trim().max(12_000),
  screenplayText: z.string().min(1).max(600_000),
  source: z.object({
    kind: z.enum(['generated', 'provided', 'revised']),
    label: z.string().trim().min(1).max(500),
  }).strict(),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict()

const professionalDeliverableSchema = z.discriminatedUnion('domainKind', [
  z.object({ domainKind: z.literal('story'), outputKind: z.literal('screenplay') }).strict(),
  z.object({ domainKind: z.literal('direction'), outputKind: z.literal('creative_direction') }).strict(),
  z.object({ domainKind: z.literal('assets'), outputKind: z.literal('asset_generation_batch') }).strict(),
  z.object({ domainKind: z.literal('video'), outputKind: z.literal('video_generation_batch') }).strict(),
  z.object({ domainKind: z.literal('music'), outputKind: z.literal('audio_generation_batch') }).strict(),
])

export const longFormPlanOutputSchema = z.object({
  schemaVersion: z.literal(2),
  outputKind: z.literal('long_form_plan'),
  overview: z.string().trim().min(1).max(12_000),
  continuityFacts: z.array(z.object({
    key: z.string().trim().min(1).max(191),
    fact: z.string().trim().min(1).max(8_000),
    sourcePaths: textList(64, 512),
  }).strict()).max(4_096),
  productionUnits: z.array(z.object({
    unitId: z.string().trim().min(1).max(191),
    title: z.string().trim().min(1).max(300),
    goal: z.string().trim().min(1).max(8_000),
    sourcePaths: textList(64, 512),
    entryState: z.string().trim().min(1).max(8_000),
    exitState: z.string().trim().min(1).max(8_000),
    dependencies: textList(64, 191),
    deliverables: z.array(professionalDeliverableSchema).max(64),
  }).strict()).min(1).max(1_024),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict().superRefine((plan, context) => {
  const unitIds = new Set(plan.productionUnits.map((unit) => unit.unitId))
  if (unitIds.size !== plan.productionUnits.length) {
    context.addIssue({ code: 'custom', path: ['productionUnits'], message: 'unitId values must be unique.' })
  }
})

export const creativeDirectionOutputSchema = creativeDirectionSchema.safeExtend({
  schemaVersion: z.literal(1),
  outputKind: z.literal('creative_direction'),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

export const CREATIVE_OUTPUT_SCHEMAS = {
  screenplay: screenplayOutputSchema,
  long_form_plan: longFormPlanOutputSchema,
  creative_direction: creativeDirectionOutputSchema,
  asset_generation_batch: assetGenerationBatchOutputSchema,
  video_generation_batch: videoGenerationBatchOutputSchema,
  audio_generation_batch: audioGenerationBatchOutputSchema,
} as const satisfies Record<CreativeOutputKind, z.ZodType>

export const creativeOutputSchema = z.discriminatedUnion('outputKind', [
  screenplayOutputSchema,
  longFormPlanOutputSchema,
  creativeDirectionOutputSchema,
  assetGenerationBatchOutputSchema,
  videoGenerationBatchOutputSchema,
  audioGenerationBatchOutputSchema,
])

export type CreativeOutput = z.infer<typeof creativeOutputSchema>

export const CREATIVE_DOMAIN_OUTPUT_KIND = {
  story: 'screenplay',
  long_form: 'long_form_plan',
  direction: 'creative_direction',
  assets: 'asset_generation_batch',
  video: 'video_generation_batch',
  music: 'audio_generation_batch',
} as const satisfies Record<CreativeDomainKind, CreativeOutputKind>

type CreativeOutputDefinition = {
  readonly outputKind: CreativeOutputKind
  readonly domainKind: CreativeDomainKind
  readonly professionalSkillId: Exclude<CreativeSkillId, 'creative-core'>
  readonly savedDocumentSchemaId: WorkspaceResourceSchemaId
  readonly mediaOperationId: 'create_image' | 'create_audio' | 'create_video' | null
  readonly schema: z.ZodType
}

function defineOutput(
  definition: CreativeOutputDefinition,
): CreativeOutputDefinition {
  return definition
}

export const CREATIVE_OUTPUT_REGISTRY: Readonly<Record<CreativeOutputKind, CreativeOutputDefinition>> = {
  screenplay: defineOutput({
    outputKind: 'screenplay',
    domainKind: 'story',
    professionalSkillId: 'story-development',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
    mediaOperationId: null,
    schema: screenplayOutputSchema,
  }),
  long_form_plan: defineOutput({
    outputKind: 'long_form_plan',
    domainKind: 'long_form',
    professionalSkillId: 'long-form-production',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.LONG_FORM_PLAN,
    mediaOperationId: null,
    schema: longFormPlanOutputSchema,
  }),
  creative_direction: defineOutput({
    outputKind: 'creative_direction',
    domainKind: 'direction',
    professionalSkillId: 'creative-direction',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    mediaOperationId: null,
    schema: creativeDirectionOutputSchema,
  }),
  asset_generation_batch: defineOutput({
    outputKind: 'asset_generation_batch',
    domainKind: 'assets',
    professionalSkillId: 'asset-development',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH,
    mediaOperationId: 'create_image',
    schema: assetGenerationBatchOutputSchema,
  }),
  video_generation_batch: defineOutput({
    outputKind: 'video_generation_batch',
    domainKind: 'video',
    professionalSkillId: 'video-direction',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH,
    mediaOperationId: 'create_video',
    schema: videoGenerationBatchOutputSchema,
  }),
  audio_generation_batch: defineOutput({
    outputKind: 'audio_generation_batch',
    domainKind: 'music',
    professionalSkillId: 'music-direction',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH,
    mediaOperationId: 'create_audio',
    schema: audioGenerationBatchOutputSchema,
  }),
}

export function readCreativeOutputDefinition(outputKind: CreativeOutputKind): CreativeOutputDefinition {
  return CREATIVE_OUTPUT_REGISTRY[outputKind]
}

export function creativeOutputJsonSchema(outputKind: CreativeOutputKind): Record<string, unknown> {
  return z.toJSONSchema(readCreativeOutputDefinition(outputKind).schema) as Record<string, unknown>
}

export function parseCreativeOutput(value: unknown): CreativeOutput {
  return creativeOutputSchema.parse(value)
}

export function safeParseCreativeOutput(value: unknown): ReturnType<typeof creativeOutputSchema.safeParse> {
  return creativeOutputSchema.safeParse(value)
}

export function readCreativeOutputKind(value: unknown): CreativeOutputKind | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const outputKind = (value as Record<string, unknown>).outputKind
  return typeof outputKind === 'string' && outputKind in CREATIVE_OUTPUT_REGISTRY
    ? outputKind as CreativeOutputKind
    : null
}
