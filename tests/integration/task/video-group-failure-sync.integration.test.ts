import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { createTask, sweepStaleTasks } from '@/lib/task/service'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'

const reconcileMock = vi.hoisted(() => ({
  isJobAlive: vi.fn(async () => true),
}))

vi.mock('@/lib/task/reconcile', () => reconcileMock)

async function createProcessingVideoGroup() {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const episode = await prisma.projectEpisode.create({
    data: {
      projectId: project.id,
      episodeNumber: 1,
      name: 'Episode 1',
    },
  })
  const chapter = await prisma.projectEditChapter.create({
    data: {
      episodeId: episode.id,
      chapterIndex: 0,
    },
  })
  const group = await prisma.projectVideoGroup.create({
    data: {
      projectId: project.id,
      episodeId: episode.id,
      chapterId: chapter.id,
      gridMode: '2x2',
      shotIds: ['shot-1', 'shot-2'],
      durationSec: 6,
      status: 'processing',
    },
  })
  return { user, project, episode, group }
}

describe('video group task failure sync', () => {
  beforeEach(async () => {
    await resetBillingState()
    vi.clearAllMocks()
    reconcileMock.isJobAlive.mockResolvedValue(true)
  })

  it('marks video group failed when replacing a locale-less active group task', async () => {
    const { user, project, episode, group } = await createProcessingVideoGroup()
    const existing = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.VIDEO_GROUP,
        targetType: 'ProjectVideoGroup',
        targetId: group.id,
        status: TASK_STATUS.QUEUED,
        payload: {
          groupId: group.id,
        },
        dedupeKey: `video_group:${group.id}`,
        queuedAt: new Date(),
      },
    })

    const result = await createTask({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: group.id,
      payload: {
        groupId: group.id,
        meta: { locale: 'zh' },
      },
      dedupeKey: `video_group:${group.id}`,
    })

    expect(result.deduped).toBe(false)
    expect(result.task.id).not.toBe(existing.id)

    const failedExisting = await prisma.task.findUnique({ where: { id: existing.id } })
    expect(failedExisting).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_LOCALE_REQUIRED',
      dedupeKey: null,
    })

    const failedGroup = await prisma.projectVideoGroup.findUnique({ where: { id: group.id } })
    expect(failedGroup).toMatchObject({
      status: 'failed',
      taskId: null,
      errorCode: 'TASK_LOCALE_REQUIRED',
      errorMessage: 'task locale is missing',
    })
  })

  it('marks video group failed when replacing an orphaned active group task', async () => {
    const { user, project, episode, group } = await createProcessingVideoGroup()
    const existing = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.VIDEO_GROUP,
        targetType: 'ProjectVideoGroup',
        targetId: group.id,
        status: TASK_STATUS.QUEUED,
        payload: {
          groupId: group.id,
          meta: { locale: 'zh' },
        },
        dedupeKey: `video_group:${group.id}`,
        queuedAt: new Date(),
      },
    })
    reconcileMock.isJobAlive.mockResolvedValue(false)

    const result = await createTask({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: group.id,
      payload: {
        groupId: group.id,
        meta: { locale: 'zh' },
      },
      dedupeKey: `video_group:${group.id}`,
    })

    expect(result.deduped).toBe(false)
    expect(result.task.id).not.toBe(existing.id)

    const failedExisting = await prisma.task.findUnique({ where: { id: existing.id } })
    expect(failedExisting).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'RECONCILE_ORPHAN',
      dedupeKey: null,
    })

    const failedGroup = await prisma.projectVideoGroup.findUnique({ where: { id: group.id } })
    expect(failedGroup).toMatchObject({
      status: 'failed',
      taskId: null,
      errorCode: 'RECONCILE_ORPHAN',
      errorMessage: 'Queue job lost, replaced by new task',
    })
  })

  it('marks video group failed when watchdog times out a processing group task', async () => {
    const { user, project, episode, group } = await createProcessingVideoGroup()
    const staleHeartbeat = new Date(Date.now() - 60_000)
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.VIDEO_GROUP,
        targetType: 'ProjectVideoGroup',
        targetId: group.id,
        status: TASK_STATUS.PROCESSING,
        payload: {
          groupId: group.id,
          meta: { locale: 'zh' },
        },
        queuedAt: staleHeartbeat,
        startedAt: staleHeartbeat,
        heartbeatAt: staleHeartbeat,
      },
    })

    const timedOut = await sweepStaleTasks({
      processingThresholdMs: 1_000,
    })

    expect(timedOut.map((item) => item.id)).toContain(task.id)

    const failedTask = await prisma.task.findUnique({ where: { id: task.id } })
    expect(failedTask).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'WATCHDOG_TIMEOUT',
      errorMessage: 'Task heartbeat timeout',
    })

    const failedGroup = await prisma.projectVideoGroup.findUnique({ where: { id: group.id } })
    expect(failedGroup).toMatchObject({
      status: 'failed',
      taskId: null,
      errorCode: 'WATCHDOG_TIMEOUT',
      errorMessage: 'Task heartbeat timeout',
    })
  })
})
