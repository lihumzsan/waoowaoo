import { prisma } from '@/lib/prisma'
import { addTaskJob } from './queues'
import { buildTaskJobEnvelope } from './job-envelope'
import { markTaskEnqueued } from './service'
import { TASK_STATUS } from './types'

export async function enqueuePersistedApprovedTask(params: {
  taskId: string
  operationExecutionId: string
}): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: params.taskId } })
  if (!task) throw new Error(`TASK_ENQUEUE_TASK_NOT_FOUND:${params.taskId}`)
  if (task.operationExecutionId !== params.operationExecutionId) {
    throw new Error(`TASK_ENQUEUE_EXECUTION_MISMATCH:${params.taskId}:${params.operationExecutionId}`)
  }
  const execution = await prisma.operationExecution.findUnique({
    where: { id: params.operationExecutionId },
    select: { status: true },
  })
  if (!execution) throw new Error(`TASK_ENQUEUE_EXECUTION_NOT_FOUND:${params.operationExecutionId}`)
  if (execution.status !== 'completed') {
    throw new Error(`TASK_ENQUEUE_EXECUTION_NOT_COMPLETED:${params.operationExecutionId}:${execution.status}`)
  }
  if (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.PROCESSING) return
  const envelope = buildTaskJobEnvelope(task)
  await addTaskJob(envelope.data, { priority: envelope.priority })
  await markTaskEnqueued(task.id)
}
