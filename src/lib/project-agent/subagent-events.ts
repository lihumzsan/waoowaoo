import { z } from 'zod'
import {
  creativeWorkTraceEventSchema,
  type CreativeWorkTraceEvent,
} from '@/lib/creative-worker'

const projectAgentSubagentEventPartDataSchema = z.object({
  subagentId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  originTurnId: z.string().trim().min(1),
  callId: z.string().trim().min(1),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  event: creativeWorkTraceEventSchema,
}).strict()

export interface ProjectAgentSubagentEventPartData {
  subagentId: string
  taskId: string
  originTurnId: string
  callId: string
  sequence: number
  occurredAt: string
  event: CreativeWorkTraceEvent
}

export type ProjectAgentSubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface ProjectAgentSubagentView {
  subagentId: string
  taskId: string
  originTurnId: string
  callId: string
  outputKind: Extract<CreativeWorkTraceEvent, { kind: 'started' }>['outputKind']
  goal: string
  status: ProjectAgentSubagentStatus
  summary: string | null
  errorCode: string | null
  finishedAt: string | null
  events: ProjectAgentSubagentEventPartData[]
  skillReads: Array<Extract<CreativeWorkTraceEvent, { kind: 'skill_read' }>['trace']>
}

export interface ProjectAgentSubagentTaskFact {
  taskId: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  summary: string | null
  errorCode: string | null
  finishedAt: string | null
}

export function parseProjectAgentSubagentEventPartData(
  input: unknown,
): ProjectAgentSubagentEventPartData {
  return projectAgentSubagentEventPartDataSchema.parse(input) as ProjectAgentSubagentEventPartData
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
  taskFacts: readonly ProjectAgentSubagentTaskFact[],
): ProjectAgentSubagentView[] {
  const taskFactsById = new Map(taskFacts.map((fact) => [fact.taskId, fact]))
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
        || event.originTurnId !== first.originTurnId
        || event.callId !== first.callId
        || event.subagentId !== event.taskId
      ) {
        throw new Error(`PROJECT_AGENT_SUBAGENT_EVENT_IDENTITY_MISMATCH:${subagentId}:${String(event.sequence)}`)
      }
    }
    const taskFact = taskFactsById.get(first.taskId)
    if (!taskFact) throw new Error(`PROJECT_AGENT_SUBAGENT_TASK_FACT_MISSING:${first.taskId}`)
    const status: ProjectAgentSubagentStatus = taskFact.status === 'completed'
      ? 'completed'
      : taskFact.status === 'failed'
        ? 'failed'
        : taskFact.status === 'canceled'
          ? 'cancelled'
          : 'running'
    const startEvent = first.event
    const skillReads = events.flatMap((event) => (
      event.event.kind === 'skill_read' || event.event.kind === 'tool_completed'
        ? [event.event.trace]
        : []
    ))
    return {
      subagentId,
      taskId: first.taskId,
      originTurnId: first.originTurnId,
      callId: first.callId,
      outputKind: startEvent.outputKind,
      goal: startEvent.goal,
      status,
      summary: taskFact.summary,
      errorCode: taskFact.errorCode,
      finishedAt: taskFact.finishedAt,
      events,
      skillReads,
    }
  }).sort((left, right) => (
    left.events[0]?.occurredAt.localeCompare(right.events[0]?.occurredAt ?? '') ?? 0
  ))
}
