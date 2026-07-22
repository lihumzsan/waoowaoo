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
    operationId: 'request_choice',
    activityId: 'activity-1',
    interruptionId: 'interruption-1',
    cardId: 'card-1',
    toolCallId: 'tool-1',
    card: {
      cardId: 'card-1',
      runId: 'run-1',
      interruptionId: 'interruption-1',
      toolCallId: 'tool-1',
      mode: 'confirm',
      replyMode: 'none',
      title: 'Choose',
      groups: [],
      submitLabel: 'Continue',
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

  it('does not equate an Approval handoff with a Choice handoff', () => {
    expect(isSameProjectAgentSuspensionReceipt(choiceReceipt(), {
      kind: 'approval',
      runId: 'run-1',
      operationId: 'request_choice',
      activityId: 'activity-1',
      interruptionId: 'interruption-1',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
    })).toBe(false)
  })
})
