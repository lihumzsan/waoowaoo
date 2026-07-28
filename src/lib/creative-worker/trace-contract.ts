import { z } from 'zod'
import { CREATIVE_WORKER_ERROR_CODES } from './errors'
import {
  creativeWorkerSubmissionInputDiagnosticSchema,
  creativeWorkerSubmissionIssueSchema,
} from './output-submission'

export const CREATIVE_WORK_REASONING_MAX_CHARS = 64_000

// Trace events are persisted historical facts. skillId/outputKind record what
// existed when the run happened, so they must parse independently of the
// current registry; live membership is enforced at the tool-call and request
// boundaries instead.
const historicalSkillIdSchema = z.string().trim().min(1).max(64)

export const creativeSkillReadTraceEntrySchema = z.object({
  ordinal: z.number().int().positive(),
  source: z.enum(['preloaded', 'tool']),
  skillId: historicalSkillIdSchema,
  version: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  checksum: z.string().trim().min(1),
  contentChars: z.number().int().nonnegative(),
}).strict()

export const creativeWorkTraceEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('started'),
    outputKind: z.string().trim().min(1).max(64),
    goal: z.string().trim().min(1),
  }).strict(),
  z.object({
    kind: z.literal('skill_read'),
    trace: creativeSkillReadTraceEntrySchema,
  }).strict(),
  z.object({
    kind: z.literal('reasoning'),
    reasoningId: z.string().trim().min(1).max(500),
    text: z.string().max(CREATIVE_WORK_REASONING_MAX_CHARS),
    status: z.enum(['running', 'completed']),
    truncated: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal('generation'),
    generationId: z.string().trim().min(1).max(500),
    phase: z.enum(['preparing', 'creating_output', 'correcting_output']),
    status: z.enum(['running', 'completed']),
  }).strict(),
  z.object({
    kind: z.literal('tool_called'),
    toolCallId: z.string().trim().min(1).max(500),
    toolName: z.literal('read_skill'),
    skillId: historicalSkillIdSchema,
  }).strict(),
  z.object({
    kind: z.literal('tool_completed'),
    toolCallId: z.string().trim().min(1).max(500),
    toolName: z.literal('read_skill'),
    skillId: historicalSkillIdSchema,
    trace: creativeSkillReadTraceEntrySchema,
  }).strict(),
  z.object({
    kind: z.literal('tool_failed'),
    toolCallId: z.string().trim().min(1).max(500),
    toolName: z.literal('read_skill'),
    skillId: historicalSkillIdSchema,
    code: z.enum(CREATIVE_WORKER_ERROR_CODES),
  }).strict(),
  // Research visibility. Without these a user cannot tell a direction that was
  // grounded in real sources apart from one the model asserted from memory,
  // because zero calls is deliberately a silent, warning-free completion.
  z.object({
    kind: z.literal('research_started'),
    researchId: z.string().trim().min(1).max(500),
    query: z.string().trim().min(1).max(1_000),
  }).strict(),
  z.object({
    kind: z.literal('research_completed'),
    researchId: z.string().trim().min(1).max(500),
    query: z.string().trim().min(1).max(1_000),
    status: z.enum(['completed', 'unavailable', 'failed', 'budget_exhausted']),
    sourceCount: z.number().int().nonnegative(),
    imageCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal('submission_started'),
    submissionId: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    kind: z.literal('submission_rejected'),
    submissionId: z.string().trim().min(1).max(500),
    outputChars: z.number().int().nonnegative(),
    inputDiagnostic: creativeWorkerSubmissionInputDiagnosticSchema,
    issues: z.array(creativeWorkerSubmissionIssueSchema).min(1).max(64),
  }).strict(),
  z.object({
    kind: z.literal('submission_accepted'),
    submissionId: z.string().trim().min(1).max(500),
    outputKind: z.string().trim().min(1).max(64),
    outputChars: z.number().int().nonnegative(),
  }).strict(),
])

export type CreativeSkillReadTraceEntry = z.infer<typeof creativeSkillReadTraceEntrySchema>
export type CreativeWorkTraceEvent = z.infer<typeof creativeWorkTraceEventSchema>
