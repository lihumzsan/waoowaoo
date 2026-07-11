import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAgentRun: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  projectAgentEvent: {
    findUnique: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}))

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
  appendProjectAgentEventsInTransaction: vi.fn(async () => null),
}))

const runLockMock = vi.hoisted(() => ({
  releaseProjectAgentRunLockForRun: vi.fn(async () => false),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/run-lock', () => runLockMock)
vi.mock('@/lib/project-agent/event', () => eventMock)

import {
  cancelRunningProjectAgentRun,
  cancelStaleRunningProjectAgentRunsForScope,
  createProjectAgentConsumedControlRetryRun,
  ensureProjectAgentRunSlotAvailable,
} from '@/lib/project-agent/runs'

describe('project agent runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectAgentRun.findFirst.mockResolvedValue(null)
    prismaMock.projectAgentRun.findUnique.mockResolvedValue({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    prismaMock.projectAgentRun.findMany.mockResolvedValue([])
    prismaMock.projectAgentRun.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.projectAgentEvent.findUnique.mockResolvedValue(null)
    prismaMock.$queryRaw.mockResolvedValue([])
    prismaMock.$transaction.mockImplementation(async (work: (tx: typeof prismaMock) => Promise<unknown>) => (
      await work(prismaMock)
    ))
    eventMock.appendProjectAgentEvents.mockResolvedValue(null)
    eventMock.appendProjectAgentEventsInTransaction.mockResolvedValue(null)
    runLockMock.releaseProjectAgentRunLockForRun.mockResolvedValue(false)
  })

  it('cancels only a currently running run when a response stream is cancelled', async () => {
    prismaMock.projectAgentRun.findFirst.mockResolvedValueOnce({
      id: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    const cancelled = await cancelRunningProjectAgentRun({
      runFence: { runId: 'run-1', runVersion: 1, eventSeq: '1' },
      stopReason: 'stream_cancelled',
    })

    expect(cancelled).toBe(true)
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        assistantId: 'workspace-command',
      }),
      events: [expect.objectContaining({
        event: expect.objectContaining({
          kind: 'run.cancelled',
          runId: 'run-1',
          reason: 'stream_cancelled',
        }),
      })],
    }))
  })

  it('does not cancel running runs while heartbeat is fresh even if no runtime lock exists', async () => {
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([])

    const cancelledIds = await cancelStaleRunningProjectAgentRunsForScope({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(cancelledIds).toEqual([])
    expect(eventMock.appendProjectAgentEvents).not.toHaveBeenCalled()
    expect(prismaMock.projectAgentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'running',
        OR: expect.any(Array) as unknown[],
      }),
    }))
  })

  it('cancels stale running runs when heartbeat is expired', async () => {
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([
      { id: 'run-1', runVersion: 1, eventSeq: BigInt(1) },
      { id: 'run-2', runVersion: 3, eventSeq: BigInt(9) },
    ])

    const cancelledIds = await cancelStaleRunningProjectAgentRunsForScope({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })

    expect(cancelledIds).toEqual(['run-1', 'run-2'])
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledTimes(2)
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({
        event: expect.objectContaining({
          kind: 'run.status_changed',
          runId: 'run-1',
          status: 'cancelled',
          stopReason: 'stale_running_run',
        }),
      })],
    }))
    expect(runLockMock.releaseProjectAgentRunLockForRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
    }))
  })

  it('rejects a new run slot while a fresh running run exists', async () => {
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([])
    prismaMock.projectAgentRun.findFirst.mockResolvedValueOnce({
      id: 'run-fresh',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-1',
      status: 'running',
      runVersion: 1,
      eventSeq: BigInt(1),
      terminalEventSeq: null,
      controlKind: 'user_turn',
      stopReason: null,
      heartbeatAt: new Date(),
    })

    await expect(ensureProjectAgentRunSlotAvailable({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })).rejects.toThrow('PROJECT_AGENT_RUN_ACTIVE')
  })

  it('creates a new Run attempt from a consumed decision only after a pre-execution failure', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{
      id: 'interruption-1',
      runId: 'run-origin',
      type: 'choice',
      status: 'consumed',
    }])
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([])
    prismaMock.projectAgentRun.findUnique.mockResolvedValueOnce({
      id: 'run-origin',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-origin',
      status: 'failed',
      runVersion: 1,
      eventSeq: BigInt(4),
      terminalEventSeq: BigInt(4),
      controlKind: 'user_turn',
      stopReason: 'control_resolution_failed',
      errorCode: 'PROJECT_AGENT_CONTROL_FAILED',
      errorMessage: 'DB_DOWN',
      heartbeatAt: new Date(),
    })
    prismaMock.projectAgentRun.findFirst.mockResolvedValueOnce({
      id: 'run-retry',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'project-agent-control-retry:interruption-1:1:req-2',
      status: 'running',
      runVersion: 1,
      eventSeq: BigInt(5),
      terminalEventSeq: null,
      controlKind: 'choice_response',
      stopReason: null,
      errorCode: null,
      errorMessage: null,
      heartbeatAt: new Date(),
    })

    const run = await createProjectAgentConsumedControlRetryRun({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      interruptionId: 'interruption-1',
      requestId: 'req-2',
      controlKind: 'choice_response',
      runId: 'run-retry',
    })

    expect(run.id).toBe('run-retry')
    expect(eventMock.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        events: [expect.objectContaining({
          event: expect.objectContaining({
            kind: 'run.started',
            runId: 'run-retry',
            controlKind: 'choice_response',
          }),
        })],
      }),
    )
  })

  it('never replays a consumed decision after the execution-started fence exists', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{
      id: 'interruption-1',
      runId: 'run-origin',
      type: 'approval',
      status: 'consumed',
    }])
    prismaMock.projectAgentRun.findMany.mockResolvedValueOnce([])
    prismaMock.projectAgentRun.findUnique.mockResolvedValueOnce({
      id: 'run-origin',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      controlKind: 'approval_response',
      status: 'failed',
      errorCode: 'PROJECT_AGENT_CONTROL_FAILED',
    })
    prismaMock.projectAgentEvent.findUnique.mockResolvedValueOnce({ id: BigInt(9) })

    await expect(createProjectAgentConsumedControlRetryRun({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      interruptionId: 'interruption-1',
      requestId: 'req-2',
      controlKind: 'approval_response',
      runId: 'run-retry',
    })).rejects.toThrow('PROJECT_AGENT_CONTROL_EXECUTION_OUTCOME_UNKNOWN:run-origin')
    expect(prismaMock.projectAgentEvent.findUnique).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'run-execution-started:decision:interruption-1',
      },
      select: { id: true },
    })
    expect(eventMock.appendProjectAgentEventsInTransaction).not.toHaveBeenCalled()
  })
})
