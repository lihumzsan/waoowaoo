import { z } from 'zod'
import { CREATIVE_SKILL_IDS } from '@/lib/creative-skills/types'
import { CREATIVE_WORK_OUTPUT_KINDS } from '@/lib/creative-worker/constants'
import { CREATIVE_WORKER_ERROR_CODES } from '@/lib/creative-worker/errors'
import type { CreativeWorkerEvent } from '@/lib/creative-worker/types'

const skillReadTraceSchema = z.object({
  ordinal: z.number().int().positive(),
  source: z.enum(['required', 'tool']),
  skillId: z.enum(CREATIVE_SKILL_IDS),
  version: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  checksum: z.string().trim().min(1),
  contentChars: z.number().int().nonnegative(),
}).strict()

const creativeWorkerEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('started'),
    outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
    goal: z.string().trim().min(1),
  }).strict(),
  z.object({
    kind: z.literal('skills_discovered'),
    query: z.string().trim().min(1),
    tags: z.array(z.string()),
    skillIds: z.array(z.enum(CREATIVE_SKILL_IDS)),
  }).strict(),
  z.object({
    kind: z.literal('skill_read'),
    trace: skillReadTraceSchema,
  }).strict(),
  z.object({
    kind: z.literal('completed'),
    outputKind: z.enum(CREATIVE_WORK_OUTPUT_KINDS),
  }).strict(),
  z.object({
    kind: z.literal('failed'),
    code: z.enum(CREATIVE_WORKER_ERROR_CODES),
  }).strict(),
  z.object({
    kind: z.literal('cancelled'),
    code: z.literal('CREATIVE_WORK_ABORTED'),
  }).strict(),
])

const projectAgentSubagentEventPartDataSchema = z.object({
  subagentId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  toolCallId: z.string().trim().min(1),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  event: creativeWorkerEventSchema,
}).strict()

export interface ProjectAgentSubagentEventPartData {
  subagentId: string
  taskId: string
  runId: string
  toolCallId: string
  sequence: number
  occurredAt: string
  event: CreativeWorkerEvent
}

export type ProjectAgentSubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface ProjectAgentSubagentView {
  subagentId: string
  taskId: string
  runId: string
  toolCallId: string
  outputKind: Extract<CreativeWorkerEvent, { kind: 'started' }>['outputKind']
  goal: string
  status: ProjectAgentSubagentStatus
  events: ProjectAgentSubagentEventPartData[]
  skillReads: Array<Extract<CreativeWorkerEvent, { kind: 'skill_read' }>['trace']>
}

export function parseProjectAgentSubagentEventPartData(
  input: unknown,
): ProjectAgentSubagentEventPartData {
  return projectAgentSubagentEventPartDataSchema.parse(input) as ProjectAgentSubagentEventPartData
}

function resolveTerminalStatus(event: CreativeWorkerEvent): ProjectAgentSubagentStatus | null {
  if (event.kind === 'completed') return 'completed'
  if (event.kind === 'failed') return 'failed'
  if (event.kind === 'cancelled') return 'cancelled'
  return null
}

function assertSameEvent(
  left: ProjectAgentSubagentEventPartData,
  right: ProjectAgentSubagentEventPartData,
): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`PROJECT_AGENT_SUBAGENT_EVENT_SEQUENCE_CONFLICT:${left.subagentId}:${String(left.sequence)}`)
  }
}

export function resolveProjectAgentSubagentViews(
  rawEvents: readonly ProjectAgentSubagentEventPartData[],
): ProjectAgentSubagentView[] {
  const grouped = new Map<string, Map<number, ProjectAgentSubagentEventPartData>>()
  for (const event of rawEvents) {
    const events = grouped.get(event.subagentId) ?? new Map<number, ProjectAgentSubagentEventPartData>()
    const existing = events.get(event.sequence)
    if (existing) assertSameEvent(existing, event)
    else events.set(event.sequence, event)
    grouped.set(event.subagentId, events)
  }

  return Array.from(grouped.entries()).map(([subagentId, eventMap]) => {
    const events = Array.from(eventMap.values()).sort((left, right) => left.sequence - right.sequence)
    const first = events[0]
    if (!first || first.sequence !== 1 || first.event.kind !== 'started') {
      throw new Error(`PROJECT_AGENT_SUBAGENT_START_EVENT_MISSING:${subagentId}`)
    }
    for (const event of events) {
      if (
        event.subagentId !== subagentId
        || event.taskId !== first.taskId
        || event.runId !== first.runId
        || event.toolCallId !== first.toolCallId
        || event.subagentId !== event.taskId
      ) {
        throw new Error(`PROJECT_AGENT_SUBAGENT_EVENT_IDENTITY_MISMATCH:${subagentId}:${String(event.sequence)}`)
      }
    }
    const terminalStatuses = events.flatMap((event) => {
      const status = resolveTerminalStatus(event.event)
      return status ? [status] : []
    })
    if (terminalStatuses.length > 1) {
      throw new Error(`PROJECT_AGENT_SUBAGENT_TERMINAL_EVENT_CONFLICT:${subagentId}`)
    }
    const startEvent = first.event
    const skillReads = events.flatMap((event) => (
      event.event.kind === 'skill_read' ? [event.event.trace] : []
    ))
    return {
      subagentId,
      taskId: first.taskId,
      runId: first.runId,
      toolCallId: first.toolCallId,
      outputKind: startEvent.outputKind,
      goal: startEvent.goal,
      status: terminalStatuses[0] ?? 'running',
      events,
      skillReads,
    }
  }).sort((left, right) => (
    left.events[0]?.occurredAt.localeCompare(right.events[0]?.occurredAt ?? '') ?? 0
  ))
}

export function resolveActiveProjectAgentSubagents(
  events: readonly ProjectAgentSubagentEventPartData[],
): ProjectAgentSubagentView[] {
  return resolveProjectAgentSubagentViews(events).filter((subagent) => subagent.status === 'running')
}
