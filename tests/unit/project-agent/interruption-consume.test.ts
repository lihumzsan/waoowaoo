import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback(prismaMock)),
  $queryRaw: vi.fn(async () => [{ id: 'run-1', runVersion: 3, eventSeq: BigInt(11) }]),
  projectAgentInterruption: {
    findFirst: vi.fn(),
    findMany: vi.fn(async (): Promise<Array<{
      id: string
      runId: string | null
      activityId: string | null
      runVersion: number
      eventSeq: bigint
    }>> => []),
  },
  projectAgentActivity: {
    findFirst: vi.fn(async () => null),
  },
}))

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
  appendProjectAgentEventsInTransaction: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/event', () => eventMock)

import {
  consumeProjectAgentApprovalInterruption,
  consumeProjectAgentChoiceInterruption,
  readRetryableConsumedProjectAgentApprovalInterruption,
  readRetryableConsumedProjectAgentChoiceInterruption,
} from '@/lib/project-agent/interruptions'
import { fingerprintProjectAgentChoiceSubject } from '@/lib/project-agent/choice-offer'

const scope = {
  projectId: 'project-1',
  userId: 'user-1',
  episodeId: 'episode-1',
  assistantId: 'workspace-command' as const,
  runId: 'run-1',
  interruptionId: 'interruption-1',
  response: { approved: true },
}

const choiceCardDefinition = {
  cardId: 'card-1',
  toolCallId: 'tool-1',
  mode: 'confirm_or_text' as const,
  replyMode: 'whole_card' as const,
  title: 'Use this direction?',
  groups: [],
  submitLabel: 'Confirm',
  replyLabel: 'Change direction',
  replyPlaceholder: 'Describe the change',
  replySubmitLabel: 'Submit change',
}

const choiceOffer = {
  card: {
    ...choiceCardDefinition,
    runId: 'run-1',
    interruptionId: 'interruption-1',
  },
  subject: {
    kind: 'none' as const,
    fingerprint: fingerprintProjectAgentChoiceSubject('none', {
      card: choiceCardDefinition,
      commitments: [],
    }),
  },
  commitments: [],
}

const choiceScope = {
  ...scope,
  request: new NextRequest('http://localhost/api/projects/project-1/assistant/chat'),
  operationSignal: new AbortController().signal,
  cardId: 'card-1',
  toolCallId: 'tool-1',
  response: { kind: 'confirm' } as const,
}

function pendingChoiceRecord() {
  return {
    id: 'interruption-1',
    runId: 'run-1',
    activityId: 'activity-1',
    status: 'pending',
    operationId: 'request_choice',
    approvalId: 'choice-1',
    toolCallId: 'tool-1',
    payload: choiceOffer,
    runState: null,
    runVersion: 2,
    eventSeq: BigInt(10),
  }
}

describe('project agent interruption consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns conflict semantics when a concurrent approval consumer wins the status CAS', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      ...pendingChoiceRecord(),
      operationId: 'create_image',
      approvalId: 'approval-1',
      payload: {},
      runState: 'serialized-run-state',
    })
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(new Error(
      'PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=interruption-1 runId=run-1',
    ))

    await expect(consumeProjectAgentApprovalInterruption(scope)).resolves.toBeNull()
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        events: expect.arrayContaining([expect.objectContaining({
          runFence: { runId: 'run-1', runVersion: 3, eventSeq: '11' },
          event: expect.objectContaining({
            kind: 'interruption.resolved',
            interruptionId: 'interruption-1',
            outcome: 'consumed',
          }),
        }), expect.objectContaining({
          runFence: { runId: 'run-1', runVersion: 3, eventSeq: '11' },
          idempotencyKey: 'run-execution-started:decision:interruption-1',
          event: {
            kind: 'run.execution_started',
            runId: 'run-1',
            executionSegmentId: 'decision:interruption-1',
            controlKind: 'approval_response',
          },
        })]),
      }),
    )
  })

  it('returns conflict semantics when a concurrent Choice consumer wins the status CAS', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce(pendingChoiceRecord())
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(new Error(
      'PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=interruption-1 runId=run-1',
    ))

    await expect(consumeProjectAgentChoiceInterruption(choiceScope)).resolves.toBeNull()
  })

  it('does not hide infrastructure failures as a duplicate decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce(pendingChoiceRecord())
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(new Error('DB_UNAVAILABLE'))

    await expect(consumeProjectAgentChoiceInterruption(choiceScope)).rejects.toThrow('DB_UNAVAILABLE')
  })

  it('persists and returns only the canonical current decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce(pendingChoiceRecord())

    const consumed = await consumeProjectAgentChoiceInterruption(choiceScope)

    expect(consumed?.parsedResponse).toEqual({ kind: 'confirm' })
    expect(consumed?.appliedOperationId).toBeNull()
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        events: expect.arrayContaining([expect.objectContaining({
          event: expect.objectContaining({ response: { kind: 'confirm' } }),
        })]),
      }),
    )
  })

  it('recovers the same immutable approval decision without reopening it', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'consumed',
      operationId: 'create_image',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
      response: { approved: true, reason: null },
      runState: 'serialized-run-state',
    })

    const recovered = await readRetryableConsumedProjectAgentApprovalInterruption({
      ...scope,
      response: { approved: true, reason: null },
    })

    expect(recovered).toEqual(expect.objectContaining({
      id: 'interruption-1',
      status: 'consumed',
      runState: 'serialized-run-state',
    }))
  })

  it('rejects a changed approval answer when recovering a consumed decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      status: 'consumed',
      response: { approved: true, reason: null },
      runState: 'serialized-run-state',
    })

    await expect(readRetryableConsumedProjectAgentApprovalInterruption({
      ...scope,
      response: { approved: false, reason: null },
    })).resolves.toBeNull()
  })

  it('recovers only the exact stored generic Choice decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      ...pendingChoiceRecord(),
      status: 'consumed',
      response: { kind: 'confirm' },
    })

    const recovered = await readRetryableConsumedProjectAgentChoiceInterruption(choiceScope)

    expect(recovered?.parsedResponse).toEqual({ kind: 'confirm' })
  })

  it('rejects a changed Choice answer during retry recovery', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      ...pendingChoiceRecord(),
      status: 'consumed',
      response: { kind: 'confirm' },
    })

    await expect(readRetryableConsumedProjectAgentChoiceInterruption({
      ...choiceScope,
      response: { kind: 'text', text: 'Use a different direction.' },
    })).resolves.toBeNull()
  })
})
