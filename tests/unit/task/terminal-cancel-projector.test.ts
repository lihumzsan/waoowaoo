import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const state = vi.hoisted(() => ({ status: 'queued' }))
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [
    {
      id: 'task-1',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      targetType: 'ProjectEditStylePreview',
      targetId: 'preview-1',
      status: state.status,
      attempt: 1,
      payload: {},
      billingInfo: { billable: false },
      updatedAt: new Date('2026-07-11T00:00:00Z'),
    },
  ]),
  task: { updateMany: vi.fn(async () => ({ count: 1 })) },
  taskEvent: { create: vi.fn(async () => ({ id: 11 })) },
}))
const projector = vi.hoisted(() =>
  vi.fn(async (): Promise<'applied' | 'success_materialized'> => 'applied'),
)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => await run(tx)),
  },
}))
vi.mock('@/lib/billing', () => ({
  rollbackTaskBillingInTransaction: vi.fn(async () => ({ billable: false })),
  settleTaskBillingInTransaction: vi.fn(),
}))
vi.mock('@/lib/task/target-failure-sync', () => ({
  projectTaskTargetTerminalInTransaction: projector,
}))
vi.mock('@/lib/project-agent/waits', () => ({
  resolveProjectAgentWaitsForTaskTerminalInTransaction: vi.fn(async () => []),
}))
vi.mock('@/lib/outbox/repository', () => ({
  createOutboxCommandInTransaction: vi.fn(async () => ({ id: 'outbox-1' })),
}))

import { commitTaskTerminal } from '@/lib/task/terminal'

describe('Task terminal cancel projector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['queued', 'processing'])(
    'projects %s cancellation before committing the Task terminal row',
    async (status) => {
      state.status = status
      const result = await commitTaskTerminal({
        kind: 'canceled',
        taskId: 'task-1',
        fence: { kind: 'active' },
        source: 'user',
        reason: 'user canceled',
      })

      expect(projector).toHaveBeenCalledWith(tx, {
        kind: 'canceled',
        taskId: 'task-1',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: 'preview-1',
      })
      expect(projector.mock.invocationCallOrder[0]).toBeLessThan(
        tx.task.updateMany.mock.invocationCallOrder[0] ?? Infinity,
      )
      expect(tx.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'canceled' }),
        }),
      )
      expect(result).toMatchObject({ applied: true, status: 'canceled' })
    },
  )

  it('leaves Task and billing active when the same Task already materialized success', async () => {
    state.status = 'processing'
    projector.mockResolvedValueOnce('success_materialized')

    const result = await commitTaskTerminal({
      kind: 'canceled',
      taskId: 'task-1',
      fence: { kind: 'active' },
      source: 'user',
      reason: 'late cancel',
    })

    expect(result).toEqual({
      applied: false,
      reason: 'completion_pending',
      existingStatus: 'processing',
      terminalEventId: null,
      outboxCommandIds: [],
    })
    expect(tx.task.updateMany).not.toHaveBeenCalled()
    expect(tx.taskEvent.create).not.toHaveBeenCalled()
  })
})
