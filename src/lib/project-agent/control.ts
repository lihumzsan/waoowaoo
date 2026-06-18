import type { EditFirstChoiceType } from './choice-card'

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
    interruptionId: string | null
    choiceType: EditFirstChoiceType
    toolCallId: string | null
    output: UnknownRecord
  }
  | {
    type: 'task_follow_up'
    runId: string
    waitId: string
    claimId: string
  }

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isEditFirstChoiceType(value: unknown): value is EditFirstChoiceType {
  return value === 'duration_and_aspect_ratio'
    || value === 'screenplay_review'
    || value === 'style'
    || value === 'asset_review'
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
    if (!runId || !isEditFirstChoiceType(value.choiceType) || !isRecord(value.output)) {
      throw new Error('PROJECT_AGENT_CONTROL_INVALID')
    }
    return {
      type: 'choice_response',
      runId,
      interruptionId,
      choiceType: value.choiceType,
      toolCallId: readNonEmptyString(value.toolCallId),
      output: value.output,
    }
  }

  if (value.type === 'task_follow_up') {
    const runId = readNonEmptyString(value.runId)
    const waitId = readNonEmptyString(value.waitId)
    const claimId = readNonEmptyString(value.claimId)
    if (!runId || !waitId || !claimId) {
      throw new Error('PROJECT_AGENT_CONTROL_INVALID')
    }
    return {
      type: 'task_follow_up',
      runId,
      waitId,
      claimId,
    }
  }

  throw new Error('PROJECT_AGENT_CONTROL_INVALID')
}
