import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const serviceMock = vi.hoisted(() => ({
  generateProjectEditDirectorDecoupage: vi.fn(async () => ({
    id: 'director-decoupage-1',
    screenplayId: 'screenplay-1',
    shots: [
      {
        shotNumber: 1,
        durationSec: 3,
      },
    ],
  })),
  generateProjectEditCinematographyShotPlan: vi.fn(async () => ({
    id: 'cinematography-shot-plan-1',
    editScriptId: 'edit-script-1',
    shots: [
      {
        shotNumber: 1,
      },
      {
        shotNumber: 2,
      },
    ],
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
  handleEditCinematographyShotPlanGenerateTask,
  handleEditDirectorDecoupageGenerateTask,
} from '@/lib/workers/handlers/edit-script-structured-generate'

function buildJob(input: {
  readonly type: typeof TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE | typeof TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE
  readonly targetType: 'ProjectEditScreenplay' | 'ProjectEditScript'
  readonly targetId: string
  readonly payload?: Record<string, unknown>
  readonly episodeId?: string | null
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-structured-1',
      type: input.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: input.episodeId ?? 'episode-1',
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload ?? null,
      userId: 'user-1',
      trace: { requestId: 'request-1' },
    },
  } as unknown as Job<TaskJobData>
}

describe('worker edit-script structured generation behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates director decoupage from a ProjectEditScreenplay task target', async () => {
    const result = await handleEditDirectorDecoupageGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: 'screenplay-1',
      payload: { episodeId: 'episode-1' },
    }))

    expect(serviceMock.generateProjectEditDirectorDecoupage).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      locale: 'zh',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 12, expect.objectContaining({
      stage: 'edit_director_decoupage_prepare',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 96, expect.objectContaining({
      stage: 'edit_director_decoupage_persist',
    }))
    expect(streamMock.flush).toHaveBeenCalled()
    expect(result).toEqual({
      directorDecoupageId: 'director-decoupage-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      shotCount: 1,
    })
  })

  it('generates cinematography shot plan from a ProjectEditScript task target', async () => {
    const result = await handleEditCinematographyShotPlanGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: 'edit-script-1',
      payload: { episodeId: 'episode-1' },
    }))

    expect(serviceMock.generateProjectEditCinematographyShotPlan).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-script-1',
      locale: 'zh',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 12, expect.objectContaining({
      stage: 'edit_cinematography_shot_plan_prepare',
    }))
    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 96, expect.objectContaining({
      stage: 'edit_cinematography_shot_plan_persist',
    }))
    expect(streamMock.flush).toHaveBeenCalled()
    expect(result).toEqual({
      cinematographyShotPlanId: 'cinematography-shot-plan-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-script-1',
      shotCount: 2,
    })
  })

  it('fails explicitly when stable target ids are missing', async () => {
    await expect(handleEditDirectorDecoupageGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: '',
      payload: { episodeId: 'episode-1' },
    }))).rejects.toThrow('screenplayId is required')

    await expect(handleEditCinematographyShotPlanGenerateTask(buildJob({
      type: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: '',
      payload: { episodeId: 'episode-1' },
    }))).rejects.toThrow('editScriptId is required')
  })
})
