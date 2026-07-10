import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { handleAssetHubAIDesignTask } from './handlers/asset-hub-ai-design'
import { handleAssetHubAIModifyTask } from './handlers/asset-hub-ai-modify'
import { handleReferenceToCharacterTask } from './handlers/reference-to-character'
import { handleShotAITask } from './handlers/shot-ai-tasks'
import { handleEditScriptGenerateTask } from './handlers/edit-script-generate'
import { handleEditBibleGenerateTask } from './handlers/edit-bible-generate'
import {
  handleEditShotExecutionPlanGenerateTask,
} from './handlers/edit-script-structured-generate'
import {
  handleEditScriptStoryboardCameraPlanTask,
} from './handlers/edit-script-storyboard-consistency-task-handler'

async function processTextTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN:
      return await handleEditScriptStoryboardCameraPlanTask(job)
    case TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE:
    case TASK_TYPE.EDIT_BIBLE_GENERATE:
      return await handleEditBibleGenerateTask(job)
    case TASK_TYPE.EDIT_SCRIPT_GENERATE:
      return await handleEditScriptGenerateTask(job)
    case TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE:
      return await handleEditShotExecutionPlanGenerateTask(job)
    case TASK_TYPE.AI_CREATE_CHARACTER:
    case TASK_TYPE.AI_CREATE_LOCATION:
    case TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER:
    case TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION:
      return await handleAssetHubAIDesignTask(job)
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP:
      return await handleAssetHubAIModifyTask(job)
    case TASK_TYPE.AI_MODIFY_APPEARANCE:
    case TASK_TYPE.AI_MODIFY_LOCATION:
    case TASK_TYPE.AI_MODIFY_PROP:
      return await handleShotAITask(job)
    case TASK_TYPE.REFERENCE_TO_CHARACTER:
    case TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER:
      return await handleReferenceToCharacterTask(job)
    default:
      throw new Error(`Unsupported text task type: ${job.data.type}`)
  }
}

export function createTextWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.TEXT,
    async (job) => await withTaskLifecycle(job, processTextTask),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_TEXT || '10', 10) || 10,
    },
  )
}
