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
  resourceRef: z.object({
    resourceId: z.string().trim().min(1).max(200)
      .describe('Canonical creative resource identity supplied by the caller for provenance only.'),
    revisionId: z.string().trim().min(1).max(200)
      .describe('Exact immutable revision identity of the supplied resource content.'),
    fingerprint: z.string().trim().min(1).max(500)
      .describe('Fingerprint of the exact resource revision supplied to the worker.'),
  }).strict().nullable()
    .describe('Exact resource revision provenance when the material came from a saved resource, otherwise null.'),
}).strict().describe('One source item explicitly copied into the stateless worker input by the primary agent.')

export const creativeWorkRequestSchema = z.object({
  outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS)
    .describe('The strict structured result contract the creative worker must return.'),
  goal: z.string().trim().min(1).max(8_000)
    .describe('A concrete professional creative objective for this one stateless delegation.'),
  context: z.object({
    userRequest: z.string().max(30_000)
      .describe('The relevant original user request, preserved so the worker can remain faithful to user intent.'),
    sourceMaterials: z.array(creativeWorkSourceMaterialSchema).max(64)
      .describe('All project facts and source materials the worker may use; the worker cannot fetch additional project state.'),
    constraints: z.array(z.string().trim().min(1).max(4_000)).max(64)
      .describe('Explicit creative, duration, format, continuity, safety, or delivery constraints that the result must satisfy.'),
  }).strict().describe('A complete caller-assembled context packet; it is data for analysis and grants no system access.'),
}).strict().describe('Request for one isolated creative-worker run with a strict output contract.')

export type CreativeWorkRequest = z.infer<typeof creativeWorkRequestSchema>

export interface CreativeWorkerBudgets {
  maxTurns: number
  maxDiscoveryCalls: number
  maxReadCalls: number
  maxSkillContentChars: number
  maxSingleSkillResourceChars: number
  maxInputChars: number
  maxOutputChars: number
}

export type CreativeWorkerBudgetOverrides = Partial<CreativeWorkerBudgets>

export interface CreativeSkillReadTraceEntry {
  ordinal: number
  source: 'required' | 'tool'
  skillId: CreativeSkillId
  version: string
  uri: string
  checksum: string
  contentChars: number
}

export interface CreativeWorkerMetrics {
  discoveryCalls: number
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
    kind: 'skills_discovered'
    query: string
    tags: readonly string[]
    skillIds: readonly CreativeSkillId[]
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
    discoveryCalls: number
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
