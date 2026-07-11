import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  taskExecutionCheckpoint: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  loadTaskHandlerCheckpoint,
  saveTaskHandlerCheckpoint,
} from '@/lib/task/execution-checkpoint'

const output = {
  result: { mediaId: 'media-1' },
  textUsage: [],
}

describe('Task handler checkpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.taskExecutionCheckpoint.create.mockResolvedValue({
      id: 'checkpoint-1',
      taskId: 'task-1',
      stepKey: '__handler_result__',
      inputFingerprint: 'fingerprint-1',
      state: 'ready',
      output,
    })
  })

  it('persists the handler result directly as the terminal-ready checkpoint', async () => {
    await expect(saveTaskHandlerCheckpoint({
      taskId: 'task-1',
      inputFingerprint: 'fingerprint-1',
      output,
    })).resolves.toEqual({
      id: 'checkpoint-1',
      state: 'ready',
      output,
    })
    expect(prismaMock.taskExecutionCheckpoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-1',
        stepKey: '__handler_result__',
        inputFingerprint: 'fingerprint-1',
        state: 'ready',
        output,
      }),
    })
  })

  it('rejects the removed materialization-only executed checkpoint state', async () => {
    prismaMock.taskExecutionCheckpoint.findUnique.mockResolvedValue({
      id: 'checkpoint-old',
      taskId: 'task-1',
      stepKey: '__handler_result__',
      inputFingerprint: 'fingerprint-1',
      state: 'executed',
      output,
    })

    await expect(loadTaskHandlerCheckpoint({
      taskId: 'task-1',
      inputFingerprint: 'fingerprint-1',
    })).rejects.toThrow('TASK_EXECUTION_CHECKPOINT_CONFLICT:task-1')
  })
})
