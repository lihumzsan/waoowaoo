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
import {
  creativeSkillReadTraceEntrySchema,
  creativeWorkTraceEventSchema,
} from './trace-contract'

const creativeWorkOutputSchema = z.discriminatedUnion('kind', [
  creativeWorkOutputSchemas.screenplay,
  creativeWorkOutputSchemas.edit_bible_bundle,
  creativeWorkOutputSchemas.chapter_plan,
  creativeWorkOutputSchemas.continuity_analysis,
  creativeWorkOutputSchemas.style_bible,
  creativeWorkOutputSchemas.asset_manifest,
  creativeWorkOutputSchemas.video_prompt_set,
  creativeWorkOutputSchemas.music_direction,
  creativeWorkOutputSchemas.creative_review,
])

export const creativeWorkerResultSchema = z.object({
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  output: creativeWorkOutputSchema,
  skillTrace: z.array(creativeSkillReadTraceEntrySchema),
  metrics: z.object({
    readCalls: z.number().int().nonnegative(),
    skillContentChars: z.number().int().nonnegative(),
  }).strict(),
  budgets: z.object({
    maxTurns: z.number().int().positive(),
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
  source: z.literal('chapters')
    .describe('Compile the persisted Chapter identities below into independent Creative Worker requests.'),
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
    revisionId: z.string().trim().min(1),
    entityRef: ledgerEntityRefSchema.nullable(),
  }).strict()).max(128)
    .describe('Exact Resource revisions the Context Compiler may copy into every relevant Chapter packet, including an optional Style Bible and any relevant media assets.'),
}).strict()

const creativeWorkRequestBatchInputSchema = z.object({
  source: z.literal('requests')
    .describe('Delegate one or more caller-supplied, self-contained Creative Worker requests.'),
  requests: z.array(creativeWorkDelegationItemSchema).min(1).max(64)
    .describe('One request is one Subagent Task. Multiple independent requests run through the existing Task batch and collecting Wait.'),
}).strict()

const creativeWorkDelegationSourceSchema = z.discriminatedUnion('source', [
  creativeWorkRequestBatchInputSchema,
  creativeWorkChapterBatchInputSchema,
])

export const creativeWorkDelegationInputSchema = z.object({
  delegation: creativeWorkDelegationSourceSchema
    .describe('Choose exactly one input source. No inactive branch or null placeholder is accepted.'),
}).strict()

const creativeWorkTaskProgressEventSchema = z.object({
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  event: creativeWorkTraceEventSchema,
}).strict()

export const creativeWorkTaskLifecycleProjectionSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  goal: z.string().trim().min(1).max(8_000),
  events: z.array(creativeWorkTaskProgressEventSchema).max(64),
}).strict()

export const CREATIVE_WORK_TASK_PROTOCOL = 'creative_work_v5' as const

export const creativeWorkTaskPayloadSchema = z.object({
  protocol: z.literal(CREATIVE_WORK_TASK_PROTOCOL),
  requestKey: z.string().trim().min(1).max(200),
  request: creativeWorkRequestSchema,
  modelKey: z.string().trim().min(1).max(500),
  inputFingerprint: z.string().trim().min(1).max(200),
  origin: z.object({
    runId: z.string().trim().min(1),
    toolCallId: z.string().trim().min(1),
  }).strict(),
  lifecycleProjection: creativeWorkTaskLifecycleProjectionSchema,
  stage: z.string().trim().min(1).optional(),
  stageLabel: z.string().trim().min(1).optional(),
  displayMode: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  flowId: z.string().trim().min(1).optional(),
  flowStageTitle: z.string().trim().min(1).optional(),
  flowStageIndex: z.number().int().positive().optional(),
  flowStageTotal: z.number().int().positive().optional(),
  runId: z.string().trim().min(1).optional(),
  ui: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict()

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
  resources: z.array(z.object({
    resourceId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    schemaId: z.string().trim().min(1),
    mediaType: z.enum(['text', 'image', 'audio', 'video']),
    name: z.string().trim().min(1),
    candidateKey: z.string().trim().min(1).nullable(),
  }).strict()).min(1).optional()
    .describe('Exact immutable Resource revisions materialized atomically from this completed result. Absent when this output kind has no persistent Resource projection.'),
}).strict().superRefine((result, context) => {
  const mismatches: Array<{ readonly path: readonly PropertyKey[]; readonly code: string }> = []
  if (result.continuationProjection.requestKey !== result.requestKey) {
    mismatches.push({
      path: ['continuationProjection', 'requestKey'],
      code: 'CREATIVE_WORK_RESULT_REQUEST_KEY_MISMATCH',
    })
  }
  if (result.lifecycleProjection.requestKey !== result.requestKey) {
    mismatches.push({
      path: ['lifecycleProjection', 'requestKey'],
      code: 'CREATIVE_WORK_RESULT_LIFECYCLE_REQUEST_KEY_MISMATCH',
    })
  }
  if (
    result.continuationProjection.outputKind !== result.outputKind
    || result.lifecycleProjection.outputKind !== result.outputKind
    || result.creativeWorkResult.outputKind !== result.outputKind
  ) {
    mismatches.push({ path: ['outputKind'], code: 'CREATIVE_WORK_RESULT_OUTPUT_KIND_MISMATCH' })
  }
  if (result.continuationProjection.summary !== result.summary) {
    mismatches.push({
      path: ['continuationProjection', 'summary'],
      code: 'CREATIVE_WORK_RESULT_SUMMARY_MISMATCH',
    })
  }
  for (const mismatch of mismatches) {
    context.addIssue({ code: 'custom', path: [...mismatch.path], message: mismatch.code })
  }
})

export type CreativeWorkDelegationInput = z.infer<typeof creativeWorkDelegationInputSchema>
export type CreativeWorkChapterBatchInput = z.infer<typeof creativeWorkChapterBatchInputSchema>
export type CreativeWorkDelegationItem = z.infer<typeof creativeWorkDelegationItemSchema>
export type CreativeWorkTaskRequest = z.infer<typeof creativeWorkRequestSchema>
export type CreativeWorkTaskEvent = z.infer<typeof creativeWorkTraceEventSchema>
export type CreativeWorkTaskLifecycleProjection = z.infer<typeof creativeWorkTaskLifecycleProjectionSchema>
export type CreativeWorkTaskPayload = z.infer<typeof creativeWorkTaskPayloadSchema>
export type CreativeWorkTaskResult = z.infer<typeof creativeWorkTaskResultSchema>

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
    case 'screenplay':
      return output.logline || output.synopsis || output.title
    case 'edit_bible_bundle':
      return output.bundle.bible.logline || output.bundle.bible.synopsis
    case 'chapter_plan':
      return output.rationale
    case 'continuity_analysis':
      return output.summary
    case 'style_bible':
      return output.design.mode === 'final'
        ? output.design.styleBible.styleSummary
        : output.design.candidates.map((candidate) => candidate.title).join(' / ')
    case 'asset_manifest':
      return output.overview || output.assets.map((asset) => asset.canonicalName).join(' / ')
    case 'video_prompt_set':
      return output.segments.map((segment) => segment.key).join(' / ').slice(0, 4_000)
    case 'music_direction':
      return output.overview
    case 'creative_review':
      return output.summary
  }
}
