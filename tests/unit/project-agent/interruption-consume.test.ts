import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback(prismaMock)),
  $queryRaw: vi.fn(async () => [{ id: 'run-1' }]),
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
  projectEditBible: {
    findFirst: vi.fn(),
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
import {
  assertProjectAgentChoiceOfferCurrent,
  fingerprintProjectAgentChoiceResource,
} from '@/lib/project-agent/choice-offer'

const scope = {
  projectId: 'project-1',
  userId: 'user-1',
  episodeId: 'episode-1',
  assistantId: 'workspace-command' as const,
  runId: 'run-1',
  interruptionId: 'interruption-1',
  response: { approved: true },
}

const choiceCard = {
  cardId: 'card-1',
  runId: 'run-1',
  interruptionId: 'interruption-1',
  toolCallId: 'tool-1',
  choiceType: 'script_intake' as const,
  replyMode: 'per_group' as const,
  variant: 'confirm_or_reply' as const,
  title: 'Refine brief',
  groups: [],
  submitLabel: 'Continue',
  submit: { kind: 'submit_tool_output' as const, decision: 'approve' as const },
}

const choiceOffer = {
  schemaVersion: 1,
  card: choiceCard,
  reviewedResource: fingerprintProjectAgentChoiceResource({
    kind: 'script_intake_prompt',
    snapshot: {
      cardId: choiceCard.cardId,
      choiceType: choiceCard.choiceType,
      groups: choiceCard.groups,
    },
  }),
}

const choiceScope = {
  ...scope,
  cardId: 'card-1',
  toolCallId: 'tool-1',
  latestUserText: 'canonical brief',
}

describe('project agent interruption consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns conflict semantics when a concurrent approval consumer wins the status CAS', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'generate_edit_style_previews',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
      runState: 'serialized-run-state',
      runVersion: 2,
      eventSeq: BigInt(10),
    })
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(new Error(
      'PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=interruption-1 runId=run-1',
    ))

    await expect(consumeProjectAgentApprovalInterruption(scope)).resolves.toBeNull()
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
      events: expect.arrayContaining([expect.objectContaining({
        runFence: { runId: 'run-1', runVersion: 2, eventSeq: '10' },
        event: expect.objectContaining({
          kind: 'interruption.resolved',
          interruptionId: 'interruption-1',
          outcome: 'consumed',
        }),
      })]),
    }))
  })

  it('returns conflict semantics when a concurrent choice consumer wins the status CAS', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'request_edit_bible_review_choice',
      approvalId: 'choice-1',
      toolCallId: 'tool-1',
      payload: choiceOffer,
      runState: null,
      runVersion: 2,
      eventSeq: BigInt(10),
    })
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(new Error(
      'PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=interruption-1 runId=run-1',
    ))

    await expect(consumeProjectAgentChoiceInterruption(choiceScope)).resolves.toBeNull()
  })

  it('does not hide infrastructure failures as a duplicate decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'request_edit_bible_review_choice',
      approvalId: 'choice-1',
      toolCallId: 'tool-1',
      payload: choiceOffer,
      runState: null,
      runVersion: 2,
      eventSeq: BigInt(10),
    })
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(new Error('DB_UNAVAILABLE'))

    await expect(consumeProjectAgentChoiceInterruption(choiceScope)).rejects.toThrow('DB_UNAVAILABLE')
  })

  it('persists only the canonical decision and returns the same decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'request_script_intake_choice',
      approvalId: 'choice-1',
      toolCallId: 'tool-1',
      payload: choiceOffer,
      runState: null,
      runVersion: 2,
      eventSeq: BigInt(10),
    })

    const consumed = await consumeProjectAgentChoiceInterruption({
      ...choiceScope,
      response: {
        ok: true,
        ignored: 'must not be persisted',
      },
    })

    expect(consumed?.parsedResponse).toEqual({
      choiceType: 'script_intake',
      decision: 'submit',
      normalizedBrief: 'canonical brief',
    })
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        events: [expect.objectContaining({
          event: expect.objectContaining({
            response: {
              choiceType: 'script_intake',
              decision: 'submit',
              normalizedBrief: 'canonical brief',
            },
          }),
        })],
      }),
    )
  })

  it('recovers the same immutable approval decision without reopening it', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'consumed',
      operationId: 'generate_edit_style_previews',
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

  it('recovers only the stored canonical Choice decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'consumed',
      operationId: 'request_script_intake_choice',
      approvalId: 'choice-1',
      toolCallId: 'tool-1',
      payload: choiceOffer,
      response: {
        choiceType: 'script_intake',
        decision: 'submit',
        normalizedBrief: 'canonical brief',
      },
    })

    const recovered = await readRetryableConsumedProjectAgentChoiceInterruption({
      ...choiceScope,
      response: { ok: true },
    })

    expect(recovered?.parsedResponse).toEqual({
      choiceType: 'script_intake',
      decision: 'submit',
      normalizedBrief: 'canonical brief',
    })
  })

  it('rejects a decision when the reviewed script resource changed', async () => {
    const reviewedAt = new Date('2026-07-01T00:00:00.000Z')
    const original = {
      id: 'bible-1',
      status: 'script_ready_for_review',
      version: 1,
      updatedAt: reviewedAt,
      sourceDocument: {
        id: 'source-1',
        sourceKind: 'prompt_generated_script',
        checksum: 'checksum-before',
        version: 1,
        normalizedText: 'original script',
        updatedAt: reviewedAt,
      },
    }
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      ...original,
      sourceDocument: {
        ...original.sourceDocument,
        checksum: 'checksum-after',
        normalizedText: 'changed script',
      },
    })
    const offer = {
      schemaVersion: 1 as const,
      card: {
        ...choiceCard,
        choiceType: 'script_review' as const,
      },
      reviewedResource: fingerprintProjectAgentChoiceResource({
        kind: 'script_review_document',
        snapshot: original,
      }),
    }

    await expect(assertProjectAgentChoiceOfferCurrent({
      tx: prismaMock as never,
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      offer,
    })).rejects.toThrow('PROJECT_AGENT_CHOICE_OFFER_STALE')
  })
})
