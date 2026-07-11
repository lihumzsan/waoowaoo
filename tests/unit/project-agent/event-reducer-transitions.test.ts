import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { reduceProjectAgentEvent as reduceProjectAgentEventWithFence } from '@/lib/project-agent/event/reducer'

type ReducerParams = Parameters<typeof reduceProjectAgentEventWithFence>[0]
type ReducerTx = ReducerParams['tx']
type MockFunction = ReturnType<typeof vi.fn>

interface ProjectAgentReducerTxMock {
  projectAgentActivity: {
    findFirst: MockFunction
    findUnique: MockFunction
    create: MockFunction
    upsert: MockFunction
    updateMany: MockFunction
  }
  projectAgentRun: {
    create: MockFunction
    findUnique: MockFunction
    updateMany: MockFunction
  }
  projectAgentWait: {
    findUnique: MockFunction
    upsert: MockFunction
    updateMany: MockFunction
  }
  projectAgentInterruption: {
    create: MockFunction
    findUnique: MockFunction
    updateMany: MockFunction
  }
}

const scope = {
  projectId: 'project-1',
  userId: 'user-1',
  assistantId: 'workspace-command' as const,
  episodeId: 'episode-1',
  scopeRef: 'episode:episode-1',
}

function reduceProjectAgentEvent(
  params: Omit<ReducerParams, 'eventId' | 'expectedFence'>,
): ReturnType<typeof reduceProjectAgentEventWithFence> {
  return reduceProjectAgentEventWithFence({
    ...params,
    eventId: BigInt(2),
    expectedFence: {
      runId: params.event.runId,
      runVersion: 1,
      eventSeq: '1',
    },
  })
}

function createTxMock(): ProjectAgentReducerTxMock {
  return {
    projectAgentActivity: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({
        id: 'activity-1',
        runId: 'run-1',
        type: 'operation',
        status: 'running',
        operationId: 'ingest_script',
        sourceOperationId: null,
        toolCallId: 'tool-1',
        choiceType: null,
      })),
      create: vi.fn(async () => undefined),
      upsert: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectAgentRun: {
      create: vi.fn(async () => undefined),
      findUnique: vi.fn(async () => ({
        status: 'running',
        runVersion: 1,
        eventSeq: BigInt(1),
        terminalEventSeq: null,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectAgentWait: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectAgentInterruption: {
      create: vi.fn(async () => undefined),
      findUnique: vi.fn(async () => ({ type: 'approval' })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  }
}

function asReducerTx(tx: ProjectAgentReducerTxMock): ReducerTx {
  return tx as unknown as ReducerTx
}

describe('project agent event reducer transitions', () => {
  let tx: ProjectAgentReducerTxMock

  beforeEach(() => {
    tx = createTxMock()
  })

  it('rejects a late status event that tries to revive a completed run', async () => {
    tx.projectAgentRun.findUnique.mockResolvedValueOnce({
      status: 'completed', runVersion: 1, eventSeq: BigInt(1), terminalEventSeq: BigInt(1),
    })
    await expect(reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'run.status_changed',
        runId: 'run-1',
        status: 'running',
        expectedStatuses: ['awaiting_approval'],
        stopReason: 'approval_response',
      },
    })).rejects.toThrow('PROJECT_AGENT_RUN_TERMINAL_WATERMARK')
    expect(tx.projectAgentRun.updateMany).not.toHaveBeenCalled()
  })

  it('never reopens a terminal Activity when activity.started reuses its identity', async () => {
    tx.projectAgentActivity.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate activity identity', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    await expect(reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'activity.started',
        runId: 'run-1',
        activityId: 'activity-terminal',
        type: 'operation',
        operationId: 'ingest_script',
      },
    })).rejects.toThrow('PROJECT_AGENT_ACTIVITY_ID_CONFLICT activityId=activity-terminal runId=run-1')

    expect(tx.projectAgentActivity.upsert).not.toHaveBeenCalled()
    expect(tx.projectAgentRun.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    {
      kind: 'activity.completed' as const,
      event: {
        kind: 'activity.completed' as const,
        runId: 'run-1',
        activityId: 'activity-missing',
      },
      target: 'completed',
    },
    {
      kind: 'activity.failed' as const,
      event: {
        kind: 'activity.failed' as const,
        runId: 'run-1',
        activityId: 'activity-missing',
        errorCode: 'TEST_FAILURE',
        errorMessage: 'failure',
      },
      target: 'failed',
    },
    {
      kind: 'activity.cancelled' as const,
      event: {
        kind: 'activity.cancelled' as const,
        runId: 'run-1',
        activityId: 'activity-missing',
        reason: 'cancelled',
      },
      target: 'cancelled',
    },
  ])('fails $kind when no open Activity row matches', async ({ event, target }) => {
    tx.projectAgentActivity.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event,
    })).rejects.toThrow(
      `PROJECT_AGENT_ACTIVITY_TRANSITION_RACED activityId=activity-missing runId=run-1 target=${target}`,
    )
  })

  it('rejects a raced transition instead of allowing a late writer to win', async () => {
    tx.projectAgentRun.findUnique.mockResolvedValueOnce({
      status: 'running', runVersion: 1, eventSeq: BigInt(1), terminalEventSeq: null,
    })
    tx.projectAgentRun.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'run.completed',
        runId: 'run-1',
      },
    })).rejects.toThrow('PROJECT_AGENT_RUN_TRANSITION_RACED')
    expect(tx.projectAgentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'run-1',
        status: 'running',
        runVersion: 1,
        eventSeq: BigInt(1),
      },
    }))
  })

  it('rejects a second interruption consumer instead of replaying the first decision', async () => {
    tx.projectAgentInterruption.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'interruption.resolved',
        runId: 'run-1',
        activityId: 'activity-1',
        interruptionId: 'interruption-1',
        outcome: 'consumed',
        response: { approved: true },
      },
    })).rejects.toThrow('PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED')
    expect(tx.projectAgentActivity.updateMany).not.toHaveBeenCalled()
  })

  it('atomically consumes an approval and transitions its awaiting run to running', async () => {
    tx.projectAgentInterruption.findUnique.mockResolvedValueOnce({ type: 'approval' })
    tx.projectAgentInterruption.updateMany.mockResolvedValueOnce({ count: 1 })
    tx.projectAgentRun.findUnique
      .mockResolvedValueOnce({ status: 'awaiting_approval', runVersion: 1, eventSeq: BigInt(1), terminalEventSeq: null })
      .mockResolvedValueOnce({ status: 'awaiting_approval', runVersion: 1, eventSeq: BigInt(1), terminalEventSeq: null })
      .mockResolvedValueOnce({ status: 'running' })
    await reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'interruption.resolved',
        runId: 'run-1',
        activityId: 'activity-1',
        interruptionId: 'interruption-1',
        outcome: 'consumed',
        response: { approved: true },
      },
    })
    expect(tx.projectAgentRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'run-1', status: 'awaiting_approval', runVersion: 1 }),
      data: expect.objectContaining({
        status: 'running',
        stopReason: 'approval_response',
      }),
    })
    const interruptionUpdate = tx.projectAgentInterruption.updateMany.mock.calls[0]?.[0]
    expect(interruptionUpdate?.data).not.toHaveProperty('runState')
  })
})
