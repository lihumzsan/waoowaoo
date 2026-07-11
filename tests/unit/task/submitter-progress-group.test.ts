import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => loggerMock),
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (run: (tx: object) => Promise<unknown>) => await run({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const transactionCreateMock = vi.hoisted(() => ({
  persistSubmittedTaskBatchInTransaction: vi.fn(async (params: {
    inputs: Array<{ priority?: number | null }>
  }) => [{
    task: {
      id: 'task-1',
      status: 'queued',
      priority: params.inputs[0]?.priority ?? 0,
      billingInfo: null,
    },
    deduped: false,
  }]),
}))

vi.mock('@/lib/task/transactional-create', () => transactionCreateMock)

const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(() => null as import('@/lib/task/types').TaskBillingInfo | null),
  getBillingMode: vi.fn(async () => 'OFF'),
  InsufficientBalanceError: class InsufficientBalanceError extends Error {
    readonly required = 0
    readonly available = 0
  },
  isBillableTaskType: vi.fn(() => false),
}))

vi.mock('@/lib/billing', () => billingMock)

describe('submitTask progress group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue(null)
    billingMock.isBillableTaskType.mockReturnValue(false)
  })

  it('adds one operation progress group to the atomic Task submission input', async () => {
    await submitTask({
      userId: 'user-1',
      locale: 'zh',
      requestId: 'request-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      payload: {
        prompt: 'wide shot',
        ui: {
          intent: 'generate',
          hasOutputAtStart: false,
        },
      },
      operationId: 'generate_edit_script_storyboard_images',
      operationSource: 'project-ui',
    })

    const expectedProgressGroupId = 'operation:generate_edit_script_storyboard_images:request-1'

    expect(transactionCreateMock.persistSubmittedTaskBatchInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      inputs: [expect.objectContaining({
        operationId: 'generate_edit_script_storyboard_images',
        operationRequestId: 'request-1',
        payload: expect.objectContaining({
          ui: {
            intent: 'generate',
            hasOutputAtStart: false,
            progressGroupId: expectedProgressGroupId,
          },
        }),
      })],
    }))
  })

  it('rejects an unapproved sound_effect task before creating a task record or queue job', async () => {
    billingMock.isBillableTaskType.mockReturnValue(true)
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue({
      billable: true,
      source: 'task',
      taskType: TASK_TYPE.SOUNDSCAPE_GENERATE,
      apiType: 'sound_effect',
      model: 'elevenlabs::eleven_text_to_sound_v2',
      quantity: 2,
      unit: 'call',
      maxFrozenCost: 4,
      action: TASK_TYPE.SOUNDSCAPE_GENERATE,
      status: 'quoted',
    })

    await expect(submitTask({
      userId: 'user-1',
      locale: 'zh',
      requestId: 'request-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.SOUNDSCAPE_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      payload: {
        soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
        durationSeconds: 30,
        sourceCount: 2,
      },
      operationId: 'generate_episode_soundscape',
      operationSource: 'worker',
    })).rejects.toMatchObject({
      message: expect.stringContaining('must be created by the approved operation plan authority'),
    })

    expect(transactionCreateMock.persistSubmittedTaskBatchInTransaction).not.toHaveBeenCalled()
  })
})
