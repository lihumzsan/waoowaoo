import { z } from 'zod'
import { CREATIVE_SKILL_REGISTRY } from '@/lib/creative-skills'
import { ledgerEntityRefSchema } from '@/lib/edit-ledger'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { taskRuntimePayloadEnvelopeShape } from '@/lib/task/progress-payload'
import { CREATIVE_WORK_OUTPUT_KINDS } from './constants'
import {
  creativeWorkOutputSchemas,
  readCreativeWorkOutputDefinition,
  type CreativeWorkOutput,
} from './output-registry'
import {
  creativeWorkDelegationRequestSchema,
  creativeWorkDurationIntentSchema,
  creativeWorkRequestSchema,
} from './types'
import {
  creativeSkillReadTraceEntrySchema,
  creativeWorkTraceEventSchema,
} from './trace-contract'
import { creativeWorkerResearchEvidenceSchema } from './research'
import { CREATIVE_WORK_CALLER_CONSTRAINT_LIMIT } from './system-constraints'

const creativeWorkOutputSchema = z.discriminatedUnion('kind', [
  creativeWorkOutputSchemas.screenplay,
  creativeWorkOutputSchemas.chapter_continuity_plan,
  creativeWorkOutputSchemas.creative_direction,
  creativeWorkOutputSchemas.asset_manifest,
  creativeWorkOutputSchemas.video_prompt_set,
  creativeWorkOutputSchemas.music_direction,
])

export const creativeWorkerResultSchema = z.object({
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  output: creativeWorkOutputSchema,
  skillTrace: z.array(creativeSkillReadTraceEntrySchema),
  metrics: z.object({
    readCalls: z.number().int().nonnegative(),
    skillContentChars: z.number().int().nonnegative(),
    webSearchCalls: z.number().int().nonnegative(),
    webSearchSources: z.number().int().nonnegative(),
  }).strict(),
  budgets: z.object({
    maxTurns: z.number().int().positive(),
    maxReadCalls: z.number().int().positive(),
    maxWebSearchCalls: z.number().int().positive(),
    maxInputChars: z.number().int().positive(),
    maxOutputChars: z.number().int().positive(),
  }).strict(),
  research: creativeWorkerResearchEvidenceSchema.nullable(),
}).strict().superRefine((result, context) => {
  if (result.output.kind !== result.outputKind) {
    context.addIssue({
      code: 'custom',
      message: 'CREATIVE_WORK_OUTPUT_KIND_MISMATCH',
      path: ['output'],
    })
  }
  if (
    (result.outputKind === 'creative_direction' && result.research === null)
    || (result.outputKind !== 'creative_direction' && result.research !== null)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'CREATIVE_WORK_RESEARCH_CAPABILITY_MISMATCH',
      path: ['research'],
    })
  }
})

type CreativeWorkNonVideoOutputKind = Exclude<
  (typeof CREATIVE_WORK_OUTPUT_KINDS)[number],
  'video_prompt_set'
>

const CREATIVE_WORK_NON_VIDEO_OUTPUT_KINDS = CREATIVE_WORK_OUTPUT_KINDS.filter(
  (outputKind): outputKind is CreativeWorkNonVideoOutputKind => outputKind !== 'video_prompt_set',
) as [CreativeWorkNonVideoOutputKind, ...CreativeWorkNonVideoOutputKind[]]

const creativeWorkDelegationItemBaseSchema = creativeWorkDelegationRequestSchema.extend({
  requestKey: z.string().trim().min(1).max(200)
    .describe('Caller-owned stable identity for this one logical Subagent request. It must be unique inside a batch and reused only for an explicit retry of the same logical item.'),
}).strict()

export const creativeWorkDelegationItemSchema = z.discriminatedUnion('outputKind', [
  creativeWorkDelegationItemBaseSchema.extend({
    outputKind: z.literal('video_prompt_set'),
    durationIntent: creativeWorkDurationIntentSchema
      .describe('Required duration authority for this video-prompt delegation.'),
  }).strict(),
  creativeWorkDelegationItemBaseSchema.extend({
    outputKind: z.enum(CREATIVE_WORK_NON_VIDEO_OUTPUT_KINDS),
    durationIntent: creativeWorkDurationIntentSchema.optional()
      .describe('Optional delivery-duration context for a non-video creative result.'),
  }).strict(),
])

const creativeWorkChapterIdentitySchema = z.object({
  chapterId: z.string().trim().min(1)
    .describe('Exact persisted Chapter identity.'),
  requestKey: z.string().trim().min(1).max(200)
    .describe('Caller-owned stable identity for this Chapter Subagent request.'),
}).strict()

const creativeWorkChapterBatchBaseShape = {
  source: z.literal('chapters')
    .describe('Compile the persisted Chapter identities below into independent Creative Worker requests.'),
  goal: z.string().trim().min(1).max(7_500)
    .describe('Shared professional objective; each Worker also receives its exact compiled Chapter context.'),
  userRequest: z.string().max(30_000)
    .describe('Relevant original user request preserved for every Chapter Worker.'),
  constraints: z.array(z.string().trim().min(1).max(4_000))
    .max(CREATIVE_WORK_CALLER_CONSTRAINT_LIMIT)
    .describe('Shared delivery, safety, continuity, or creative constraints. Do not prescribe generation segment count or per-segment durations; the Worker derives them from the server-supplied video production context.'),
  referencedAssets: z.array(z.object({
    resourceId: z.string().trim().min(1),
    entityRef: ledgerEntityRefSchema.nullable(),
  }).strict()).max(128)
    .describe('Exact non-Direction Resources the Context Compiler may copy into every relevant Chapter packet. Adopted Creative Direction is read once and injected only by the central Task input compiler.'),
} as const

