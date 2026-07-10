type UnknownRecord = Record<string, unknown>

/**
 * Structured control actions sent in the chat request body.
 * Control never travels inside message metadata: the thread is data-plane only.
 */
export type ProjectAgentControlAction =
  | {
    type: 'approval_response'
    runId: string
    interruptionId: string
    approved: boolean
    reason: string | null
  }
  | {
    type: 'choice_response'
    runId: string
    interruptionId: string
    cardId: string
    toolCallId: string
    output: UnknownRecord
  }

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function parseProjectAgentControlAction(value: unknown): ProjectAgentControlAction | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) {
    throw new Error('PROJECT_AGENT_CONTROL_INVALID')
  }

  if (value.type === 'approval_response') {
    const runId = readNonEmptyString(value.runId)
    const interruptionId = readNonEmptyString(value.interruptionId)
    if (!runId || !interruptionId || typeof value.approved !== 'boolean') {
      throw new Error('PROJECT_AGENT_CONTROL_INVALID')
    }
    return {
      type: 'approval_response',
      runId,
      interruptionId,
      approved: value.approved,
      reason: readNonEmptyString(value.reason),
    }
  }

  if (value.type === 'choice_response') {
    const runId = readNonEmptyString(value.runId)
    const interruptionId = readNonEmptyString(value.interruptionId)
    const cardId = readNonEmptyString(value.cardId)
    const toolCallId = readNonEmptyString(value.toolCallId)
    if (!runId || !interruptionId || !cardId || !toolCallId || !isRecord(value.output)) {
      throw new Error('PROJECT_AGENT_CONTROL_INVALID')
    }
    return {
      type: 'choice_response',
      runId,
      interruptionId,
      cardId,
      toolCallId,
      output: value.output,
    }
  }

  throw new Error('PROJECT_AGENT_CONTROL_INVALID')
}
