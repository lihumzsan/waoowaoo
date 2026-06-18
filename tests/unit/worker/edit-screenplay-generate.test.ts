import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const serviceMock = vi.hoisted(() => ({
  generateProjectEditScreenplay: vi.fn(async () => ({
    id: 'screenplay-1',
    episodeId: 'episode-1',
    status: 'screenplay_ready',
    screenplayText: '标题：《轨道低语》\n\n故事梗概：空间站收到一条陌生信号。',
  })),
  reviseProjectEditScreenplay: vi.fn(async () => ({
    id: 'screenplay-1',
    episodeId: 'episode-1',
    status: 'screenplay_ready',
    screenplayText: '标题：《轨道低语》\n\n故事梗概：空间站收到一条更黑暗的陌生信号。',
  })),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const streamMock = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
}))

vi.mock('@/lib/edit-script/service', () => serviceMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => streamMock),
}))

import {
  handleEditScreenplayGenerateTask,
  handleEditScreenplayReviseTask,
} from '@/lib/workers/handlers/edit-screenplay-generate'

function buildJob(input: {
  readonly type: typeof TASK_TYPE.EDIT_SCREENPLAY_GENERATE | typeof TASK_TYPE.EDIT_SCREENPLAY_REVISE
  readonly targetId?: string
  readonly payload?: Record<string, unknown>
  readonly episodeId?: string | null
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-screenplay-1',
      type: input.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: input.episodeId ?? 'episode-1',
      targetType: 'ProjectEditScreenplay',
      targetId: input.targetId ?? 'screenplay-1',
      payload: input.payload ?? null,
      userId: 'user-1',
      trace: { requestId: 'request-1' },
    },
  } as unknown as Job<TaskJobData>
}

describe('worker edit-screenplay generation behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates screenplay text through the stable ProjectEditScreenplay task target', async () => {
    const result = await handleEditScreenplayGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      payload: {
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        prompt: '生成一部恐怖短片',
        durationTier: 'short',
        aspectRatio: '16:9',
      },
    }))

    expect(serviceMock.generateProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      prompt: '生成一部恐怖短片',
      durationTier: 'short',
      aspectRatio: '16:9',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 12, expect.objectContaining({
      stage: 'edit_screenplay_prepare',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 96, expect.objectContaining({
      stage: 'edit_screenplay_persist',
    }))
    expect(streamMock.flush).toHaveBeenCalled()
    expect(result).toEqual({
      screenplayId: 'screenplay-1',
      episodeId: 'episode-1',
      status: 'screenplay_ready',
      screenplayTextLength: 28,
    })
  })

  it('revises screenplay text through the same ProjectEditScreenplay task target', async () => {
    const result = await handleEditScreenplayReviseTask(buildJob({
      type: TASK_TYPE.EDIT_SCREENPLAY_REVISE,
      payload: {
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        revisionInstruction: '更黑暗一些',
        durationTier: 'short',
        aspectRatio: '16:9',
      },
    }))

    expect(serviceMock.reviseProjectEditScreenplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
      revisionInstruction: '更黑暗一些',
      durationTier: 'short',
      aspectRatio: '16:9',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 12, expect.objectContaining({
      stage: 'edit_screenplay_revision_prepare',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 96, expect.objectContaining({
      stage: 'edit_screenplay_revision_persist',
    }))
    expect(streamMock.flush).toHaveBeenCalled()
    expect(result).toEqual({
      screenplayId: 'screenplay-1',
      episodeId: 'episode-1',
      status: 'screenplay_ready',
      screenplayTextLength: 32,
    })
  })

  it('fails explicitly when required generation payload fields are missing', async () => {
    await expect(handleEditScreenplayGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      targetId: '',
      payload: {
        episodeId: 'episode-1',
        prompt: '生成一部恐怖短片',
        durationTier: 'short',
        aspectRatio: '16:9',
      },
    }))).rejects.toThrow('screenplayId is required')

    await expect(handleEditScreenplayGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      payload: {
        episodeId: 'episode-1',
        screenplayId: 'screenplay-1',
        durationTier: 'short',
        aspectRatio: '16:9',
      },
    }))).rejects.toThrow('prompt is required')
  })
})