const creativeWorkVideoChapterBatchInputSchema = z.object({
  ...creativeWorkChapterBatchBaseShape,
  chapters: z.array(creativeWorkChapterIdentitySchema.extend({
    durationIntent: creativeWorkDurationIntentSchema
      .describe('Required duration authority for this Chapter video-prompt delegation. Use mode=fixed only for the Chapter share of a user-stated total; do not convert a Chapter planning estimate into mode=fixed.'),
  }).strict()).min(1).max(64),
  outputKind: z.literal('video_prompt_set'),
}).strict()

const creativeWorkNonVideoChapterBatchInputSchema = z.object({
  ...creativeWorkChapterBatchBaseShape,
  chapters: z.array(creativeWorkChapterIdentitySchema.extend({
    durationIntent: creativeWorkDurationIntentSchema.optional()
      .describe('Optional delivery-duration context for a non-video creative result.'),
  }).strict()).min(1).max(64),
  outputKind: z.enum(CREATIVE_WORK_NON_VIDEO_OUTPUT_KINDS),
}).strict()

function createCreativeWorkNonVideoChapterBatchInputSchema<
  const OutputKind extends CreativeWorkNonVideoOutputKind,
>(outputKind: OutputKind) {
  return creativeWorkNonVideoChapterBatchInputSchema.extend({
    outputKind: z.literal(outputKind),
  }).strict()
}

const creativeWorkNonVideoChapterBatchInputSchemas = CREATIVE_WORK_NON_VIDEO_OUTPUT_KINDS.map(
  createCreativeWorkNonVideoChapterBatchInputSchema,
)

const creativeWorkChapterBatchInputSchemas = [
  creativeWorkVideoChapterBatchInputSchema,
  ...creativeWorkNonVideoChapterBatchInputSchemas,
] as [
  typeof creativeWorkVideoChapterBatchInputSchema,
  ...typeof creativeWorkNonVideoChapterBatchInputSchemas,
]

export const creativeWorkChapterBatchInputSchema = z.discriminatedUnion('outputKind', [
  ...creativeWorkChapterBatchInputSchemas,
])

const creativeWorkRequestBatchInputSchema = z.object({
  source: z.literal('requests')
    .describe('Delegate one or more caller-supplied, self-contained Creative Worker requests.'),
  requests: z.array(creativeWorkDelegationItemSchema).min(1).max(64)
    .describe('One request is one Subagent Task. Multiple independent requests run through the existing Task batch and collecting Wait.'),
}).strict()

const creativeWorkDelegationSourceSchema = z.union([
  creativeWorkRequestBatchInputSchema,
  ...creativeWorkChapterBatchInputSchemas,
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
  // Historical fact: lifecycle projections persist across registry evolution,
  // so the recorded kind must parse even after an output kind is removed.
  outputKind: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(8_000),
  events: z.array(creativeWorkTaskProgressEventSchema).max(64),
}).strict()

export const CREATIVE_WORK_TASK_PROTOCOL = 'creative_work_v13' as const

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
  ...taskRuntimePayloadEnvelopeShape,
}).strict().superRefine((payload, context) => {
  const injectCreativeDirection = readCreativeWorkOutputDefinition(
    payload.request.outputKind,
  ).injectCreativeDirection
  if (injectCreativeDirection || payload.request.creativeDirection === null) return
  context.addIssue({
    code: 'custom',
    path: ['request', 'creativeDirection'],
    message: 'CREATIVE_DIRECTION_INJECTION_FORBIDDEN',
  })
})

const creativeWorkMaterializedResourceSchema = z.object({
  resourceId: z.string().trim().min(1),
  schemaId: z.string().trim().min(1),
  mediaType: z.enum(['text', 'image', 'audio', 'video']),
  name: z.string().trim().min(1),
}).strict()

const creativeWorkMaterializedResourcesSchema = z.array(
  creativeWorkMaterializedResourceSchema,
).min(1)

const creativeWorkContinuationProjectionSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  summary: z.string().trim().min(1).max(4_000),
  resources: creativeWorkMaterializedResourcesSchema.optional()
    .describe('Exact immutable Resources added by the terminal materializer. Absent before materialization.'),
}).strict()

export const creativeWorkTaskResultSchema = z.object({
  requestKey: z.string().trim().min(1).max(200),
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  summary: z.string().trim().min(1).max(4_000),
  continuationProjection: creativeWorkContinuationProjectionSchema,
  lifecycleProjection: creativeWorkTaskLifecycleProjectionSchema,
  creativeWorkResult: creativeWorkerResultSchema,
  resources: creativeWorkMaterializedResourcesSchema.optional()
    .describe('Exact immutable Resources materialized atomically from this completed result. Absent when this output kind has no persistent Resource projection.'),
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
  const continuationResources = result.continuationProjection.resources
  if (
    (continuationResources === undefined) !== (result.resources === undefined)
    || (
      continuationResources !== undefined
      && stableArgsHash(continuationResources) !== stableArgsHash(result.resources)
    )
  ) {
    mismatches.push({
      path: ['continuationProjection', 'resources'],
      code: 'CREATIVE_WORK_RESULT_RESOURCES_MISMATCH',
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
    case 'chapter_continuity_plan':
      return output.rationale
    case 'creative_direction':
      return output.creativeDirection.styleSummary
    case 'asset_manifest':
      return output.overview || output.assets.map((asset) => asset.canonicalName).join(' / ')
    case 'video_prompt_set':
      return output.segments.map((segment) => segment.key).join(' / ').slice(0, 4_000)
    case 'music_direction':
      return output.overview
  }
}
