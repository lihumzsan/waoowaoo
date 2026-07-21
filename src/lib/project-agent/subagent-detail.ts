import { ApiError } from '@/lib/api-errors'
import {
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'

export async function readProjectAgentSubagentDetail(input: {
  projectId: string
  userId: string
  taskId: string
}) {
  const task = await prisma.task.findFirst({
    where: {
      id: input.taskId,
      projectId: input.projectId,
      userId: input.userId,
      type: TASK_TYPE.CREATIVE_WORK,
    },
    select: {
      id: true,
      status: true,
      payload: true,
      result: true,
    },
  })
  if (!task) throw new ApiError('NOT_FOUND')
  const payload = creativeWorkTaskPayloadSchema.safeParse(task.payload)
  if (!payload.success) throw new ApiError('NOT_FOUND')
  const result = creativeWorkTaskResultSchema.safeParse(task.result)
  return {
    taskId: task.id,
    status: task.status,
    outputKind: payload.data.request.outputKind,
    output: result.success ? result.data.creativeWorkResult.output : null,
  }
}
