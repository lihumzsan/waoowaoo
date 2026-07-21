import { z } from 'zod'
import { CREATIVE_SKILL_IDS } from '@/lib/creative-skills'
import { CREATIVE_WORK_OUTPUT_KINDS } from './constants'
import { CREATIVE_WORKER_ERROR_CODES } from './errors'

export const CREATIVE_WORK_REASONING_MAX_CHARS = 64_000

export const creativeSkillReadTraceEntrySchema = z.object({
  ordinal: z.number().int().positive(),
  source: z.enum(['preloaded', 'tool']),
  skillId: z.enum(CREATIVE_SKILL_IDS),
  version: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  checksum: z.string().trim().min(1),
  contentChars: z.number().int().nonnegative(),
}).strict()

export const creativeWorkTraceEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('started'),
    outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
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
    kind: z.literal('tool_called'),
    toolCallId: z.string().trim().min(1).max(500),
    toolName: z.literal('read_skill'),
    skillId: z.enum(CREATIVE_SKILL_IDS),
  }).strict(),
  z.object({
    kind: z.literal('tool_completed'),
    toolCallId: z.string().trim().min(1).max(500),
    toolName: z.literal('read_skill'),
    skillId: z.enum(CREATIVE_SKILL_IDS),
    trace: creativeSkillReadTraceEntrySchema,
  }).strict(),
  z.object({
    kind: z.literal('tool_failed'),
    toolCallId: z.string().trim().min(1).max(500),
    toolName: z.literal('read_skill'),
    skillId: z.enum(CREATIVE_SKILL_IDS),
    code: z.enum(CREATIVE_WORKER_ERROR_CODES),
  }).strict(),
])

export type CreativeSkillReadTraceEntry = z.infer<typeof creativeSkillReadTraceEntrySchema>
export type CreativeWorkTraceEvent = z.infer<typeof creativeWorkTraceEventSchema>
