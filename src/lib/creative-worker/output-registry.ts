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

const creativeDirectionCandidateKeySchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .describe('Model-authored stable identity for this candidate. It is not tied to a fixed option count or a predefined A/B/C vocabulary.')

const creativeDirectionCandidatesSchema = z.array(z.object({
  candidateKey: creativeDirectionCandidateKeySchema,
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(4_000),
  creativeDirection: creativeDirectionSchema,
}).strict()).min(2).max(12).superRefine((candidates, context) => {
  const keys = new Set<string>()
  for (const [index, candidate] of candidates.entries()) {
    if (keys.has(candidate.candidateKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'candidateKey'],
        message: 'CREATIVE_DIRECTION_CANDIDATE_KEY_DUPLICATE',
      })
    }
    keys.add(candidate.candidateKey)
  }
})

const creativeDirectionOutputSchema = z.object({
  kind: z.literal('creative_direction'),
  design: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('final'),
      creativeDirection: creativeDirectionSchema,
    }).strict(),
    z.object({
      mode: z.literal('candidates'),
      candidates: creativeDirectionCandidatesSchema,
    }).strict(),
  ]).describe('Return one finalized Creative Direction, or a validated candidate set when the user needs comparison.'),
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

const creativeReviewOutputSchema = z.object({
  kind: z.literal('creative_review'),
  verdict: z.enum(['pass', 'revise']),
  summary: z.string().min(1).max(12_000),
  findings: z.array(z.object({
    severity: z.enum(['info', 'warning', 'error']),
    scope: z.string().min(1).max(1_000),
    issue: z.string().min(1).max(4_000),
    recommendation: z.string().min(1).max(4_000),
  }).strict()).max(512),
  preservedStrengths: textList(128, 2_000),
  assumptions: textList(64, 2_000),
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
  creative_review: creativeReviewOutputSchema,
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
  creative_review: {
    kind: 'creative_review',
    schema: creativeWorkOutputSchemas.creative_review,
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
