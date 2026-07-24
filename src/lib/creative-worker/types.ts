import type { Model } from '@openai/agents'
import { z } from 'zod'
import { injectedCreativeDirectionSchema } from '@/lib/creative-direction/contracts'
import type { CreativeSkillLocale } from '@/lib/creative-skills'
import {
  CREATIVE_WORK_OUTPUT_KINDS,
  DEFAULT_CREATIVE_WORKER_BUDGETS,
} from './constants'
import type {
  CreativeSkillReadTraceEntry,
  CreativeWorkTraceEvent,
} from './trace-contract'
import type {
  CreativeWorkerResearchEvidence,
  CreativeWorkerResearchState,
} from './research'
import type { WebSearchRequest, WebSearchResponse } from '@/lib/web-search'
export type { CreativeSkillReadTraceEntry } from './trace-contract'

export type CreativeWorkOutputKind = (typeof CREATIVE_WORK_OUTPUT_KINDS)[number]

const creativeWorkHydratedSourceMaterialSchema = z.object({
  label: z.string().trim().min(1).max(240)
    .describe('Human-readable name that identifies this source material within the delegated task.'),
  kind: z.enum(['text', 'image', 'audio', 'video', 'structured'])
    .describe('The media or data category of the supplied source material; this does not grant the worker access to the underlying project.'),
  content: z.string().max(600_000)
    .describe('The complete source content made available to the worker for this run, such as text, a media description, or serialized structured data.'),
  provenance: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }).strict(),
    z.object({
      kind: z.literal('resource'),
      revisionId: z.string().trim().min(1).max(200)
        .describe('Globally unique immutable Resource Revision identity; the server resolves all remaining identity and scope facts.'),
    }).strict(),
    z.object({
      kind: z.literal('domain'),
      sourceType: z.string().trim().min(1).max(120)
        .describe('Registered domain source type, such as edit_source_document.'),
      sourceId: z.string().trim().min(1).max(200)
        .describe('Canonical domain entity identity.'),
      revision: z.string().trim().min(1).max(200)
        .describe('Exact domain revision or version identity.'),
    }).strict(),
  ]).describe('Exact provenance for this copied source material, or kind=none when it is not backed by a persisted fact.'),
}).strict().describe('One source item explicitly copied into the stateless worker input by the primary agent.')

const creativeWorkDelegationSourceMaterialSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resource'),
    revisionId: z.string().trim().min(1).max(200)
      .describe('Globally unique immutable Resource Revision identity. The server reloads its real content, schema, owner, and scope.'),
  }).strict(),
  z.object({
    kind: z.literal('inline'),
    label: z.string().trim().min(1).max(240),
    mediaType: z.enum(['text', 'image', 'audio', 'video', 'structured']),
    content: z.string().max(600_000),
    provenance: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }).strict(),
      z.object({
        kind: z.literal('domain'),
        sourceType: z.string().trim().min(1).max(120),
        sourceId: z.string().trim().min(1).max(200),
        revision: z.string().trim().min(1).max(200),
      }).strict(),
    ]),
  }).strict(),
]).describe('Use kind=resource with revisionId only for persisted Resources. Inline material carries its own content and optional exact domain provenance.')

export const creativeWorkDurationIntentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fixed'),
    seconds: z.number().int().positive().max(36_000)
      .describe('The exact total delivery duration the user explicitly stated. For video_prompt_set this is the whole work or Chapter duration, never a caller-chosen segment duration or segment count.'),
  }).strict()
    .describe('Use only when the user actually stated a delivery duration, or when an adopted plan allocates that stated total to this unit.'),
  z.object({
    mode: z.literal('derive'),
  }).strict()
    .describe('Use whenever the user did not state a delivery duration. The Worker derives the real duration from the dialogue, action, and beats it actually designs.'),
]).describe('Explicit duration authority for this delegation. There is no implicit default: never convert your own estimate, a planning estimate, or a Chapter estimate into mode=fixed.')

const creativeWorkRequestBaseShape = {
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS)
    .describe('The strict structured result contract the creative worker must return.'),
  goal: z.string().trim().min(1).max(8_000)
    .describe('A concrete professional creative objective for this one stateless delegation.'),
  durationIntent: creativeWorkDurationIntentSchema.optional()
    .describe('Required for video_prompt_set. Omit only for output kinds whose result has no delivery duration.'),
} as const

export const creativeWorkDelegationRequestSchema = z.object({
  ...creativeWorkRequestBaseShape,
  context: z.object({
    userRequest: z.string().max(30_000)
      .describe('The relevant original user request, preserved so the worker can remain faithful to user intent.'),
    sourceMaterials: z.array(creativeWorkDelegationSourceMaterialSchema).max(64)
      .describe('Exact Resource revision IDs or inline non-Resource materials. Persisted Resource content is always reloaded by the server.'),
    constraints: z.array(z.string().trim().min(1).max(4_000)).max(64)
      .describe('Explicit creative, duration, format, continuity, safety, or delivery constraints that the result must satisfy.'),
  }).strict().describe('A complete caller-assembled context packet; it is data for analysis and grants no system access.'),
}).strict().describe('Request for one isolated creative-worker run with a strict output contract.')

