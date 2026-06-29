import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { handleEditShotExecutionPlanGenerateTask } from '@/lib/workers/handlers/edit-script-structured-generate'
import { generateProjectEditShotExecutionPlan } from '@/lib/edit-script/service'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

vi.mock('@/lib/edit-script/service', () => ({
  generateProjectEditShotExecutionPlan: vi.fn(),
}))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(),
  reportTaskStreamChunk: vi.fn(),
}))

vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: vi.fn(),
}))

vi.mock('@/lib/task/service', () => ({
  isTaskActive: vi.fn(async () => true),
}))

function buildJob(payload: Record<string, unknown> | null = {
  episodeId: 'episode-1',
  editScriptId: 'script-1',
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'EditScript',
      targetId: 'script-1',
      payload,
      userId: 'user-1',
      trace: { requestId: 'request-1' },
    },
  } as Job<TaskJobData>
}

describe('handleEditShotExecutionPlanGenerateTask', () => {
  beforeEach(() => {
    vi.mocked(generateProjectEditShotExecutionPlan).mockReset()
    vi.mocked(reportTaskProgress).mockReset()
    vi.mocked(assertTaskActive).mockReset()
  })

  it('calls the shot execution plan service with task payload ids', async () => {
    vi.mocked(generateProjectEditShotExecutionPlan).mockResolvedValue({
      id: 'execution-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'script-1',
      status: 'ready',
      generationSegmentExecutions: [
        {
          shotNumbers: [1],
          motionFlow: 'single shot motion',
          cameraFlow: 'locked camera',
          blockingFlow: 'Anna and chair keep their positions',
          visibilityContinuity: 'Anna remains visible',
          soundFlow: 'quiet room tone',
          continuityLocks: ['same room', 'same axis'],
          continuousVideoPrompt: 'Continuous segment video prompt for Anna and the chair in the same room. [00:00-00:03] Shot 1 preserves the same chair axis and room tone.',
        },
      ],
      shots: [
        {
          shotNumber: 1,
          camera: {
            shotScale: 'medium',
            lens: '35mm',
            focus: 'chair',
            height: 'eye level',
            angle: 'frontal',
            movement: 'locked',
            composition: 'centered chair',
            lighting: 'top light',
          },
          blocking: {
            axis: {
              type: 'subject_line',
              subjects: ['Anna', 'Chair'],
              screenDirection: 'Anna left, chair center',
            },
            characters: [
              {
                name: 'Anna',
                visibility: 'visible',
                position: 'doorway',
                screenPosition: 'left',
                facing: 'chair',
                eyeline: 'chair',
              },
            ],
            objects: [
              {
                name: 'Chair',
                position: 'center',
                screenPosition: 'center',
              },
            ],
            spatialNote: 'same room',
          },
          videoPrompt: 'Single-shot video prompt for Anna: locked medium shot, centered chair, same room tone.',
        },
      ],
    })

    const result = await handleEditShotExecutionPlanGenerateTask(buildJob())

    expect(generateProjectEditShotExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      editScriptId: 'script-1',
      locale: 'zh',
    }))
    expect(result).toEqual({
      shotExecutionPlanId: 'execution-1',
      episodeId: 'episode-1',
      editScriptId: 'script-1',
      shotCount: 1,
    })
    expect(reportTaskProgress).toHaveBeenCalledWith(expect.any(Object), 12, expect.objectContaining({
      stage: 'edit_shot_execution_plan_prepare',
    }))
    expect(reportTaskProgress).toHaveBeenCalledWith(expect.any(Object), 96, expect.objectContaining({
      stage: 'edit_shot_execution_plan_persist',
    }))
  })

  it('fails explicitly when editScriptId is missing', async () => {
    const job = buildJob({ episodeId: 'episode-1' })
    job.data.targetId = ''

    await expect(handleEditShotExecutionPlanGenerateTask(job))
      .rejects.toThrow('editScriptId is required')
  })
})
