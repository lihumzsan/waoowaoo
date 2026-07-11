import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback(prismaMock)),
  $queryRaw: vi.fn(async () => [{ id: 'run-1', runVersion: 2, eventSeq: BigInt(10) }]),
  projectAgentInterruption: {
    findMany: vi.fn(async (): Promise<Array<{
      id: string
      runId: string | null
      activityId: string | null
      runVersion: number
      eventSeq: bigint
    }>> => []),
  },
}))

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
  appendProjectAgentEventsInTransaction: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/event', () => eventMock)

import {
  settleProjectAgentInterruptionSuspension,
} from '@/lib/project-agent/interruptions'
import {
  runWithProjectAgentOperationExecutionFence,
  type ProjectAgentOperationExecutionFence,
} from '@/lib/project-agent/operation-execution-fence'
import { fingerprintProjectAgentChoiceResource } from '@/lib/project-agent/choice-offer'

const createApprovalInput = {
  kind: 'approval' as const,
  projectId: 'project-1',
  userId: 'user-1',
  episodeId: 'episode-1',
  assistantId: 'workspace-command' as const,
  runId: 'run-1',
  runFence: { runId: 'run-1', runVersion: 2, eventSeq: '10' },
  operationId: 'generate_edit_style_previews',
  approvalId: 'approval-new',
  toolCallId: 'tool-new',
  runState: 'serialized-run-state',
  payload: { operationPlan: { operationId: 'generate_edit_style_previews' } },
}

describe('project agent interruption creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'run-1', runVersion: 2, eventSeq: BigInt(10) }])
    prismaMock.projectAgentInterruption.findMany.mockResolvedValue([])
    eventMock.appendProjectAgentEventsInTransaction.mockResolvedValue(null)
  })

  it('supersedes and raises an approval under the same Run lock and transaction', async () => {
    prismaMock.projectAgentInterruption.findMany.mockResolvedValueOnce([{
      id: 'interruption-old',
      runId: 'run-1',
      activityId: 'activity-old',
      runVersion: 2,
      eventSeq: BigInt(10),
    }])

    const suspension = await settleProjectAgentInterruptionSuspension(createApprovalInput)

    expect(suspension).toMatchObject({
      kind: 'approval',
      interruptionId: expect.any(String),
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        events: [
          expect.objectContaining({
            idempotencyKey: 'interruption-resolved:interruption-old:superseded',
            event: expect.objectContaining({
              kind: 'interruption.resolved',
              interruptionId: 'interruption-old',
              outcome: 'superseded',
            }),
          }),
          expect.objectContaining({
            event: expect.objectContaining({
              kind: 'interruption.raised',
              interruptionKind: 'approval',
              approvalId: 'approval-new',
            }),
          }),
        ],
      }),
    )
    expect(eventMock.appendProjectAgentEvents).not.toHaveBeenCalled()
  })

  it('propagates a projection fault without falling through to a second approval write', async () => {
    eventMock.appendProjectAgentEventsInTransaction.mockRejectedValueOnce(
      new Error('PROJECT_AGENT_ACTIVITY_TRANSITION_RACED'),
    )

    await expect(settleProjectAgentInterruptionSuspension(createApprovalInput))
      .rejects.toThrow('PROJECT_AGENT_ACTIVITY_TRANSITION_RACED')

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledTimes(1)
    expect(eventMock.appendProjectAgentEvents).not.toHaveBeenCalled()
  })

  it('rejects a suspension whose write fence diverges from its execution fence', async () => {
    await expect(settleProjectAgentInterruptionSuspension({
      ...createApprovalInput,
      executionFence: {
        runFence: { runId: 'run-1', runVersion: 3, eventSeq: '11' },
        signal: new AbortController().signal,
      },
    })).rejects.toThrow('PROJECT_AGENT_SUSPENSION_EXECUTION_FENCE_MISMATCH:run-1')

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('records the committed Choice suspension receipt on the current Operation fence', async () => {
    const fence: ProjectAgentOperationExecutionFence = {
      runFence: { runId: 'run-1', runVersion: 2, eventSeq: '10' },
      signal: new AbortController().signal,
    }

    await runWithProjectAgentOperationExecutionFence(fence, async () => {
      await settleProjectAgentInterruptionSuspension({
        kind: 'choice',
        executionFence: fence,
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
        runId: 'run-1',
        runFence: fence.runFence,
        operationId: 'request_script_intake_choice',
        toolCallId: 'tool-choice-1',
        card: {
          cardId: 'card-choice-1',
          toolCallId: 'tool-choice-1',
          choiceType: 'script_intake',
          replyMode: 'per_group',
          title: 'Refine story brief',
          groups: [],
          submitLabel: 'Continue',
          submit: { kind: 'submit_tool_output', decision: 'approve' },
        },
        reviewedResource: {
          ...fingerprintProjectAgentChoiceResource({
            kind: 'script_intake_prompt',
            snapshot: {
              cardId: 'card-choice-1',
              choiceType: 'script_intake',
              groups: [],
            },
          }),
        },
      })
    })

    expect(fence.suspensionReceipt).toEqual(expect.objectContaining({
      kind: 'choice',
      cardId: 'card-choice-1',
      toolCallId: 'tool-choice-1',
      choiceType: 'script_intake',
    }))
    expect(fence.suspensionReceipt?.kind).toBe('choice')
    if (fence.suspensionReceipt?.kind === 'choice') {
      expect(fence.suspensionReceipt.interruptionId).toEqual(expect.any(String))
    }
  })

  it('rolls back a Choice handoff when ownership is lost after projection but before commit', async () => {
    const controller = new AbortController()
    const fence: ProjectAgentOperationExecutionFence = {
      runFence: { runId: 'run-1', runVersion: 2, eventSeq: '10' },
      signal: controller.signal,
    }
    eventMock.appendProjectAgentEventsInTransaction.mockImplementationOnce(async () => {
      controller.abort(new Error('RUN_LOCK_LOST'))
      return null
    })

    await expect(runWithProjectAgentOperationExecutionFence(fence, async () => {
      await settleProjectAgentInterruptionSuspension({
        kind: 'choice',
        executionFence: fence,
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
        runId: 'run-1',
        runFence: fence.runFence,
        operationId: 'request_script_intake_choice',
        toolCallId: 'tool-choice-1',
        card: {
          cardId: 'card-choice-1',
          toolCallId: 'tool-choice-1',
          choiceType: 'script_intake',
          replyMode: 'per_group',
          title: 'Refine story brief',
          groups: [],
          submitLabel: 'Continue',
          submit: { kind: 'submit_tool_output', decision: 'approve' },
        },
        reviewedResource: fingerprintProjectAgentChoiceResource({
          kind: 'script_intake_prompt',
          snapshot: {
            cardId: 'card-choice-1',
            choiceType: 'script_intake',
            groups: [],
          },
        }),
      })
    })).rejects.toThrow('PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED runId=run-1 reason=aborted')

    expect(fence.suspensionReceipt).toBeUndefined()
  })
})
