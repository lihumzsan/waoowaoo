import { z } from 'zod'
import { rawEditBibleBundleSchema } from '@/lib/edit-bible/schemas'
import {
  editScriptStyleBibleSchema,
  editStylePreviewOptionsSchema,
} from '@/lib/edit-script/types'
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

const editBibleBundleOutputSchema = z.object({
  kind: z.literal('edit_bible_bundle'),
  bundle: rawEditBibleBundleSchema,
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

const assetPromptSetOutputSchema = z.object({
  kind: z.literal('asset_prompt_set'),
  overview: z.string().max(8_000),
  assets: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    semanticKind: z.enum(['character', 'location', 'prop', 'other']),
    stableDescription: z.string().min(1).max(16_000)
      .describe('Stable visible asset identity and structure only; exclude transient action and project visual-style wording.'),
    generationPrompt: z.string().min(1).max(24_000)
      .describe('Final image-generation prompt assembled from stable asset facts plus any explicitly supplied Style Bible.'),
    negativePrompt: nullableText(8_000),
    styleSource: z.object({
      sourceMaterialLabel: z.string().trim().min(1).max(240),
      fingerprint: z.string().trim().min(1).max(500).nullable(),
    }).strict().nullable()
      .describe('Exact supplied style source used by generationPrompt, or null when the asset is intentionally designed without a Style Bible.'),
    referenceRequirements: textList(64, 2_000),
    continuityRequirements: textList(64, 2_000),
  }).strict()).min(1).max(256),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const styleBibleCandidateOptionsSchema = editStylePreviewOptionsSchema.refine(
  (value) => value.stylePreviews.length === 3,
  {
    path: ['stylePreviews'],
    message: 'CREATIVE_STYLE_BIBLE_CANDIDATE_COUNT_INVALID',
  },
)

const styleBibleOutputSchema = z.object({
  kind: z.literal('style_bible'),
  design: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('final'),
      styleBible: editScriptStyleBibleSchema.shape.styleBible,
    }).strict(),
    z.object({
      mode: z.literal('candidates'),
      options: styleBibleCandidateOptionsSchema,
    }).strict(),
  ]).describe('Return one finalized Style Bible, or a validated candidate set when the user needs comparison.'),
  assumptions: textList(64, 2_000),
  warnings: textList(64, 2_000),
}).strict()

const videoPromptSetOutputSchema = z.object({
  kind: z.literal('video_prompt_set'),
  overview: z.string().max(8_000),
  aspectRatio: z.string().trim().min(1).max(40),
  targetDurationSeconds: z.number().int().positive(),
  globalDirection: z.object({
    narrativeIntent: z.string().min(1).max(6_000),
    visualContinuity: z.string().min(1).max(6_000),
    performanceDirection: z.string().min(1).max(6_000),
    cameraLanguage: z.string().min(1).max(6_000),
    editingRhythm: z.string().min(1).max(6_000),
    soundStrategy: z.string().min(1).max(6_000),
  }).strict(),
  segments: z.array(z.object({
    key: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    durationSeconds: z.number().finite().positive(),
    narrativePurpose: z.string().min(1).max(4_000),
    entryState: z.string().min(1).max(4_000),
    exitState: z.string().min(1).max(4_000),
    directorTimeline: z.array(z.object({
      startSeconds: z.number().finite().nonnegative(),
      endSeconds: z.number().finite().positive(),
      shotPurpose: z.string().min(1).max(2_000),
      framing: z.string().min(1).max(2_000),
      cameraExecution: z.string().min(1).max(3_000),
      performance: z.string().min(1).max(3_000),
      action: z.string().min(1).max(4_000),
      dialogue: textList(32, 2_000),
      synchronousSound: z.string().min(1).max(3_000),
      transition: nullableText(2_000),
    }).strict()).min(1).max(32),
    finalPrompt: z.string().min(1).max(30_000),
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
  edit_bible_bundle: editBibleBundleOutputSchema,
  continuity_analysis: continuityAnalysisOutputSchema,
  style_bible: styleBibleOutputSchema,
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
  schema: z.ZodObject
}

export const creativeWorkOutputRegistry = {
  screenplay_draft: {
    kind: 'screenplay_draft',
    schema: creativeWorkOutputSchemas.screenplay_draft,
  },
  edit_bible_bundle: {
    kind: 'edit_bible_bundle',
    schema: creativeWorkOutputSchemas.edit_bible_bundle,
  },
  continuity_analysis: {
    kind: 'continuity_analysis',
    schema: creativeWorkOutputSchemas.continuity_analysis,
  },
  style_bible: {
    kind: 'style_bible',
    schema: creativeWorkOutputSchemas.style_bible,
  },
  asset_prompt_set: {
    kind: 'asset_prompt_set',
    schema: creativeWorkOutputSchemas.asset_prompt_set,
  },
  video_prompt_set: {
    kind: 'video_prompt_set',
    schema: creativeWorkOutputSchemas.video_prompt_set,
  },
  music_direction: {
    kind: 'music_direction',
    schema: creativeWorkOutputSchemas.music_direction,
  },
  creative_review: {
    kind: 'creative_review',
    schema: creativeWorkOutputSchemas.creative_review,
  },
} as const satisfies Record<CreativeWorkOutputKind, CreativeWorkOutputDefinition>

export function readCreativeWorkOutputDefinition(
  kind: CreativeWorkOutputKind,
): CreativeWorkOutputDefinition {
  return creativeWorkOutputRegistry[kind]
}
