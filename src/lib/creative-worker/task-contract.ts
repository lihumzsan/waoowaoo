import { z } from 'zod'
import { CREATIVE_SKILL_REGISTRY } from '@/lib/creative-skills'
import { ledgerEntityRefSchema } from '@/lib/edit-ledger'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { CREATIVE_WORK_OUTPUT_KINDS } from './constants'
import { creativeWorkOutputSchemas, type CreativeWorkOutput } from './output-registry'
import {
  creativeWorkDelegationRequestSchema,
  creativeWorkRequestSchema,
} from './types'

const creativeWorkOutputSchema = z.discriminatedUnion('kind', [
  creativeWorkOutputSchemas.screenplay_draft,
  creativeWorkOutputSchemas.edit_bible_bundle,
  creativeWorkOutputSchemas.continuity_analysis,
  creativeWorkOutputSchemas.style_bible,
  creativeWorkOutputSchemas.asset_prompt_set,
  creativeWorkOutputSchemas.video_prompt_set,
  creativeWorkOutputSchemas.music_direction,
  creativeWorkOutputSchemas.creative_review,
])

const creativeSkillTraceEntrySchema = z.object({
  ordinal: z.number().int().positive(),
  source: z.enum(['required', 'tool']),
  skillId: z.string().trim().min(1),
  version: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  checksum: z.string().trim().min(1),
  contentChars: z.number().int().nonnegative(),
}).strict()

export const creativeWorkerResultSchema = z.object({
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  output: creativeWorkOutputSchema,
  skillTrace: z.array(creativeSkillTraceEntrySchema),
  metrics: z.object({
    discoveryCalls: z.number().int().nonnegative(),
    readCalls: z.number().int().nonnegative(),
    skillContentChars: z.number().int().nonnegative(),
  }).strict(),
  budgets: z.object({
    maxTurns: z.number().int().positive(),
    maxDiscoveryCalls: z.number().int().positive(),
    maxReadCalls: z.number().int().positive(),
    maxSkillContentChars: z.number().int().positive(),
    maxSingleSkillResourceChars: z.number().int().positive(),
    maxInputChars: z.number().int().positive(),
    maxOutputChars: z.number().int().positive(),
  }).strict(),
}).strict().superRefine((result, context) => {
  if (result.output.kind === result.outputKind) return
  context.addIssue({
    code: 'custom',
    message: 'CREATIVE_WORK_OUTPUT_KIND_MISMATCH',
    path: ['output'],
  })
})

export const creativeWorkDelegationItemSchema = creativeWorkDelegationRequestSchema.extend({
  requestKey: z.string().trim().min(1).max(200)
    .describe('Caller-owned stable identity for this one logical Subagent request. It must be unique inside a batch and reused only for an explicit retry of the same logical item.'),
}).strict()

export const creativeWorkChapterBatchInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable()
    .describe('Exact episode ID, or null to use the episode currently open in the workspace.'),
  chapters: z.array(z.object({
    chapterId: z.string().trim().min(1)
      .describe('Exact persisted Chapter identity.'),
    requestKey: z.string().trim().min(1).max(200)
      .describe('Caller-owned stable identity for this Chapter Subagent request.'),
  }).strict()).min(1).max(64),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS)
    .describe('Strict structured output contract requested from every Chapter Subagent.'),
  goal: z.string().trim().min(1).max(7_500)
    .describe('Shared professional objective; each Worker also receives its exact compiled Chapter context.'),
  userRequest: z.string().max(30_000)
    .describe('Relevant original user request preserved for every Chapter Worker.'),
  constraints: z.array(z.string().trim().min(1).max(4_000)).max(64)
    .describe('Shared delivery, safety, continuity, or creative constraints. Do not prescribe generation segment count or per-segment durations; the Worker derives them from the server-supplied video production context.'),
  referencedAssets: z.array(z.object({
    resourceId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    fingerprint: z.string().trim().min(1),
    entityRef: ledgerEntityRefSchema.nullable(),
  }).strict()).max(128)
    .describe('Exact Resource revisions the Context Compiler may copy into every relevant Chapter packet, including the required project.style_bible Resource and any image assets.'),
  maxCharsPerChapter: z.number().int().min(4_000).max(200_000)
    .describe('Fail-closed serialized character budget for one compiled Chapter context.'),
}).strict()

export const creativeWorkDelegationInputSchema = z.object({
  kind: z.enum(['single', 'batch', 'chapter_batch'])
    .describe('single delegates request; batch delegates requests; chapter_batch compiles persisted Chapters from chapterBatch.'),
  request: creativeWorkDelegationItemSchema.nullable()
    .describe('The only request when kind=single; otherwise null.'),
  requests: z.array(creativeWorkDelegationItemSchema).min(1).max(64).nullable()
    .describe('Independent caller-supplied requests when kind=batch; otherwise null.'),
  chapterBatch: creativeWorkChapterBatchInputSchema.nullable()
    .describe('Server-side Chapter Context Compiler request when kind=chapter_batch; otherwise null.'),
}).strict().describe('Exactly one payload matching kind must be non-null. Mismatched or extra payloads fail explicitly.')

