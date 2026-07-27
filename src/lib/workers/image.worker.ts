import { Worker, type Job } from 'bullmq'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { queueRedis } from '@/lib/redis'
import { getTaskDefinitionForQueue, type ImageTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import { handleCreativeResourceImageTask } from './handlers/creative-resource-image'
import { handleCreativeResourceWebReferenceTask } from './handlers/creative-resource-web-reference'
import { getWorkerConcurrency } from './runtime-config'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'

type ImageTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const IMAGE_TASK_HANDLERS = {
  creative_resource_image: handleCreativeResourceImageTask,
  creative_resource_web_reference: handleCreativeResourceWebReferenceTask,
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
