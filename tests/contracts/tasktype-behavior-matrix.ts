import { TASK_TYPE_CATALOG } from './task-type-catalog'
import type { TaskType } from '@/lib/task/types'

export type TaskTypeBehaviorMatrixEntry = {
  taskType: TaskType
  caseId: string
  workerTest: string
  chainTest: string
  apiContractTest: string
}

function resolveChainTestByTaskType(taskType: TaskType): string {
  if (taskType === 'video_panel' || taskType === 'video_group' || taskType === 'chapter_render') {
    return 'tests/integration/chain/video.chain.test.ts'
  }
  if (taskType === 'music_generate' || taskType === 'music_score_plan') {
    return 'tests/integration/chain/music.chain.test.ts'
  }
  if (
    taskType === 'edit_bible_generate'
    || taskType === 'edit_shot_execution_plan_generate'
    || taskType === 'ai_modify_appearance'
    || taskType === 'ai_modify_location'
    || taskType === 'ai_create_character'
    || taskType === 'ai_create_location'
    || taskType === 'reference_to_character'
    || taskType === 'asset_hub_ai_design_character'
    || taskType === 'asset_hub_ai_design_location'
    || taskType === 'asset_hub_ai_modify_character'
    || taskType === 'asset_hub_ai_modify_location'
    || taskType === 'asset_hub_reference_to_character'
  ) {
    return 'tests/integration/chain/text.chain.test.ts'
  }
  return 'tests/integration/chain/image.chain.test.ts'
}

function resolveApiContractByTaskType(taskType: TaskType): string {
  if (
    taskType === 'edit_bible_generate'
  ) {
    return 'tests/integration/api/contract/project-edit-bible.route.test.ts'
  }
  if (
    taskType === 'edit_shot_execution_plan_generate'
  ) {
    return 'tests/integration/api/contract/project-edit-script.route.test.ts'
  }
  if (
    taskType === 'ai_modify_appearance'
    || taskType === 'ai_modify_location'
    || taskType === 'ai_create_character'
    || taskType === 'ai_create_location'
    || taskType === 'reference_to_character'
    || taskType === 'asset_hub_ai_design_character'
    || taskType === 'asset_hub_ai_design_location'
    || taskType === 'asset_hub_ai_modify_character'
    || taskType === 'asset_hub_ai_modify_location'
    || taskType === 'asset_hub_reference_to_character'
  ) {
    return 'tests/integration/api/contract/llm-observe-routes.test.ts'
  }
  if (
    taskType === 'image_panel'
    || taskType === 'image_character'
    || taskType === 'image_location'
    || taskType === 'video_panel'
    || taskType === 'video_group'
    || taskType === 'music_generate'
    || taskType === 'music_score_plan'
    || taskType === 'modify_asset_image'
    || taskType === 'regenerate_group'
    || taskType === 'asset_hub_image'
    || taskType === 'asset_hub_modify'
  ) {
    return 'tests/integration/api/contract/direct-submit-media-routes.test.ts'
  }
  return 'tests/integration/api/contract/task-queue-routes.test.ts'
}

export const TASKTYPE_BEHAVIOR_MATRIX: ReadonlyArray<TaskTypeBehaviorMatrixEntry> = TASK_TYPE_CATALOG.map((entry) => ({
  taskType: entry.taskType,
  caseId: `TASKTYPE:${entry.taskType}`,
  workerTest: entry.owner,
  chainTest: resolveChainTestByTaskType(entry.taskType),
  apiContractTest: resolveApiContractByTaskType(entry.taskType),
}))

export const TASKTYPE_BEHAVIOR_COUNT = TASKTYPE_BEHAVIOR_MATRIX.length
