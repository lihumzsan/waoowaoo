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
        operationId: 'ingest_script',
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
        operationId: 'ingest_script',
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
        operationId: 'ingest_script',
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
      operationId: 'ingest_script',
    }))
  })

  it('moves an await-user-choice run to awaiting_choice when its task wait completes', async () => {
    tx.projectAgentWait.findUnique.mockResolvedValueOnce({
      id: 'wait-style-1',
      runId: 'run-style-1',
      operationId: 'generate_edit_style_previews',
      followUpMode: 'await_user_choice',
    })

    await reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'task.terminal',
        runId: 'run-style-1',
        activityId: 'activity-wait-style-1',
        waitId: 'wait-style-1',
        terminalStatus: 'completed',
        terminalTaskIds: ['task-style-1'],
        failedTaskIds: [],
        nextActivityId: 'activity-choice-style-1',
      },
    })

    expect(tx.projectAgentActivity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'activity-choice-style-1' },
      create: expect.objectContaining({
        runId: 'run-style-1',
        type: 'awaiting_choice',
        sourceOperationId: 'generate_edit_style_previews',
        choiceType: 'style',
      }),
    }))
    expect(tx.projectAgentRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-style-1' },
      data: expect.objectContaining({
        status: 'awaiting_choice',
        stopReason: 'awaiting_choice',
      }),
    })
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
        operationId: 'ingest_script',
      },
    })).rejects.toThrow(/PROJECT_AGENT_ACTIVITY_OVERLAP/)
  })

  it('creates awaiting choice activity before interruption details to satisfy the activity foreign key', async () => {
    await reduceProjectAgentEvent({
      tx: asReducerTx(tx),
      scope,
      event: {
        kind: 'interruption.raised',
        runId: 'run-1',
        activityId: 'activity-choice-1',
        interruptionId: 'interruption-1',
        interruptionKind: 'choice',
        operationId: 'request_edit_bible_review_choice',
        approvalId: 'choice:approval-1',
        toolCallId: 'tool-choice-1',
        choiceType: 'bible_review',
        payload: {
          choiceType: 'bible_review',
          cardId: 'edit-first-duration-aspect-ratio',
        },
        runState: null,
      },
    })

    expect(tx.projectAgentActivity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        id: 'activity-choice-1',
        runId: 'run-1',
        type: 'awaiting_choice',
        status: 'waiting',
        operationId: 'request_edit_bible_review_choice',
        choiceType: 'bible_review',
      }),
    }))
    expect(tx.projectAgentInterruption.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: 'interruption-1',
        runId: 'run-1',
        activityId: 'activity-choice-1',
        type: 'choice',
        status: 'pending',
        operationId: 'request_edit_bible_review_choice',
      }),
    }))
    const activityWriteOrder = tx.projectAgentActivity.upsert.mock.invocationCallOrder[0]
    const interruptionWriteOrder = tx.projectAgentInterruption.create.mock.invocationCallOrder[0]
    expect(activityWriteOrder).toBeLessThan(interruptionWriteOrder)
  })
})
