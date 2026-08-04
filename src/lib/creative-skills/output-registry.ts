import { z } from 'zod'
import { creativeDirectionSchema } from '@/lib/creative-direction/contracts'
import {
  assetManifestOutputSchema,
  musicDirectionOutputSchema,
  videoPromptSetOutputSchema,
} from '@/lib/workspace-resource/production-manifest'
import {
  WORKSPACE_RESOURCE_SCHEMA,
  type WorkspaceResourceSchemaId,
} from '@/lib/workspace-resource/schema-registry'
import type {
  CreativeOutputKind,
  CreativeSkillId,
  CreativeWorkerKind,
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

const professionalOutputPathSchema = z.string().min(1).max(512)
  .regex(
    /^(?!\/)(?!\.\.?\/)(?!.*\/\.\.?(?:\/|$))(?!.*\\)(?!system(?:\/|$))(?!\.wao(?:\/|$)).+\.json$/u,
    'outputPath must be one normalized project-relative .json path.',
  )

const professionalDeliverableSchema = z.discriminatedUnion('workerKind', [
  z.object({ workerKind: z.literal('story'), outputKind: z.literal('screenplay'), outputPath: professionalOutputPathSchema }).strict(),
  z.object({ workerKind: z.literal('direction'), outputKind: z.literal('creative_direction'), outputPath: professionalOutputPathSchema }).strict(),
  z.object({ workerKind: z.literal('assets'), outputKind: z.literal('asset_manifest'), outputPath: professionalOutputPathSchema }).strict(),
  z.object({ workerKind: z.literal('video'), outputKind: z.literal('video_prompt_set'), outputPath: professionalOutputPathSchema }).strict(),
  z.object({ workerKind: z.literal('music'), outputKind: z.literal('music_direction'), outputPath: professionalOutputPathSchema }).strict(),
])

export const longFormPlanOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('long_form_plan'),
  overview: z.string().trim().min(1).max(12_000),
  workspaceStructure: z.array(z.object({
    path: z.string().trim().min(1).max(512),
    purpose: z.string().trim().min(1).max(4_000),
  }).strict()).max(1_024),
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
    outputDirectory: z.string().trim().min(1).max(512),
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
  asset_manifest: assetManifestOutputSchema,
  video_prompt_set: videoPromptSetOutputSchema,
  music_direction: musicDirectionOutputSchema,
} as const satisfies Record<CreativeOutputKind, z.ZodType>

export const creativeOutputSchema = z.discriminatedUnion('outputKind', [
  screenplayOutputSchema,
  longFormPlanOutputSchema,
  creativeDirectionOutputSchema,
  assetManifestOutputSchema,
  videoPromptSetOutputSchema,
  musicDirectionOutputSchema,
])

export type CreativeOutput = z.infer<typeof creativeOutputSchema>

export const CREATIVE_WORKER_OUTPUT_KIND = {
  story: 'screenplay',
  long_form: 'long_form_plan',
  direction: 'creative_direction',
  assets: 'asset_manifest',
  video: 'video_prompt_set',
  music: 'music_direction',
} as const satisfies Record<CreativeWorkerKind, CreativeOutputKind>

type CreativeOutputDefinition = {
  readonly outputKind: CreativeOutputKind
  readonly workerKind: CreativeWorkerKind
  readonly professionalSkillId: Exclude<CreativeSkillId, 'creative-core'>
  readonly workspaceSchemaId: WorkspaceResourceSchemaId
  readonly production: boolean
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
    workerKind: 'story',
    professionalSkillId: 'story-development',
    workspaceSchemaId: WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
    production: false,
    schema: screenplayOutputSchema,
  }),
  long_form_plan: defineOutput({
    outputKind: 'long_form_plan',
    workerKind: 'long_form',
    professionalSkillId: 'long-form-production',
    workspaceSchemaId: WORKSPACE_RESOURCE_SCHEMA.LONG_FORM_PLAN,
    production: false,
    schema: longFormPlanOutputSchema,
  }),
  creative_direction: defineOutput({
    outputKind: 'creative_direction',
    workerKind: 'direction',
    professionalSkillId: 'creative-direction',
    workspaceSchemaId: WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    production: false,
    schema: creativeDirectionOutputSchema,
  }),
  asset_manifest: defineOutput({
    outputKind: 'asset_manifest',
    workerKind: 'assets',
    professionalSkillId: 'asset-development',
    workspaceSchemaId: WORKSPACE_RESOURCE_SCHEMA.ASSET_MANIFEST,
    production: true,
    schema: assetManifestOutputSchema,
  }),
  video_prompt_set: defineOutput({
    outputKind: 'video_prompt_set',
    workerKind: 'video',
    professionalSkillId: 'video-direction',
    workspaceSchemaId: WORKSPACE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET,
    production: true,
    schema: videoPromptSetOutputSchema,
  }),
  music_direction: defineOutput({
    outputKind: 'music_direction',
    workerKind: 'music',
    professionalSkillId: 'music-direction',
    workspaceSchemaId: WORKSPACE_RESOURCE_SCHEMA.MUSIC_DIRECTION,
    production: true,
    schema: musicDirectionOutputSchema,
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
