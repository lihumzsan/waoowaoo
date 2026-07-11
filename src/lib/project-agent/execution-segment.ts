export type ProjectAgentExecutionSegment = {
  id: string
  controlKind: 'user_turn' | 'approval_response' | 'choice_response' | 'task_follow_up'
}

export type ProjectAgentExecutionSegmentSource =
  | { kind: 'user_turn'; runId: string }
  | { kind: 'approval_response' | 'choice_response'; interruptionId: string }
  | { kind: 'task_follow_up'; commandId: string }

function requireIdentity(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

/**
 * Identifies one irreversible model/tool execution segment. A persisted Run can
 * contain several segments, so Run id alone is never an execution identity.
 */
export function createProjectAgentExecutionSegment(
  source: ProjectAgentExecutionSegmentSource,
): ProjectAgentExecutionSegment {
  switch (source.kind) {
    case 'user_turn': {
      const runId = requireIdentity(source.runId, 'PROJECT_AGENT_EXECUTION_SEGMENT_RUN_ID_REQUIRED')
      return { id: `user-turn:${runId}`, controlKind: 'user_turn' }
    }
    case 'approval_response':
    case 'choice_response': {
      const interruptionId = requireIdentity(
        source.interruptionId,
        'PROJECT_AGENT_EXECUTION_SEGMENT_INTERRUPTION_ID_REQUIRED',
      )
      return { id: `decision:${interruptionId}`, controlKind: source.kind }
    }
    case 'task_follow_up': {
      const commandId = requireIdentity(
        source.commandId,
        'PROJECT_AGENT_EXECUTION_SEGMENT_COMMAND_ID_REQUIRED',
      )
      return { id: `wait-continuation:${commandId}`, controlKind: 'task_follow_up' }
    }
  }
}

export function projectAgentExecutionStartedIdempotencyKey(segmentId: string): string {
  return `run-execution-started:${requireIdentity(
    segmentId,
    'PROJECT_AGENT_EXECUTION_SEGMENT_ID_REQUIRED',
  )}`
}

export function readProjectAgentDecisionInterruptionId(segmentId: string): string | null {
  const prefix = 'decision:'
  if (!segmentId.startsWith(prefix)) return null
  return requireIdentity(
    segmentId.slice(prefix.length),
    'PROJECT_AGENT_EXECUTION_SEGMENT_INTERRUPTION_ID_REQUIRED',
  )
}
