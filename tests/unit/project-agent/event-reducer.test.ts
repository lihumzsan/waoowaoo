import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reduceProjectAgentEvent } from '@/lib/project-agent/event/reducer'

type ReducerTx = Parameters<typeof reduceProjectAgentEvent>[0]['tx']
type MockFunction = ReturnType<typeof vi.fn>

interface ProjectAgentActivityTxMock {
  findFirst: MockFunction
  findUnique: MockFunction
  upsert: MockFunction
  updateMany: MockFunction
}

interface ProjectAgentRunTxMock {
  upsert: MockFunction
  updateMany: MockFunction
}

interface ProjectAgentWaitTxMock {
  findUnique: MockFunction
  upsert: MockFunction
  updateMany: MockFunction
}

interface ProjectAgentInterruptionTxMock {
  create: MockFunction
  updateMany: MockFunction
}

interface ProjectAgentReducerTxMock {
  projectAgentActivity: ProjectAgentActivityTxMock
  projectAgentRun: ProjectAgentRunTxMock
  projectAgentWait: ProjectAgentWaitTxMock
  projectAgentInterruption: ProjectAgentInterruptionTxMock
}

const scope = {
  projectId: 'project-1',
  userId: 'user-1',
  assistantId: 'workspace-command' as const,
  episodeId: 'episode-1',
  scopeRef: 'episode:episode-1',
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
        operationId: 'generate_edit_screenplay',
        sourceOperationId: null,
        toolCallId: 'tool-1',
        choiceType: null,
      })),
      upsert: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectAgentRun: {
      upsert: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectAgentWait: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    projectAgentInterruption: {
      create: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  }
}

function asReducerTx(tx: ProjectAgentReducerTxMock): ReducerTx {
  return tx as unknown as ReducerTx
}

describe('project agent event reducer', () => {
  let tx: ProjectAgentReducerTxMock

  beforeEach(() => {
    tx = createTxMock()
  })

  it('projects activity.started into one open activity and run status', async () => {
    const activity = await reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'activity.started',
        runId: 'run-1',
        activityId: 'activity-1',
        type: 'operation',
        operationId: 'generate_edit_screenplay',
        toolCallId: 'tool-1',
      },
    })

    expect(tx.projectAgentActivity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        runId: 'run-1',
        status: { in: ['running', 'waiting'] },
      }),
    }))
    expect(tx.projectAgentActivity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        id: 'activity-1',
        runId: 'run-1',
        type: 'operation',
        status: 'running',
        operationId: 'generate_edit_screenplay',
      }),
    }))
    expect(tx.projectAgentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: 'running',
        stopReason: 'operation',
      }),
    }))
    expect(activity).toEqual(expect.objectContaining({
      activityId: 'activity-1',
      runId: 'run-1',
      type: 'operation',
      status: 'running',
      operationId: 'generate_edit_screenplay',
    }))
  })

  it('fails when a run already has an open activity', async () => {
    tx.projectAgentActivity.findFirst.mockResolvedValueOnce({
      id: 'activity-existing',
      type: 'waiting_task',
      status: 'waiting',
    })

    await expect(reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'activity.started',
        runId: 'run-1',
        activityId: 'activity-new',
        type: 'operation',
        operationId: 'generate_edit_screenplay',
      },
    })).rejects.toThrow(/PROJECT_AGENT_ACTIVITY_OVERLAP/)
  })
})
