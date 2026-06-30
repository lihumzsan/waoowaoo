import type { Job } from 'bullmq'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import {
  handleModifyAppearanceTask,
  handleModifyLocationTask,
  handleModifyPropTask,
  type AnyObj,
} from './shot-ai-prompt'

export async function handleShotAITask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  switch (job.data.type) {
    case TASK_TYPE.AI_MODIFY_APPEARANCE:
      return await handleModifyAppearanceTask(job, payload)
    case TASK_TYPE.AI_MODIFY_LOCATION:
      return await handleModifyLocationTask(job, payload)
    case TASK_TYPE.AI_MODIFY_PROP:
      return await handleModifyPropTask(job, payload)
    default:
      throw new Error(`Unsupported shot AI task type: ${job.data.type}`)
  }
}
