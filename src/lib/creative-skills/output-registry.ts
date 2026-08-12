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

const commercialSubjectSchema = z.object({
  name: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(300),
  verifiedFacts: textList(128, 4_000),
}).strict()

const commercialDeliverableSchema = z.object({
  channel: z.string().trim().min(1).max(300),
  durationSeconds: z.number().int().positive().max(3_600).nullable(),
  language: z.string().trim().min(1).max(100),
  aspectRatio: z.string().trim().min(1).max(32).nullable(),
}).strict()

export const commercialBriefOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('commercial_brief'),
  title: z.string().trim().min(1).max(300),
  objective: z.string().trim().min(1).max(8_000),
  audience: textList(64, 2_000),
  subject: commercialSubjectSchema,
  valueProposition: z.string().trim().min(1).max(8_000),
  keyMessage: z.string().trim().min(1).max(4_000),
  callToAction: z.string().trim().min(1).max(2_000).nullable(),
  deliverables: z.array(commercialDeliverableSchema).min(1).max(64),
  brandConstraints: textList(128, 4_000),
  mandatoryElements: textList(128, 4_000),
  prohibitedClaims: textList(128, 4_000),
  sourceFacts: z.array(z.object({
    fact: z.string().trim().min(1).max(4_000),
    source: z.string().trim().min(1).max(1_000),
  }).strict()).max(256),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict()

const commercialScriptBeatSchema = z.object({
  sequence: z.number().int().positive(),
  startSeconds: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().positive(),
  visual: z.string().trim().min(1).max(12_000),
  dialogue: z.string().trim().min(1).max(8_000).nullable(),
  voiceOver: z.string().trim().min(1).max(8_000).nullable(),
  onScreenText: textList(32, 1_000),
  sound: z.string().trim().min(1).max(4_000).nullable(),
  transition: z.string().trim().min(1).max(2_000).nullable(),
}).strict()

export const commercialScriptOutputSchema = z.object({
  schemaVersion: z.literal(1),
  outputKind: z.literal('commercial_script'),
  sourceBrief: z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict(),
  title: z.string().trim().min(1).max(300),
  conceptSummary: z.string().trim().min(1).max(8_000),
  targetDurationSeconds: z.number().int().positive().max(3_600),
  beats: z.array(commercialScriptBeatSchema).min(1).max(512),
  endCard: z.object({
    visual: z.string().trim().min(1).max(4_000),
    onScreenText: textList(32, 1_000),
    callToAction: z.string().trim().min(1).max(2_000).nullable(),
  }).strict(),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict().superRefine((script, context) => {
  let cursor = 0
  script.beats.forEach((beat, index) => {
    if (beat.sequence !== index + 1) {
      context.addIssue({ code: 'custom', path: ['beats', index, 'sequence'], message: 'sequence must be contiguous and one-based.' })
    }
    if (Math.abs(beat.startSeconds - cursor) > 0.001) {
      context.addIssue({ code: 'custom', path: ['beats', index, 'startSeconds'], message: 'beats must form one contiguous timeline.' })
    }
    cursor = beat.startSeconds + beat.durationSeconds
  })
  if (Math.abs(cursor - script.targetDurationSeconds) > 0.001) {
    context.addIssue({ code: 'custom', path: ['beats'], message: 'beat durations must sum exactly to targetDurationSeconds.' })
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
  commercial_brief: commercialBriefOutputSchema,
  commercial_script: commercialScriptOutputSchema,
  creative_direction: creativeDirectionOutputSchema,
  asset_generation_batch: assetGenerationBatchOutputSchema,
  video_generation_batch: videoGenerationBatchOutputSchema,
  audio_generation_batch: audioGenerationBatchOutputSchema,
} as const satisfies Record<CreativeOutputKind, z.ZodType>

export const creativeOutputSchema = z.discriminatedUnion('outputKind', [
  screenplayOutputSchema,
  commercialBriefOutputSchema,
  commercialScriptOutputSchema,
  creativeDirectionOutputSchema,
  assetGenerationBatchOutputSchema,
  videoGenerationBatchOutputSchema,
  audioGenerationBatchOutputSchema,
])

export type CreativeOutput = z.infer<typeof creativeOutputSchema>

export const CREATIVE_DOMAIN_OUTPUT_KIND = {
  story: 'screenplay',
  commercial_brief: 'commercial_brief',
  commercial_script: 'commercial_script',
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
  commercial_brief: defineOutput({
    outputKind: 'commercial_brief',
    domainKind: 'commercial_brief',
    professionalSkillId: 'commercial-brief',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.COMMERCIAL_BRIEF,
    mediaOperationId: null,
    schema: commercialBriefOutputSchema,
  }),
  commercial_script: defineOutput({
    outputKind: 'commercial_script',
    domainKind: 'commercial_script',
    professionalSkillId: 'commercial-script',
    savedDocumentSchemaId: WORKSPACE_RESOURCE_SCHEMA.COMMERCIAL_SCRIPT,
    mediaOperationId: null,
    schema: commercialScriptOutputSchema,
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
