import type {
  CreativeWorkTaskLifecycleProjection,
} from './task-contract'
import type {
  CreativeWorkTraceEvent,
} from './trace-contract'
import type {
  CreativeWorkerEvent,
} from './types'

export function isDurableCreativeWorkerTraceEvent(
  event: CreativeWorkerEvent,
): event is CreativeWorkTraceEvent {
  return event.kind === 'started'
    || event.kind === 'skill_read'
    || event.kind === 'reasoning'
    || event.kind === 'generation'
    || event.kind === 'tool_called'
    || event.kind === 'tool_completed'
    || event.kind === 'tool_failed'
    || event.kind === 'research_started'
    || event.kind === 'research_completed'
    || event.kind === 'submission_started'
    || event.kind === 'submission_rejected'
    || event.kind === 'submission_accepted'
}

function withAttemptIdentity(
  event: CreativeWorkTraceEvent,
  attempt: number,
): CreativeWorkTraceEvent {
  if (event.kind === 'reasoning') {
    return { ...event, reasoningId: `${String(attempt)}:${event.reasoningId}` }
  }
  if (event.kind === 'generation') {
    return { ...event, generationId: `${String(attempt)}:${event.generationId}` }
  }
  if (
    event.kind === 'tool_called'
    || event.kind === 'tool_completed'
    || event.kind === 'tool_failed'
  ) return { ...event, toolCallId: `${String(attempt)}:${event.toolCallId}` }
  if (event.kind === 'research_started' || event.kind === 'research_completed') {
    return { ...event, researchId: `${String(attempt)}:${event.researchId}` }
  }
  if (
    event.kind === 'submission_started'
    || event.kind === 'submission_rejected'
    || event.kind === 'submission_accepted'
  ) return { ...event, submissionId: `${String(attempt)}:${event.submissionId}` }
  return event
}

function replaceLifecycleEvent(input: {
  readonly lifecycle: CreativeWorkTaskLifecycleProjection
  readonly event: CreativeWorkTraceEvent
  readonly existingIndex: number
}): CreativeWorkTaskLifecycleProjection {
  return {
    ...input.lifecycle,
    events: input.lifecycle.events.map((entry, index) => (
      index === input.existingIndex ? { ...entry, event: input.event } : entry
    )),
  }
}

export function applyCreativeWorkerLifecycleEvent(input: {
  readonly lifecycle: CreativeWorkTaskLifecycleProjection
  readonly rawEvent: CreativeWorkTraceEvent
  readonly attempt: number
  readonly occurredAt: string
}): CreativeWorkTaskLifecycleProjection {
  const event = withAttemptIdentity(input.rawEvent, input.attempt)
  if (event.kind === 'started') return input.lifecycle
  if (event.kind === 'reasoning') {
    const existingIndex = input.lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'reasoning'
      && entry.event.reasoningId === event.reasoningId
    ))
    if (existingIndex >= 0) {
      return replaceLifecycleEvent({
        lifecycle: input.lifecycle,
        event,
        existingIndex,
      })
    }
  }
  if (event.kind === 'generation' && event.status === 'completed') {
    const existingIndex = input.lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'generation'
      && entry.event.generationId === event.generationId
    ))
    if (existingIndex < 0) {
      throw new Error(`CREATIVE_WORK_GENERATION_PROJECTION_MISSING:${event.generationId}`)
    }
    return replaceLifecycleEvent({
      lifecycle: input.lifecycle,
      event,
      existingIndex,
    })
  }
  if (event.kind === 'tool_completed' || event.kind === 'tool_failed') {
    const existingIndex = input.lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'tool_called'
      && entry.event.toolCallId === event.toolCallId
    ))
    if (existingIndex < 0) {
      throw new Error(`CREATIVE_WORK_TOOL_CALL_PROJECTION_MISSING:${event.toolCallId}`)
    }
    return replaceLifecycleEvent({
      lifecycle: input.lifecycle,
      event,
      existingIndex,
    })
  }
  if (event.kind === 'research_completed') {
    const existingIndex = input.lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'research_started'
      && entry.event.researchId === event.researchId
    ))
    if (existingIndex < 0) {
      throw new Error(`CREATIVE_WORK_RESEARCH_PROJECTION_MISSING:${event.researchId}`)
    }
    return replaceLifecycleEvent({
      lifecycle: input.lifecycle,
      event,
      existingIndex,
    })
  }
  if (event.kind === 'submission_rejected' || event.kind === 'submission_accepted') {
    const existingIndex = input.lifecycle.events.findIndex((entry) => (
      entry.event.kind === 'submission_started'
      && entry.event.submissionId === event.submissionId
    ))
    if (existingIndex < 0) {
      throw new Error(`CREATIVE_WORK_SUBMISSION_PROJECTION_MISSING:${event.submissionId}`)
    }
    return replaceLifecycleEvent({
      lifecycle: input.lifecycle,
      event,
      existingIndex,
    })
  }
  if (input.lifecycle.events.length >= 64) {
    throw new Error('CREATIVE_WORK_LIFECYCLE_PROJECTION_EXHAUSTED')
  }
  return {
    ...input.lifecycle,
    events: [
      ...input.lifecycle.events,
      {
        sequence: input.lifecycle.events.length + 1,
        occurredAt: input.occurredAt,
        event,
      },
    ],
  }
}
