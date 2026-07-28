import { z } from 'zod'
import {
  creativeChapterPlanOutputSchema,
  rawStoryCanonBundleSchema,
} from '@/lib/story-canon/schemas'
import { creativeDirectionSchema } from '@/lib/creative-direction/contracts'
import {
  assetManifestWorkerOutputSchema,
  screenplayWorkerOutputSchema,
} from '@/lib/screenplay'
import type { CreativeWorkOutputKind } from './types'

const nullableText = (max: number) => z.string().max(max).nullable()
const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

const storyCanonBundleOutputSchema = z.object({
  kind: z.literal('story_canon'),
  bundle: rawStoryCanonBundleSchema,
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const continuityAnalysisOutputSchema = z.object({
  kind: z.literal('continuity_analysis'),
  summary: z.string().min(1).max(20_000),
  canonFacts: z.array(z.object({
    subject: z.string().trim().min(1).max(300),
    fact: z.string().min(1).max(4_000),
    scope: z.string().min(1).max(1_000),
    source: nullableText(2_000),
    confidence: z.enum(['explicit', 'inferred', 'proposed']),
  }).strict()).max(2_000),
  stateTransitions: z.array(z.object({
    subject: z.string().trim().min(1).max(300),
    before: nullableText(3_000),
    change: z.string().min(1).max(4_000),
    after: z.string().min(1).max(3_000),
    source: nullableText(2_000),
  }).strict()).max(2_000),
  unresolved: textList(256, 4_000),
  assumptions: textList(64, 2_000),
}).strict()

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
    referenceKeys: textList(64, 300)
      .describe('Ordered exact source-material labels whose image or audio revisions the primary Agent maps to the independently numbered @ImageN and @AudioN references used by prompt; use an empty list when no provider media reference is needed.'),
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
  }).strict()).max(512),
  globalContinuity: z.string().max(8_000),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

export const creativeWorkOutputSchemas = {
  screenplay: screenplayWorkerOutputSchema,
  story_canon: storyCanonBundleOutputSchema,
  chapter_plan: creativeChapterPlanOutputSchema,
  continuity_analysis: continuityAnalysisOutputSchema,
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
  schema: z.ZodObject
  resourceScope: 'project' | 'episode'
  injectCreativeDirection: boolean
  workerTools: readonly ('web_search')[]
}

export const creativeWorkOutputRegistry = {
  screenplay: {
    kind: 'screenplay',
    schema: creativeWorkOutputSchemas.screenplay,
    resourceScope: 'project',
    injectCreativeDirection: true,
    workerTools: [],
  },
  story_canon: {
    kind: 'story_canon',
    schema: creativeWorkOutputSchemas.story_canon,
    resourceScope: 'project',
    injectCreativeDirection: true,
    workerTools: [],
  },
  chapter_plan: {
    kind: 'chapter_plan',
    schema: creativeWorkOutputSchemas.chapter_plan,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
  },
  continuity_analysis: {
    kind: 'continuity_analysis',
    schema: creativeWorkOutputSchemas.continuity_analysis,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
  },
  creative_direction: {
    kind: 'creative_direction',
    schema: creativeWorkOutputSchemas.creative_direction,
    resourceScope: 'project',
    injectCreativeDirection: false,
    workerTools: ['web_search'],
  },
  asset_manifest: {
    kind: 'asset_manifest',
    schema: creativeWorkOutputSchemas.asset_manifest,
    resourceScope: 'project',
    injectCreativeDirection: true,
    workerTools: [],
  },
  video_prompt_set: {
    kind: 'video_prompt_set',
    schema: creativeWorkOutputSchemas.video_prompt_set,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
  },
  music_direction: {
    kind: 'music_direction',
    schema: creativeWorkOutputSchemas.music_direction,
    resourceScope: 'episode',
    injectCreativeDirection: true,
    workerTools: [],
  },
} as const satisfies Record<CreativeWorkOutputKind, CreativeWorkOutputDefinition>

export function readCreativeWorkOutputDefinition(
  kind: CreativeWorkOutputKind,
): CreativeWorkOutputDefinition {
  return creativeWorkOutputRegistry[kind]
}
