import { describe, expect, it } from 'vitest'
import {
  assertProjectAgentSuspensionReceipt,
  isSameProjectAgentSuspensionReceipt,
  type ProjectAgentChoiceSuspensionReceipt,
} from '@/lib/project-agent/suspension'

function choiceReceipt(): ProjectAgentChoiceSuspensionReceipt {
  return {
    kind: 'choice',
    runId: 'run-1',
    operationId: 'request_future_choice',
    activityId: 'activity-1',
    interruptionId: 'interruption-1',
    cardId: 'card-1',
    toolCallId: 'tool-1',
    choiceType: 'script_intake',
    card: {
      cardId: 'card-1',
      runId: 'run-1',
      interruptionId: 'interruption-1',
      toolCallId: 'tool-1',
      choiceType: 'script_intake',
      replyMode: 'per_group',
      title: 'Choose',
      groups: [],
      submitLabel: 'Continue',
      submit: { kind: 'submit_tool_output', decision: 'approve' },
    },
  }
}

describe('Project Agent suspension receipts', () => {
  it('matches protocol identity without treating UI payload as a second lifecycle authority', () => {
    const first = choiceReceipt()
    const replay = {
      ...choiceReceipt(),
      card: { ...choiceReceipt().card, title: 'New presentation copy' },
    }

    expect(isSameProjectAgentSuspensionReceipt(first, replay)).toBe(true)
  })

  it('rejects a receipt from another operation even when the Run is the same', () => {
    expect(() => assertProjectAgentSuspensionReceipt({
      receipt: choiceReceipt(),
      runId: 'run-1',
      kind: 'choice',
      operationId: 'different_choice',
    })).toThrow('PROJECT_AGENT_SUSPENSION_RECEIPT_OPERATION_MISMATCH')
  })

  it('does not equate a Task handoff with a Choice handoff', () => {
    expect(isSameProjectAgentSuspensionReceipt(choiceReceipt(), {
      kind: 'task',
      runId: 'run-1',
      operationId: 'request_future_choice',
      activityId: 'activity-1',
      waitId: 'wait-1',
      taskIds: ['task-1'],
      followUpMode: 'resume_agent',
    })).toBe(false)
  })
})
