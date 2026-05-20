import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'

const taskServiceMock = vi.hoisted(() => ({
  rollbackTaskBillingForTask: vi.fn(async () => ({ attempted: false, rolledBack: true, billingInfo: null })),
  touchTaskHeartbeat: vi.fn(async () => true),
  tryMarkTaskCompleted: vi.fn(async () => true),
  tryMarkTaskFailed: vi.fn(async () => true),
  tryMarkTaskProcessing: vi.fn(async () => true),
  tryUpdateTaskProgress: vi.fn(async () => true),
  updateTaskBillingInfo: vi.fn(async () => undefined),
}))

const publisherMock = vi.hoisted(() => ({
  publishTaskEvent: vi.fn(async () => undefined),
  publishTaskStreamEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))
vi.mock('@/lib/task/service', () => taskServiceMock)
vi.mock('@/lib/task/publisher', () => publisherMock)
vi.mock('@/lib/billing', () => ({
  rollbackTaskBilling: vi.fn(async (_input) => ({ billable: false })),
  settleTaskBilling: vi.fn(async (_input) => ({ billable: false })),
}))
vi.mock('@/lib/billing/runtime-usage', () => ({
  withTextUsageCollection: vi.fn(async (_input, run: () => Promise<unknown>) => await run()),
}))
vi.mock('@/lib/logging/file-writer', () => ({
  onProjectNameAvailable: vi.fn(async () => undefined),
}))

function buildJob(payload: Record<string, unknown> | null): Job<TaskJobData> {
  return {
    queueName: 'waoowaoo-video',
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.VIDEO_GROUP,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload,
      userId: 'user-1',
      trace: { requestId: 'request-1' },
    },
  } as Job<TaskJobData>
}

describe('worker task progress locale metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskServiceMock.tryUpdateTaskProgress.mockResolvedValue(true)
  })

  it('preserves task locale in progress payloads so queued task recovery can re-enqueue them', async () => {
    await reportTaskProgress(buildJob({ flowId: 'single:video_group' }), 42, {
      stage: 'polling_external',
      meta: { source: 'worker-progress' },
    })

    expect(taskServiceMock.tryUpdateTaskProgress).toHaveBeenCalledWith(
      'task-1',
      42,
      expect.objectContaining({
        stage: 'polling_external',
        meta: {
          source: 'worker-progress',
          locale: 'zh',
        },
      }),
    )
  })
})
