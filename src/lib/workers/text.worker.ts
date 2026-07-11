import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { getTaskDefinitionForQueue, type TextTaskHandlerKey } from '@/lib/task/definition'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { getWorkerConcurrency } from './runtime-config'
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

type TextTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const TEXT_TASK_HANDLERS = {
  edit_script_camera_plan: handleEditScriptStoryboardCameraPlanTask,
  edit_bible_generate: handleEditBibleGenerateTask,
  edit_script_generate: handleEditScriptGenerateTask,
  edit_shot_execution_plan_generate: handleEditShotExecutionPlanGenerateTask,
  asset_hub_ai_design: handleAssetHubAIDesignTask,
  asset_hub_ai_modify: handleAssetHubAIModifyTask,
  shot_ai: handleShotAITask,
  reference_to_character: handleReferenceToCharacterTask,
} satisfies Record<TextTaskHandlerKey, TextTaskHandler>

async function processTextTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  const definition = getTaskDefinitionForQueue(job.data.type, 'text')
  return await TEXT_TASK_HANDLERS[definition.workerHandler](job)
}

export function createTextWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.TEXT,
    async (job) => await withTaskLifecycle(job, processTextTask),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('text'),
    },
  )
}
