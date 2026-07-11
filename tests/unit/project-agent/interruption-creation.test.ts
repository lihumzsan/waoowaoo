import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback(prismaMock)),
  $queryRaw: vi.fn(async () => [{ id: 'run-1' }]),
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

import { createProjectAgentApprovalInterruption } from '@/lib/project-agent/interruptions'

const createApprovalInput = {
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
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'run-1' }])
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

    const interruptionId = await createProjectAgentApprovalInterruption(createApprovalInput)

    expect(interruptionId).toEqual(expect.any(String))
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

    await expect(createProjectAgentApprovalInterruption(createApprovalInput))
      .rejects.toThrow('PROJECT_AGENT_ACTIVITY_TRANSITION_RACED')

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledTimes(1)
    expect(eventMock.appendProjectAgentEvents).not.toHaveBeenCalled()
  })
})
