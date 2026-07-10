import { resolveTaskIntent, type TaskIntent } from '@/lib/task/intent'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { TASK_TYPE, type QueueType, type TaskType } from '@/lib/task/types'
import type { BehaviorScenario } from '../harness/behavior-scenario'

type TaskTypeContract = {
  readonly queue: QueueType
  readonly intent: TaskIntent
}

const TASK_TYPE_CONTRACTS = {
  [TASK_TYPE.IMAGE_PANEL]: { queue: 'image', intent: 'generate' },
  [TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE]: { queue: 'image', intent: 'generate' },
  [TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.IMAGE_CHARACTER]: { queue: 'image', intent: 'generate' },
  [TASK_TYPE.IMAGE_LOCATION]: { queue: 'image', intent: 'generate' },
  [TASK_TYPE.MUSIC_GENERATE]: { queue: 'music', intent: 'generate' },
  [TASK_TYPE.MUSIC_SCORE_PLAN]: { queue: 'music', intent: 'generate' },
  [TASK_TYPE.SOUNDSCAPE_PLAN]: { queue: 'music', intent: 'generate' },
  [TASK_TYPE.SOUNDSCAPE_GENERATE]: { queue: 'music', intent: 'generate' },
  [TASK_TYPE.FINAL_VIDEO_RENDER]: { queue: 'video', intent: 'process' },
  [TASK_TYPE.CHAPTER_RENDER]: { queue: 'video', intent: 'process' },
  [TASK_TYPE.VIDEO_PANEL]: { queue: 'video', intent: 'generate' },
  [TASK_TYPE.VIDEO_GROUP]: { queue: 'video', intent: 'generate' },
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: { queue: 'image', intent: 'modify' },
  [TASK_TYPE.REGENERATE_GROUP]: { queue: 'image', intent: 'regenerate' },
  [TASK_TYPE.ASSET_HUB_IMAGE]: { queue: 'image', intent: 'generate' },
  [TASK_TYPE.ASSET_HUB_MODIFY]: { queue: 'image', intent: 'modify' },
  [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.EDIT_BIBLE_GENERATE]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.EDIT_SCRIPT_GENERATE]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: { queue: 'text', intent: 'modify' },
  [TASK_TYPE.AI_MODIFY_LOCATION]: { queue: 'text', intent: 'modify' },
  [TASK_TYPE.AI_MODIFY_PROP]: { queue: 'text', intent: 'modify' },
  [TASK_TYPE.AI_CREATE_CHARACTER]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.AI_CREATE_LOCATION]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: { queue: 'text', intent: 'process' },
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION]: { queue: 'text', intent: 'generate' },
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER]: { queue: 'text', intent: 'modify' },
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION]: { queue: 'text', intent: 'modify' },
  [TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP]: { queue: 'text', intent: 'modify' },
  [TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER]: { queue: 'text', intent: 'process' },
} as const satisfies Record<TaskType, TaskTypeContract>

function assertTaskContract(taskType: TaskType, expected: TaskTypeContract): void {
  const actualQueue = getQueueTypeByTaskType(taskType)
  const actualIntent = resolveTaskIntent(taskType)
  if (actualQueue !== expected.queue || actualIntent !== expected.intent) {
    throw new Error(
      `Task contract mismatch for ${taskType}: expected ${JSON.stringify(expected)}, `
      + `received ${JSON.stringify({ queue: actualQueue, intent: actualIntent })}`,
    )
  }
}

export const TASKTYPE_SCENARIO_REGISTRY: readonly BehaviorScenario<TaskType>[] =
  (Object.values(TASK_TYPE) as TaskType[]).map((taskType) => {
    const scenarioId = `TASKTYPE:${taskType}`
    return {
      id: scenarioId,
      identity: taskType,
      severity: 'P1',
      invariantIds: ['TG-03'],
      historicalDefectIds: [],
      layers: ['contract'],
      async execute(context) {
        assertTaskContract(taskType, TASK_TYPE_CONTRACTS[taskType])
        context.recordExecution(scenarioId)
      },
    }
  })
