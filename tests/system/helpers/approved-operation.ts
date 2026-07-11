import { randomUUID } from 'node:crypto'
import { callRoute } from '../../integration/api/helpers/call-route'
import { prisma } from '../../helpers/prisma'
import { enqueuePersistedTask } from '@/lib/task/enqueue'

export async function approveSystemOperation(input: {
  readonly projectId: string
  readonly operationId: string
  readonly operationInput: Record<string, unknown>
  readonly context?: Record<string, unknown>
}): Promise<{
  readonly approvalGrantId: string
  readonly operationRequestId: string
}> {
  const planRoute = await import('@/app/api/projects/[projectId]/operations/[operationId]/plan/route')
  const planResponse = await callRoute(
    planRoute.POST,
    'POST',
    { input: input.operationInput, context: input.context ?? {} },
    { params: { projectId: input.projectId, operationId: input.operationId } },
  )
  if (planResponse.status !== 200) {
    throw new Error(`SYSTEM_OPERATION_PLAN_FAILED:${input.operationId}:${planResponse.status}`)
  }
  const plan = await planResponse.json() as { planSnapshotId?: string }
  if (!plan.planSnapshotId) throw new Error(`SYSTEM_OPERATION_PLAN_SNAPSHOT_MISSING:${input.operationId}`)

  const operationRequestId = `system-operation:${input.operationId}:${randomUUID()}`
  const grantRoute = await import('@/app/api/operation-approval-grants/route')
  const grantResponse = await callRoute(grantRoute.POST, 'POST', {
    planSnapshotId: plan.planSnapshotId,
    operationRequestId,
  })
  if (grantResponse.status !== 200) {
    throw new Error(`SYSTEM_APPROVAL_GRANT_FAILED:${input.operationId}:${grantResponse.status}`)
  }
  const grant = await grantResponse.json() as {
    approvalGrantId?: string
    operationRequestId?: string
  }
  if (!grant.approvalGrantId || grant.operationRequestId !== operationRequestId) {
    throw new Error(`SYSTEM_APPROVAL_GRANT_INVALID:${input.operationId}`)
  }
  return { approvalGrantId: grant.approvalGrantId, operationRequestId }
}

export async function enqueueApprovedSystemTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { operationExecutionId: true },
  })
  if (!task?.operationExecutionId) throw new Error(`SYSTEM_TASK_EXECUTION_MISSING:${taskId}`)
  const enqueueCommand = await prisma.outboxCommand.findFirst({
    where: { kind: 'task.enqueue', aggregateType: 'task', aggregateId: taskId },
  })
  if (!enqueueCommand) throw new Error(`SYSTEM_TASK_ENQUEUE_COMMAND_MISSING:${taskId}`)
  await enqueuePersistedTask({
    taskId,
    operationExecutionId: task.operationExecutionId,
  })
}
