import { Worker, type Job } from 'bullmq'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { queueRedis } from '@/lib/redis'
import { getTaskDefinitionForQueue, type VideoTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import type { TaskJobData } from '@/lib/task/types'
import { handleCreativeResourceVideoMergeTask } from './handlers/creative-resource-video-merge'
import { handleCreativeResourceVideoTask } from './handlers/creative-resource-video'
import { getWorkerConcurrency } from './runtime-config'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'

type VideoTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const VIDEO_TASK_HANDLERS = {
  creative_resource_video: handleCreativeResourceVideoTask,
  creative_resource_video_merge: handleCreativeResourceVideoMergeTask,
} satisfies Record<VideoTaskHandlerKey, VideoTaskHandler>

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })
  const definition = getTaskDefinitionForQueue(job.data.type, 'video')
  return await VIDEO_TASK_HANDLERS[definition.workerHandler](job)
}

export function createVideoWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'video',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.video,
        run: async () => await processVideoTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('video'),
    },
  )
}
