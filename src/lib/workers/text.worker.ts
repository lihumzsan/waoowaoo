import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { getTaskDefinitionForQueue, type TextTaskHandlerKey } from '@/lib/task/definition'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { getWorkerConcurrency } from './runtime-config'
import { handleCreativeWorkTask } from './handlers/creative-work'

type TextTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const TEXT_TASK_HANDLERS = {
  creative_work: handleCreativeWorkTask,
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
