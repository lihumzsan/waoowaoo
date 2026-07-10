import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type ChildTaskFixture = {
  readonly id: string
  readonly status: string
  readonly targetId: string
  readonly errorCode: string | null
  readonly errorMessage: string | null
}

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn<() => Promise<readonly ChildTaskFixture[]>>(),
  },
}))

const serviceMock = vi.hoisted(() => ({
  generateProjectEditStylePreviews: vi.fn(async () => ({
    success: true,
    async: true,
    projectId: 'project-1',
    episodeId: 'episode-1',
    bibleId: 'bible-1',
    status: 'queued',
    total: 2,
    taskIds: ['child-1', 'child-2'],
    results: [
      { refId: 'preview-1', taskId: 'child-1' },
      { refId: 'preview-2', taskId: 'child-2' },
    ],
    stylePreviews: [],
  })),
  markProjectEditStylePreviewGenerationFailed: vi.fn(async () => undefined),
}))

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
}))

const llmCallbacksMock = vi.hoisted(() => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'stream-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({ flush: vi.fn(async () => undefined) })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/edit-script/service', () => serviceMock)
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, run: () => Promise<unknown>) => await run()),
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => llmCallbacksMock)

import { handleEditStylePreviewsGenerateTask } from '@/lib/workers/handlers/edit-style-previews-generate'

function buildJob(payload: Record<string, unknown> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'parent-task-1',
      type: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      payload: {
        episodeId: 'episode-1',
        bibleId: 'bible-1',
        ...payload,
      },
      userId: 'user-1',
      operationId: 'generate_edit_style_previews',
      operationSource: 'assistant-panel',
      operationConfirmed: true,
      operationRequestId: 'request-1',
      trace: {
        requestId: 'request-1',
      },
    },
  } as unknown as Job<TaskJobData>
}

function childTask(input: {
  readonly id: string
  readonly status: string
  readonly targetId: string
  readonly errorMessage?: string | null
}): ChildTaskFixture {
  return {
    id: input.id,
    status: input.status,
    targetId: input.targetId,
    errorCode: null,
    errorMessage: input.errorMessage ?? null,
  }
}

describe('worker edit-style-previews-generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates style copy through the parent task and waits for child image tasks', async () => {
    prismaMock.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        childTask({ id: 'child-1', status: 'completed', targetId: 'preview-1' }),
        childTask({ id: 'child-2', status: 'failed', targetId: 'preview-2', errorMessage: 'provider failed' }),
      ])

    const result = await handleEditStylePreviewsGenerateTask(buildJob({
      styleDirection: '更黑暗一些',
      count: 2,
    }))

    expect(serviceMock.generateProjectEditStylePreviews).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      bibleId: 'bible-1',
      parentTaskId: 'parent-task-1',
      operationConfirmed: true,
      operationRequestId: 'request-1',
      styleDirection: '更黑暗一些',
      count: 2,
    }))
    expect(result).toEqual(expect.objectContaining({
      bibleId: 'bible-1',
      total: 2,
      completed: 1,
      failed: 1,
      taskIds: ['child-1', 'child-2'],
      previewIds: ['preview-1', 'preview-2'],
    }))
  })

  it('does not create child image tasks when the parent media operation was not approved', async () => {
    const job = buildJob()
    job.data.operationConfirmed = false

    await expect(handleEditStylePreviewsGenerateTask(job)).rejects.toThrow(
      'EDIT_STYLE_PREVIEW_BILLABLE_MEDIA_APPROVAL_REQUIRED',
    )
    expect(serviceMock.generateProjectEditStylePreviews).not.toHaveBeenCalled()
  })

  it('does not generate duplicate style copy when retrying a parent task that already has children', async () => {
    prismaMock.task.findMany
      .mockResolvedValueOnce([
        childTask({ id: 'child-1', status: 'completed', targetId: 'preview-1' }),
      ])
      .mockResolvedValueOnce([
        childTask({ id: 'child-1', status: 'completed', targetId: 'preview-1' }),
      ])

    const result = await handleEditStylePreviewsGenerateTask(buildJob())

    expect(serviceMock.generateProjectEditStylePreviews).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      total: 1,
      completed: 1,
      failed: 0,
      taskIds: ['child-1'],
    }))
  })

  it('fails the parent task when every child image task fails', async () => {
    prismaMock.task.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        childTask({ id: 'child-1', status: 'failed', targetId: 'preview-1', errorMessage: 'first failed' }),
        childTask({ id: 'child-2', status: 'failed', targetId: 'preview-2', errorMessage: 'second failed' }),
      ])

    await expect(handleEditStylePreviewsGenerateTask(buildJob())).rejects.toThrow(
      'EDIT_STYLE_PREVIEWS_ALL_IMAGES_FAILED:bible-1',
    )
    expect(serviceMock.markProjectEditStylePreviewGenerationFailed).toHaveBeenCalledWith({
      bibleId: 'bible-1',
      message: 'first failed',
    })
  })
})
