import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { createTask, tryUpdateTaskProgress } from '@/lib/task/service'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'

const reconcileMock = vi.hoisted(() => ({
  observeTaskJob: vi.fn(async (): Promise<'alive' | 'terminal' | 'absent' | 'unavailable'> => 'alive'),
}))

vi.mock('@/lib/task/reconcile', () => reconcileMock)

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

describe('task service dedupe + orphan recovery', () => {
  beforeEach(async () => {
    await resetBillingState()
    vi.clearAllMocks()
    reconcileMock.observeTaskJob.mockResolvedValue('alive')
  })

  it('dedupes to an active task when dedupeKey matches and queue job is alive', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const existing = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: project.id,
        status: TASK_STATUS.QUEUED,
        payload: {
          musicModel: 'google::lyria-3-pro-preview',
          durationSeconds: 10,
          meta: { locale: 'zh' },
        },
        dedupeKey: `music_generate:${project.id}`,
        queuedAt: new Date(),
      },
    })

    const result = await createTask({
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: project.id,
      payload: {
        musicModel: 'google::lyria-3-pro-preview',
        durationSeconds: 10,
        meta: { locale: 'zh' },
      },
      dedupeKey: `music_generate:${project.id}`,
    })

    expect(result.deduped).toBe(true)
    expect(result.task.id).toBe(existing.id)
    expect(reconcileMock.observeTaskJob).toHaveBeenCalledWith(existing.id)
  })

  it('fails orphaned active task and creates a replacement when queue job is missing', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const existing = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.VIDEO_PANEL,
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        status: TASK_STATUS.QUEUED,
        payload: {
          storyboardId: 'storyboard-1',
          panelIndex: 1,
          meta: { locale: 'zh' },
        },
        dedupeKey: 'video_panel:panel-1',
        queuedAt: new Date(),
      },
    })
    reconcileMock.observeTaskJob.mockResolvedValue('absent')

    const result = await createTask({
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.VIDEO_PANEL,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      payload: {
        storyboardId: 'storyboard-1',
        panelIndex: 1,
        meta: { locale: 'zh' },
      },
      dedupeKey: 'video_panel:panel-1',
    })

    expect(result.deduped).toBe(false)
    expect(result.task.id).not.toBe(existing.id)

    const failedExisting = await prisma.task.findUnique({ where: { id: existing.id } })
    expect(failedExisting).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'RECONCILE_ORPHAN',
      dedupeKey: null,
    })
  })

  it('keeps the authoritative active task unchanged when Redis observation is unavailable', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const dedupeKey = `music_generate:${project.id}:redis-unavailable`
    const billingInfo = {
      billable: true as const,
      source: 'task' as const,
      taskType: TASK_TYPE.MUSIC_GENERATE,
      apiType: 'music' as const,
      model: 'google::lyria-3-pro-preview',
      quantity: 1,
      unit: 'call' as const,
      maxFrozenCost: 1,
      action: 'generate_music',
      status: 'frozen' as const,
      freezeId: 'freeze-redis-unavailable',
    }
    const existing = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: project.id,
        status: TASK_STATUS.QUEUED,
        payload: {
          musicModel: 'google::lyria-3-pro-preview',
          durationSeconds: 10,
          meta: { locale: 'zh' },
        },
        billingInfo,
        dedupeKey,
        queuedAt: new Date(),
      },
    })
    reconcileMock.observeTaskJob.mockResolvedValue('unavailable')

    const result = await createTask({
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: project.id,
      payload: {
        musicModel: 'google::lyria-3-pro-preview',
        durationSeconds: 10,
        meta: { locale: 'zh' },
      },
      dedupeKey,
    })

    const tasks = await prisma.task.findMany({ where: { dedupeKey } })
    expect(result).toMatchObject({ deduped: true, task: { id: existing.id } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: existing.id,
      status: TASK_STATUS.QUEUED,
      dedupeKey,
      billingInfo,
      errorCode: null,
    })
  })

  it('fails locale-less active task and replaces it instead of deduping forever', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const existing = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: project.id,
        status: TASK_STATUS.QUEUED,
        payload: {
          musicModel: 'google::lyria-3-pro-preview',
          durationSeconds: 10,
        },
        dedupeKey: 'music_generate:locale-replacement',
        queuedAt: new Date(),
      },
    })

    const result = await createTask({
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: project.id,
      payload: {
        musicModel: 'google::lyria-3-pro-preview',
        durationSeconds: 10,
        meta: { locale: 'zh' },
      },
      dedupeKey: 'music_generate:locale-replacement',
    })

    expect(result.deduped).toBe(false)
    expect(result.task.id).not.toBe(existing.id)

    const failedExisting = await prisma.task.findUnique({ where: { id: existing.id } })
    expect(failedExisting).toMatchObject({
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_LOCALE_REQUIRED',
      dedupeKey: null,
    })
  })

  it('progress updates preserve single panel image payload for queue recovery', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        status: TASK_STATUS.PROCESSING,
        progress: 5,
        payload: {
          panelId: 'panel-1',
          imageModel: 'fal::image-model',
          referenceMode: 'asset',
          meta: {
            locale: 'zh',
            flowId: 'single:image_panel',
          },
          ui: {
            intent: 'generate',
            hasOutputAtStart: true,
          },
        },
        queuedAt: new Date(),
        startedAt: new Date(),
      },
    })

    const updated = await tryUpdateTaskProgress(task.id, 18, {
      stage: 'generate_panel_image',
      meta: {
        locale: 'zh',
      },
    })

    expect(updated).toBe(true)
    const stored = await prisma.task.findUnique({
      where: { id: task.id },
      select: { payload: true, progress: true },
    })
    const payload = asRecord(stored?.payload)
    const meta = asRecord(payload.meta)
    const ui = asRecord(payload.ui)

    expect(stored?.progress).toBe(18)
    expect(payload.stage).toBe('generate_panel_image')
    expect(payload.imageModel).toBe('fal::image-model')
    expect(payload.referenceMode).toBe('asset')
    expect(meta).toEqual({
      locale: 'zh',
      flowId: 'single:image_panel',
    })
    expect(ui).toEqual({
      intent: 'generate',
      hasOutputAtStart: true,
    })
  })

})
