import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTask } from '@/lib/task/submitter'
import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => loggerMock),
}))

const queueMock = vi.hoisted(() => ({
  addTaskJob: vi.fn(async () => undefined),
}))

vi.mock('@/lib/task/queues', () => queueMock)

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(async () => undefined),
  listRecentTerminalLifecycleEvents: vi.fn(async () => []),
}))

vi.mock('@/lib/task/publisher', () => publisherMock)

const serviceMock = vi.hoisted(() => ({
  createTask: vi.fn(async (input: { priority?: number | null; payload: Record<string, unknown> }) => ({
    task: {
      id: 'task-1',
      status: 'queued',
      priority: input.priority ?? 0,
      billingInfo: null,
    },
    deduped: false,
  })),
  markTaskEnqueueFailed: vi.fn(async () => undefined),
  markTaskEnqueued: vi.fn(async () => undefined),
  markTaskFailed: vi.fn(async () => undefined),
  rollbackTaskBillingForTask: vi.fn(async () => ({ attempted: false, rolledBack: false })),
  updateTaskBillingInfo: vi.fn(async () => undefined),
}))

vi.mock('@/lib/task/service', () => serviceMock)

const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(() => null as import('@/lib/task/types').TaskBillingInfo | null),
  getBillingMode: vi.fn(async () => 'OFF'),
  InsufficientBalanceError: class InsufficientBalanceError extends Error {
    readonly required = 0
    readonly available = 0
  },
  isBillableTaskType: vi.fn(() => false),
  prepareTaskBilling: vi.fn(async () => null),
}))

vi.mock('@/lib/billing', () => billingMock)

describe('submitTask progress group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingMock.buildDefaultTaskBillingInfo.mockReturnValue(null)
    billingMock.isBillableTaskType.mockReturnValue(false)
  })

  it('adds one operation progress group to persisted task, created event, and queued job payloads', async () => {
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
      operationConfirmed: true,
    })

    const expectedProgressGroupId = 'operation:generate_edit_script_storyboard_images:request-1'

    expect(serviceMock.createTask).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      operationRequestId: 'request-1',
      payload: expect.objectContaining({
        ui: {
          intent: 'generate',
          hasOutputAtStart: false,
          progressGroupId: expectedProgressGroupId,
        },
      }),
    }))
    expect(publisherMock.publishTaskEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_EVENT_TYPE.CREATED,
      payload: expect.objectContaining({
        ui: {
          intent: 'generate',
          hasOutputAtStart: false,
          progressGroupId: expectedProgressGroupId,
        },
      }),
    }))
    expect(queueMock.addTaskJob).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      operationSource: 'project-ui',
      operationConfirmed: true,
      operationRequestId: 'request-1',
      payload: expect.objectContaining({
        ui: {
          intent: 'generate',
          hasOutputAtStart: false,
          progressGroupId: expectedProgressGroupId,
        },
      }),
    }), { priority: 0 })
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
      operationConfirmed: false,
    })).rejects.toMatchObject({
      message: expect.stringContaining('billable media approval is required'),
    })

    expect(serviceMock.createTask).not.toHaveBeenCalled()
    expect(queueMock.addTaskJob).not.toHaveBeenCalled()
  })
})
