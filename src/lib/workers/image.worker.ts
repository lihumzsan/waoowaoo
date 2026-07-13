import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { getTaskDefinitionForQueue, type ImageTaskHandlerKey } from '@/lib/task/definition'
import type { TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import { getWorkerConcurrency } from './runtime-config'
import {
  handleAssetHubImageTask,
  handleAssetHubModifyTask,
  handleEditStylePreviewImageTask,
  handleCharacterImageTask,
  handleLocationImageTask,
  handleModifyAssetImageTask,
  handlePanelImageTask,
} from './handlers/image-task-handlers'

type AnyObj = Record<string, unknown>
type ImageTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

async function handleRegenerateGroupTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  return payload.type === 'character'
    ? await handleCharacterImageTask(job)
    : await handleLocationImageTask(job)
}

const IMAGE_TASK_HANDLERS = {
  image_character: handleCharacterImageTask,
  edit_style_preview: handleEditStylePreviewImageTask,
  image_location: handleLocationImageTask,
  regenerate_group: handleRegenerateGroupTask,
  modify_asset_image: handleModifyAssetImageTask,
  asset_hub_image: handleAssetHubImageTask,
  asset_hub_modify: handleAssetHubModifyTask,
  image_panel: handlePanelImageTask,
} satisfies Record<ImageTaskHandlerKey, ImageTaskHandler>

async function processImageTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  const definition = getTaskDefinitionForQueue(job.data.type, 'image')
  return await IMAGE_TASK_HANDLERS[definition.workerHandler](job)
}

export function createImageWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.IMAGE,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'image',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.image,
        run: async () => await processImageTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('image'),
    },
  )
}