export const creativeWorkHydratedRequestSchema = z.object({
  ...creativeWorkRequestBaseShape,
  context: z.object({
    userRequest: z.string().max(30_000),
    sourceMaterials: z.array(creativeWorkHydratedSourceMaterialSchema).max(64),
    constraints: z.array(z.string().trim().min(1).max(4_000)).max(64),
  }).strict(),
}).strict()

const creativeVideoProductionContextSchema = z.object({
  aspectRatio: z.string().trim().min(1),
  allowedSegmentDurationsSeconds: z.array(z.number().int().positive()).min(1),
  minSegmentDurationSeconds: z.number().int().positive(),
  maxSegmentDurationSeconds: z.number().int().positive(),
}).strict().superRefine((context, refinement) => {
  const sorted = [...context.allowedSegmentDurationsSeconds].sort((left, right) => left - right)
  if (
    new Set(sorted).size !== sorted.length
    || sorted[0] !== context.minSegmentDurationSeconds
    || sorted.at(-1) !== context.maxSegmentDurationSeconds
  ) {
    refinement.addIssue({
      code: 'custom',
      message: 'CREATIVE_VIDEO_PRODUCTION_DURATION_OPTIONS_INVALID',
      path: ['allowedSegmentDurationsSeconds'],
    })
  }
})

export const creativeWorkRequestSchema = creativeWorkHydratedRequestSchema.extend({
  creativeDirection: injectedCreativeDirectionSchema.nullable()
    .describe('Exact adopted Creative Direction projection injected and frozen by the server for this output kind. The primary Agent cannot supply it.'),
  productionContext: z.object({
    video: creativeVideoProductionContextSchema.nullable(),
  }).strict(),
}).strict().describe('Server-compiled request for one isolated creative-worker run. Creative Direction and productionContext are supplied by the execution layer, never by the primary Agent.')

export type CreativeWorkDelegationRequest = z.infer<typeof creativeWorkDelegationRequestSchema>
export type CreativeWorkHydratedRequest = z.infer<typeof creativeWorkHydratedRequestSchema>
export type CreativeWorkRequest = z.infer<typeof creativeWorkRequestSchema>

export interface CreativeWorkerBudgets {
  maxTurns: number
  maxReadCalls: number
  maxWebSearchCalls: number
  maxSkillContentChars: number
  maxSingleSkillResourceChars: number
  maxInputChars: number
  maxOutputChars: number
}

export type CreativeWorkerBudgetOverrides = Partial<CreativeWorkerBudgets>

export interface CreativeWorkerMetrics {
  readCalls: number
  skillContentChars: number
  webSearchCalls: number
  webSearchSources: number
}

export type CreativeWorkerEvent = CreativeWorkTraceEvent
  | {
    kind: 'reasoning_delta'
    reasoningId: string
    delta: string
  }
  | {
    kind: 'completed'
    outputKind: CreativeWorkOutputKind
  }
  | {
    kind: 'failed'
    code: import('./errors').CreativeWorkerErrorCode
  }
  | {
    kind: 'cancelled'
    code: 'CREATIVE_WORK_ABORTED'
  }

export type CreativeWorkerEventListener = (
  event: CreativeWorkerEvent,
) => void | Promise<void>

export interface RunCreativeWorkerInput {
  model: Model
  locale: CreativeSkillLocale
  signal: AbortSignal
  request: CreativeWorkRequest
  budgets?: CreativeWorkerBudgetOverrides
  onEvent?: CreativeWorkerEventListener
  webSearch?: (input: {
    readonly request: WebSearchRequest
    readonly signal: AbortSignal
  }) => Promise<WebSearchResponse>
}

export interface CreativeWorkerResult<TOutput = CreativeWorkOutput> {
  outputKind: CreativeWorkOutputKind
  output: TOutput
  skillTrace: readonly CreativeSkillReadTraceEntry[]
  metrics: CreativeWorkerMetrics
  budgets: CreativeWorkerBudgets
  research: CreativeWorkerResearchEvidence | null
}

export interface CreativeWorkerRunContext {
  locale: CreativeSkillLocale
  budgets: CreativeWorkerBudgets
  counters: {
    readCalls: number
    skillContentChars: number
    webSearchCalls: number
    webSearchSources: number
  }
  skillTrace: CreativeSkillReadTraceEntry[]
  research: CreativeWorkerResearchState | null
  signal: AbortSignal
  webSearch: NonNullable<RunCreativeWorkerInput['webSearch']>
  onEvent?: CreativeWorkerEventListener
}

export const defaultCreativeWorkerBudgets: CreativeWorkerBudgets = {
  ...DEFAULT_CREATIVE_WORKER_BUDGETS,
}

// Declared in output-registry.ts and re-exported here to keep public result
// signatures independent from the registry implementation.
export type CreativeWorkOutput = import('./output-registry').CreativeWorkOutput
