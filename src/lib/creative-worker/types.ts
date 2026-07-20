import type { Model } from '@openai/agents'
import { z } from 'zod'
import type { CreativeSkillId, CreativeSkillLocale } from '@/lib/creative-skills'
import {
  CREATIVE_WORK_OUTPUT_KINDS,
  DEFAULT_CREATIVE_WORKER_BUDGETS,
} from './constants'

export type CreativeWorkOutputKind = (typeof CREATIVE_WORK_OUTPUT_KINDS)[number]

const creativeWorkSourceMaterialSchema = z.object({
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
      resourceId: z.string().trim().min(1).max(200)
        .describe('Canonical Creative Resource identity supplied by the caller.'),
      revisionId: z.string().trim().min(1).max(200)
        .describe('Exact immutable Resource Revision identity.'),
      fingerprint: z.string().trim().min(1).max(500)
        .describe('Persisted fingerprint of the exact Resource Revision.'),
    }).strict(),
    z.object({
      kind: z.literal('domain'),
      sourceType: z.string().trim().min(1).max(120)
        .describe('Registered domain source type, such as edit_source_document.'),
      sourceId: z.string().trim().min(1).max(200)
        .describe('Canonical domain entity identity.'),
      revision: z.string().trim().min(1).max(200)
        .describe('Exact domain revision or version identity.'),
      fingerprint: z.string().trim().min(1).max(500)
        .describe('Persisted fingerprint of the exact domain revision.'),
    }).strict(),
  ]).describe('Exact provenance for this copied source material, or kind=none when it is not backed by a persisted fact.'),
}).strict().describe('One source item explicitly copied into the stateless worker input by the primary agent.')

export const creativeWorkDelegationRequestSchema = z.object({
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS)
    .describe('The strict structured result contract the creative worker must return.'),
  goal: z.string().trim().min(1).max(8_000)
    .describe('A concrete professional creative objective for this one stateless delegation.'),
  targetDurationSeconds: z.number().int().positive().max(36_000).optional()
    .describe('Overall requested delivery duration. For video_prompt_set this is the whole work or Chapter duration, never a caller-chosen segment duration or segment count.'),
  context: z.object({
    userRequest: z.string().max(30_000)
      .describe('The relevant original user request, preserved so the worker can remain faithful to user intent.'),
    sourceMaterials: z.array(creativeWorkSourceMaterialSchema).max(64)
      .describe('All project facts and source materials the worker may use; the worker cannot fetch additional project state.'),
    constraints: z.array(z.string().trim().min(1).max(4_000)).max(64)
      .describe('Explicit creative, duration, format, continuity, safety, or delivery constraints that the result must satisfy.'),
  }).strict().describe('A complete caller-assembled context packet; it is data for analysis and grants no system access.'),
}).strict().describe('Request for one isolated creative-worker run with a strict output contract.')

const creativeVideoProductionContextSchema = z.object({
  aspectRatio: z.string().trim().min(1),
  allowedSegmentDurationsSeconds: z.array(z.number().int().positive()).min(1),
  minSegmentDurationSeconds: z.number().int().positive(),
  maxSegmentDurationSeconds: z.number().int().positive(),
  styleBibleRequired: z.literal(true),
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

export const creativeWorkRequestSchema = creativeWorkDelegationRequestSchema.extend({
  productionContext: z.object({
    video: creativeVideoProductionContextSchema.nullable(),
  }).strict(),
}).strict().describe('Server-compiled request for one isolated creative-worker run. productionContext is supplied by the execution layer, never by the primary Agent.')

export type CreativeWorkDelegationRequest = z.infer<typeof creativeWorkDelegationRequestSchema>
export type CreativeWorkRequest = z.infer<typeof creativeWorkRequestSchema>

export interface CreativeWorkerBudgets {
  maxTurns: number
  maxReadCalls: number
  maxSkillContentChars: number
  maxSingleSkillResourceChars: number
  maxInputChars: number
  maxOutputChars: number
}

export type CreativeWorkerBudgetOverrides = Partial<CreativeWorkerBudgets>

export interface CreativeSkillReadTraceEntry {
  ordinal: number
  source: 'preloaded' | 'tool'
  skillId: CreativeSkillId
  version: string
  uri: string
  checksum: string
  contentChars: number
}

export interface CreativeWorkerMetrics {
  readCalls: number
  skillContentChars: number
}

export type CreativeWorkerEvent =
  | {
    kind: 'started'
    outputKind: CreativeWorkOutputKind
    goal: string
  }
  | {
    kind: 'skill_read'
    trace: CreativeSkillReadTraceEntry
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
}

export interface CreativeWorkerResult<TOutput = CreativeWorkOutput> {
  outputKind: CreativeWorkOutputKind
  output: TOutput
  skillTrace: readonly CreativeSkillReadTraceEntry[]
  metrics: CreativeWorkerMetrics
  budgets: CreativeWorkerBudgets
}

export interface CreativeWorkerRunContext {
  locale: CreativeSkillLocale
  budgets: CreativeWorkerBudgets
  counters: {
    readCalls: number
    skillContentChars: number
  }
  skillTrace: CreativeSkillReadTraceEntry[]
  onEvent?: CreativeWorkerEventListener
}

export const defaultCreativeWorkerBudgets: CreativeWorkerBudgets = {
  ...DEFAULT_CREATIVE_WORKER_BUDGETS,
}

// Declared in output-registry.ts and re-exported here to keep public result
// signatures independent from the registry implementation.
export type CreativeWorkOutput = import('./output-registry').CreativeWorkOutput
