import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const serviceMock = vi.hoisted(() => ({
  generateProjectEditScript: vi.fn(async () => ({
    id: 'edit-script-1',
    chapterId: 'chapter-1',
    durationSec: 60,
    shotCount: 15,
    requirements: [{ id: 'asset-1' }],
    generationSegments: [{ shotIds: ['shot-1', 'shot-2', 'shot-3'], continuity: 'continuous approach' }],
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

import { handleEditScriptGenerateTask } from '@/lib/workers/handlers/edit-script-generate'

function buildJob(payload: Record<string, unknown>, episodeId: string | null = 'episode-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-edit-script-1',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId,
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
      payload,
      userId: 'user-1',
      trace: { requestId: 'request-1' },
    },
  } as unknown as Job<TaskJobData>
}

describe('worker edit-script-generate behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires episode explicitly', async () => {
    await expect(handleEditScriptGenerateTask(buildJob({}, null))).rejects.toThrow('episodeId is required')
  })

  it('requires ProjectEditChapter target explicitly', async () => {
    const job = buildJob({ episodeId: 'episode-1' })
    job.data.targetType = 'ProjectEpisode'
    job.data.targetId = 'episode-1'

    await expect(handleEditScriptGenerateTask(job)).rejects.toThrow('EDIT_SCRIPT_GENERATE_TARGET_CHAPTER_REQUIRED:ProjectEpisode')
  })

  it('runs edit script service and reports task progress', async () => {
    const result = await handleEditScriptGenerateTask(buildJob({
      episodeId: 'episode-1',
      videoRatio: '9:16',
    }))

    expect(serviceMock.generateProjectEditScript).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      locale: 'zh',
      videoRatio: '9:16',
      onGenerationStepPersisted: expect.any(Function),
    }))
    const serviceInput = (serviceMock.generateProjectEditScript.mock.calls[0] as unknown as readonly [Record<string, unknown>] | undefined)?.[0]
    expect(serviceInput).not.toEqual(expect.objectContaining({ bibleId: expect.anything() }))
    expect(serviceInput).not.toEqual(expect.objectContaining({ prompt: expect.anything() }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 12, expect.objectContaining({
      stage: 'edit_script_prepare',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 96, expect.objectContaining({
      stage: 'edit_script_persist',
    }))
    expect(streamMock.flush).toHaveBeenCalled()
    expect(result).toEqual({
      editScriptId: 'edit-script-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      durationSec: 60,
      shotCount: 15,
      requirementCount: 1,
      generationSegmentCount: 1,
    })
  })
})
