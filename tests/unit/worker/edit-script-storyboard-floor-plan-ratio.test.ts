import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-floor-plan-1',
      type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectStoryboard',
      targetId: 'storyboard-1',
      payload: {
        storyboardId: 'storyboard-1',
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('edit script storyboard floor plan task', () => {
  it('fails explicitly because grid coordinate floor plans are disabled', async () => {
    const { handleEditScriptStoryboardFloorPlanImageTask } = await import(
      '@/lib/workers/handlers/edit-script-storyboard-consistency-task-handler'
    )

    await expect(handleEditScriptStoryboardFloorPlanImageTask(buildJob())).rejects.toThrow(
      'EDIT_SCRIPT_STORYBOARD_GRID_COORDINATES_DISABLED',
    )
  })
})
