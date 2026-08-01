import { z } from 'zod'
import { chapterContinuityPlanOutputSchema } from '@/lib/story-canon/schemas'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { creativeDirectionSchema } from '@/lib/creative-direction/contracts'
import {
  assetManifestWorkerOutputSchema,
  screenplayWorkerOutputSchema,
} from '@/lib/screenplay'
import type { CreativeSkillId } from '@/lib/creative-skills'
import type { CreativeWorkOutputKind } from './types'

const nullableText = (max: number) => z.string().max(max).nullable()
const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

const creativeDirectionOutputSchema = z.object({
  kind: z.literal('creative_direction'),
  creativeDirection: creativeDirectionSchema
    .describe('Exactly one complete, final project-level Creative Direction. Resolve alternatives internally; never return multiple versions or candidates.'),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const videoPromptSetOutputSchema = z.object({
  kind: z.literal('video_prompt_set'),
  segments: z.array(z.object({
    key: z.string().trim().min(1).max(160)
      .describe('Stable local identity for this generation segment within the returned set.'),
    durationSeconds: z.number().int().positive()
      .describe('Exact independently generated clip duration selected from productionContext.video.allowedSegmentDurationsSeconds.'),
    prompt: z.string().min(1).max(30_000)
      .describe('The sole creative instruction sent to the video model. It must internalize every applicable directing decision, including visible action, performance, camera, continuity, dialogue, synchronized sound, and any motivated transition.'),
    mediaResourceIds: textList(64, 32)
      .describe('Ordered exact image or audio Resource IDs copied from source materials and used by this segment. The server validates and resolves them directly; use an empty list when no provider media reference is needed.'),
  }).strict().describe('One independently generated video Resource. Its prompt may contain multiple chronologically ordered camera shots that fit within this segment.')).min(1).max(512)
    .describe('Generation segments, not individual camera shots. Never split one unfinished action across two segments.'),
}).strict()

const musicDirectionOutputSchema = z.object({
  kind: z.literal('music_direction'),
  overview: z.string().min(1).max(12_000),
  cues: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    purpose: z.string().min(1).max(4_000),
    musicalDirection: z.string().min(1).max(8_000),
    dialogueSafety: nullableText(2_000),
    generationPrompt: z.string().min(1).max(2_000)
      .describe('The sole creative instruction for generating THIS cue as one independent piece, in English. The music model watches only this cue\'s video window plus this text; it must internalize the cue\'s narrative context, mood arc, instrumentation, spectral and dynamic design, and dialogue safety. The exact character budget is supplied by productionContext.music and is enforced deterministically.'),
  }).strict()).max(8)
    .describe('Executable score cues. Each cue is generated independently for its own video window; everywhere outside a cue the final mix carries no generated music. An empty list means the work intentionally carries no generated music. Cues must be ordered by startSeconds and must not overlap; split at silences of roughly six seconds or longer, where listener memory resets and pieces are independent anyway.'),
  globalContinuity: z.string().max(8_000),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

export const creativeWorkOutputSchemas = {
  screenplay: screenplayWorkerOutputSchema,
  chapter_continuity_plan: chapterContinuityPlanOutputSchema,
  creative_direction: creativeDirectionOutputSchema,
  asset_manifest: assetManifestWorkerOutputSchema,
  video_prompt_set: videoPromptSetOutputSchema,
  music_direction: musicDirectionOutputSchema,
} as const satisfies Record<CreativeWorkOutputKind, z.ZodObject>

export type CreativeWorkOutput = {
  [K in CreativeWorkOutputKind]: z.infer<(typeof creativeWorkOutputSchemas)[K]>
}[CreativeWorkOutputKind]

export interface CreativeWorkOutputDefinition {
  kind: CreativeWorkOutputKind
  professionalSkillId: Exclude<CreativeSkillId, 'creative-core'>
  schema: z.ZodObject
  resourceScope: 'project' | 'episode'
  injectCreativeDirection: boolean
  workerTools: readonly ('web_search')[]
  requiredSourceSchemaIds: readonly string[]
}

export const creativeWorkOutputRegistry = {
  screenplay: {
    kind: 'screenplay',
    professionalSkillId: 'story-development',
    schema: creativeWorkOutputSchemas.screenplay,
    resourceScope: 'project',
    injectCreativeDirection: true,
    workerTools: [],
    requiredSourceSchemaIds: [],
  },
  chapter_continuity_plan: {
    kind: 'chapter_continuity_plan',
    professionalSkillId: 'chapter-continuity-planning',
    schema: creativeWorkOutputSchemas.chapter_continuity_plan,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
    requiredSourceSchemaIds: [CREATIVE_RESOURCE_SCHEMA.SCREENPLAY],
  },
  creative_direction: {
    kind: 'creative_direction',
    professionalSkillId: 'creative-direction',
    schema: creativeWorkOutputSchemas.creative_direction,
    resourceScope: 'project',
    injectCreativeDirection: false,
    workerTools: ['web_search'],
    requiredSourceSchemaIds: [],
  },
  asset_manifest: {
    kind: 'asset_manifest',
    professionalSkillId: 'asset-development',
    schema: creativeWorkOutputSchemas.asset_manifest,
    resourceScope: 'project',
    injectCreativeDirection: true,
    workerTools: [],
    requiredSourceSchemaIds: [CREATIVE_RESOURCE_SCHEMA.SCREENPLAY],
  },
  video_prompt_set: {
    kind: 'video_prompt_set',
    professionalSkillId: 'video-direction',
    schema: creativeWorkOutputSchemas.video_prompt_set,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
    requiredSourceSchemaIds: [],
  },
  music_direction: {
    kind: 'music_direction',
    professionalSkillId: 'music-direction',
    schema: creativeWorkOutputSchemas.music_direction,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
    requiredSourceSchemaIds: [],
  },
} as const satisfies Record<CreativeWorkOutputKind, CreativeWorkOutputDefinition>

export function readCreativeWorkOutputDefinition(
  kind: CreativeWorkOutputKind,
): CreativeWorkOutputDefinition {
  return creativeWorkOutputRegistry[kind]
}
