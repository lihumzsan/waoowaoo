import { z } from 'zod'
import type { CreativeSkillId } from '@/lib/creative-skills'
import type { CreativeWorkOutputKind } from './types'

const nullableText = (max: number) => z.string().max(max).nullable()
const textList = (maxItems: number, maxLength: number) => z.array(
  z.string().trim().min(1).max(maxLength),
).max(maxItems)

const screenplayDraftOutputSchema = z.object({
  kind: z.literal('screenplay_draft'),
  title: z.string().trim().min(1).max(300),
  logline: nullableText(2_000),
  synopsis: z.string().max(12_000),
  screenplay: z.string().min(1).max(100_000),
  estimatedDurationSeconds: z.number().finite().nonnegative().nullable(),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
}).strict()

const storyAnalysisOutputSchema = z.object({
  kind: z.literal('story_analysis'),
  summary: z.string().min(1).max(20_000),
  themes: textList(64, 2_000),
  characters: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(300),
    role: z.string().max(2_000),
    arc: z.string().max(6_000),
  }).strict()).max(256),
  locations: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(300),
    narrativeFunction: z.string().max(4_000),
  }).strict()).max(256),
  chronology: z.array(z.object({
    order: z.number().int().nonnegative(),
    event: z.string().min(1).max(6_000),
    source: nullableText(2_000),
  }).strict()).max(1_024),
  conflicts: textList(256, 4_000),
  assumptions: textList(64, 2_000),
  openQuestions: textList(64, 2_000),
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

const assetPromptSetOutputSchema = z.object({
  kind: z.literal('asset_prompt_set'),
  overview: z.string().max(8_000),
  assets: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    semanticKind: z.enum(['character', 'location', 'prop', 'style', 'other']),
    prompt: z.string().min(1).max(16_000),
    negativePrompt: nullableText(8_000),
    referenceRequirements: textList(64, 2_000),
    continuityRequirements: textList(64, 2_000),
  }).strict()).min(1).max(256),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const videoPromptSetOutputSchema = z.object({
  kind: z.literal('video_prompt_set'),
  overview: z.string().max(8_000),
  segments: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    durationSeconds: z.number().finite().positive(),
    prompt: z.string().min(1).max(20_000),
    referenceKeys: textList(64, 300),
    continuityRequirements: textList(64, 2_000),
    audioIntent: nullableText(4_000),
  }).strict().describe('One independently generated video Resource. Its prompt may contain multiple chronologically ordered camera shots that fit within this segment.')).min(1).max(512)
    .describe('Generation segments, not individual camera shots. Never split one unfinished action across two segments.'),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
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
  screenplay_draft: screenplayDraftOutputSchema,
  story_analysis: storyAnalysisOutputSchema,
  continuity_analysis: continuityAnalysisOutputSchema,
  asset_prompt_set: assetPromptSetOutputSchema,
  video_prompt_set: videoPromptSetOutputSchema,
  music_direction: musicDirectionOutputSchema,
  creative_review: creativeReviewOutputSchema,
} as const satisfies Record<CreativeWorkOutputKind, z.ZodObject>

export type CreativeWorkOutput = {
  [K in CreativeWorkOutputKind]: z.infer<(typeof creativeWorkOutputSchemas)[K]>
}[CreativeWorkOutputKind]

export interface CreativeWorkOutputDefinition {
  kind: CreativeWorkOutputKind
  baselineSkillIds: readonly CreativeSkillId[]
  schema: z.ZodObject
}

export const creativeWorkOutputRegistry = {
  screenplay_draft: {
    kind: 'screenplay_draft',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.screenplay_draft,
  },
  story_analysis: {
    kind: 'story_analysis',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.story_analysis,
  },
  continuity_analysis: {
    kind: 'continuity_analysis',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.continuity_analysis,
  },
  asset_prompt_set: {
    kind: 'asset_prompt_set',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.asset_prompt_set,
  },
  video_prompt_set: {
    kind: 'video_prompt_set',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.video_prompt_set,
  },
  music_direction: {
    kind: 'music_direction',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.music_direction,
  },
  creative_review: {
    kind: 'creative_review',
    baselineSkillIds: ['creative-core'],
    schema: creativeWorkOutputSchemas.creative_review,
  },
} as const satisfies Record<CreativeWorkOutputKind, CreativeWorkOutputDefinition>

export function readCreativeWorkOutputDefinition(
  kind: CreativeWorkOutputKind,
): CreativeWorkOutputDefinition {
  return creativeWorkOutputRegistry[kind]
}