const creativeWorkTaskProgressEventSchema = z.object({
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  event: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('started'),
      outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
      goal: z.string().trim().min(1),
    }).strict(),
    z.object({
      kind: z.literal('skills_discovered'),
      query: z.string().trim().min(1),
      tags: z.array(z.string()),
      skillIds: z.array(z.string().trim().min(1)),
    }).strict(),
    z.object({
      kind: z.literal('skill_read'),
      trace: creativeSkillTraceEntrySchema,
    }).strict(),
  ]),
}).strict()

export const creativeWorkTaskLifecycleProjectionSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  goal: z.string().trim().min(1).max(8_000),
  events: z.array(creativeWorkTaskProgressEventSchema).max(64),
}).strict()

export const creativeWorkTaskPayloadSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  request: creativeWorkRequestSchema,
  modelKey: z.string().trim().min(1).max(500),
  inputFingerprint: z.string().trim().min(1).max(200),
  origin: z.object({
    runId: z.string().trim().min(1),
    toolCallId: z.string().trim().min(1),
  }).strict(),
  lifecycleProjection: creativeWorkTaskLifecycleProjectionSchema,
}).passthrough()

const creativeWorkContinuationProjectionSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  summary: z.string().trim().min(1).max(4_000),
}).strict()

export const creativeWorkTaskResultSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  summary: z.string().trim().min(1).max(4_000),
  continuationProjection: creativeWorkContinuationProjectionSchema,
  lifecycleProjection: creativeWorkTaskLifecycleProjectionSchema,
  creativeWorkResult: creativeWorkerResultSchema,
}).strict()

export type CreativeWorkDelegationInput = z.infer<typeof creativeWorkDelegationInputSchema>
export type CreativeWorkChapterBatchInput = z.infer<typeof creativeWorkChapterBatchInputSchema>
export type ResolvedCreativeWorkDelegationInput =
  | { readonly kind: 'single'; readonly request: CreativeWorkDelegationItem }
  | { readonly kind: 'batch'; readonly requests: readonly CreativeWorkDelegationItem[] }
  | { readonly kind: 'chapter_batch'; readonly chapterBatch: CreativeWorkChapterBatchInput }
export type CreativeWorkDelegationItem = z.infer<typeof creativeWorkDelegationItemSchema>
export type CreativeWorkTaskRequest = z.infer<typeof creativeWorkRequestSchema>
export type CreativeWorkTaskLifecycleProjection = z.infer<typeof creativeWorkTaskLifecycleProjectionSchema>
export type CreativeWorkTaskPayload = z.infer<typeof creativeWorkTaskPayloadSchema>
export type CreativeWorkTaskResult = z.infer<typeof creativeWorkTaskResultSchema>

export function resolveCreativeWorkDelegationInput(
  input: CreativeWorkDelegationInput,
): ResolvedCreativeWorkDelegationInput {
  if (input.kind === 'single') {
    if (!input.request || input.requests !== null || input.chapterBatch !== null) {
      throw new Error('CREATIVE_WORK_SINGLE_PAYLOAD_INVALID')
    }
    return { kind: 'single', request: input.request }
  }
  if (input.kind === 'batch') {
    if (input.request !== null || !input.requests || input.chapterBatch !== null) {
      throw new Error('CREATIVE_WORK_BATCH_PAYLOAD_INVALID')
    }
    return { kind: 'batch', requests: input.requests }
  }
  if (input.request !== null || input.requests !== null || !input.chapterBatch) {
    throw new Error('CREATIVE_WORK_CHAPTER_BATCH_PAYLOAD_INVALID')
  }
  return { kind: 'chapter_batch', chapterBatch: input.chapterBatch }
}

export function listCreativeWorkDelegationItems(
  input: Exclude<ResolvedCreativeWorkDelegationInput, { readonly kind: 'chapter_batch' }>,
): CreativeWorkDelegationItem[] {
  return input.kind === 'single' ? [input.request] : [...input.requests]
}

export function buildCreativeWorkInputFingerprint(input: {
  request: CreativeWorkTaskRequest & { readonly requestKey: string }
  modelKey: string
}): string {
  return stableArgsHash({
    request: input.request,
    modelKey: input.modelKey,
    skills: Object.values(CREATIVE_SKILL_REGISTRY).map((skill) => ({
      id: skill.id,
      version: skill.version,
    })),
  })
}

export function summarizeCreativeWorkOutput(output: CreativeWorkOutput): string {
  switch (output.kind) {
    case 'screenplay_draft':
      return output.logline || output.synopsis || output.title
    case 'edit_bible_bundle':
      return output.bundle.bible.logline || output.bundle.bible.synopsis
    case 'continuity_analysis':
      return output.summary
    case 'style_bible':
      return output.design.mode === 'final'
        ? output.design.styleBible.styleSummary
        : output.design.options.stylePreviews.map((preview) => preview.title).join(' / ')
    case 'asset_prompt_set':
      return output.overview || output.assets.map((asset) => asset.title).join(' / ')
    case 'video_prompt_set':
      return output.overview || output.segments.map((segment) => segment.title).join(' / ')
    case 'music_direction':
      return output.overview
    case 'creative_review':
      return output.summary
  }
}
