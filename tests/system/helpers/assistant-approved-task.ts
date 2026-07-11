import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { expect } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import {
  persistOperationPlanView,
  planOperation,
} from '@/lib/operations/planning'
import { invokeApprovedOperationPlan, issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import { createProjectAgentRun, getProjectAgentRun } from '@/lib/project-agent/runs'
import {
  consumeProjectAgentApprovalInterruption,
  settleProjectAgentInterruptionSuspension,
} from '@/lib/project-agent/interruptions'
import { getProjectAgentSessionState } from '@/lib/project-agent/session-state'
import {
  claimProjectAgentWaitContinuation,
  bindProjectAgentWaitToTasksInTransaction,
  startProjectAgentWaitFollowUp,
} from '@/lib/project-agent/waits'
import { getCurrentProjectAgentActivity } from '@/lib/project-agent/event'
import { prisma } from '../../helpers/prisma'
import { enqueueApprovedSystemTask } from './approved-operation'

type ApprovedTaskScope = {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly characterId: string
  readonly appearanceId: string
}

export async function submitApprovedAssistantImageTask(scope: ApprovedTaskScope): Promise<{
  readonly runId: string
  readonly waitId: string
  readonly taskId: string
}> {
  const operation = createProjectAgentOperationRegistryForApi().generate_character_image
  if (!operation) throw new Error('SYSTEM_GENERATE_CHARACTER_IMAGE_OPERATION_MISSING')
  expect(operation.confirmation).toMatchObject({ kind: 'billable_media', required: true })

  const request = new NextRequest(`http://localhost/api/projects/${scope.projectId}/assistant/system-plan`, {
    method: 'POST',
  })
  const operationContext = {
    request,
    userId: scope.userId,
    projectId: scope.projectId,
    context: { locale: 'zh', episodeId: scope.episodeId },
    source: 'assistant-panel',
    writer: null,
    toolCallId: 'system-approved-image-tool',
  }
  const baseInput = {
    characterId: scope.characterId,
    appearanceId: scope.appearanceId,
    count: 1,
  }
  const parsedInput = operation.inputSchema.safeParse(baseInput)
  expect(parsedInput.success).toBe(true)
  if (!parsedInput.success) throw new Error('SYSTEM_ASSISTANT_OPERATION_INPUT_INVALID')
  const plan = await planOperation({
    operation,
    ctx: operationContext,
    input: parsedInput.data,
  })
  const planView = await persistOperationPlanView({
    plan,
    normalizedInput: parsedInput.data,
    episodeId: scope.episodeId,
  })
  expect(planView).toMatchObject({
    operationId: 'generate_character_image',
    taskCount: 1,
    quote: {
      billable: true,
      mediaTaskCount: 1,
    },
    tasks: [{
      taskType: 'image_character',
      targetType: 'CharacterAppearance',
      targetId: scope.appearanceId,
    }],
  })

  const run = await createProjectAgentRun({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    requestId: `system-assistant-approval:${scope.projectId}`,
    controlKind: 'user_turn',
  })
  const suspension = await settleProjectAgentInterruptionSuspension({
    kind: 'approval',
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    runId: run.id,
    runFence: { runId: run.id, runVersion: run.runVersion, eventSeq: run.eventSeq },
    operationId: 'generate_character_image',
    approvalId: `system-approval:${run.id}`,
    toolCallId: operationContext.toolCallId,
    runState: '{"kind":"system-approval-checkpoint"}',
    payload: { operationPlan: planView as unknown as Prisma.InputJsonValue },
  })
  if (suspension.kind !== 'approval') throw new Error('SYSTEM_ASSISTANT_APPROVAL_SUSPENSION_INVALID')
  const interruptionId = suspension.interruptionId
  const awaitingApproval = await getProjectAgentSessionState({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    assistantId: 'workspace-command',
    locale: 'zh',
  })
  expect(awaitingApproval.currentRun?.status).toBe('awaiting_approval')
  expect(awaitingApproval.pendingInteraction).toMatchObject({
    kind: 'approval',
    interruptionId,
    operationId: 'generate_character_image',
    operationPlan: planView,
  })

  const consumedApproval = await consumeProjectAgentApprovalInterruption({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    runId: run.id,
    interruptionId,
    response: { approved: true },
  })
  expect(consumedApproval?.status).toBe('consumed')
  const resumedRun = await getProjectAgentRun({ ...scope, runId: run.id })
  expect(resumedRun?.status).toBe('running')
  if (!resumedRun) throw new Error('SYSTEM_ASSISTANT_RESUMED_RUN_MISSING')

  if (!planView.planSnapshotId) throw new Error('SYSTEM_ASSISTANT_PLAN_SNAPSHOT_MISSING')
  const grant = await issueApprovalGrant({
    userId: scope.userId,
    planSnapshotId: planView.planSnapshotId,
    requestId: `system-approved-operation:${run.id}`,
  })
  const committed = await invokeApprovedOperationPlan({
    operation,
    ctx: operationContext,
    normalizedInput: parsedInput.data,
    invocation: {
      approvalGrantId: grant.approvalGrantId,
      requestId: grant.operationRequestId,
    },
  })
  const output = operation.outputSchema.safeParse(committed)
  expect(output.success).toBe(true)
  if (!output.success || !output.data || typeof output.data !== 'object' || Array.isArray(output.data)) {
    throw new Error('SYSTEM_ASSISTANT_OPERATION_OUTPUT_INVALID')
  }
  const taskId = (output.data as Record<string, unknown>).taskId
  if (typeof taskId !== 'string' || !taskId) throw new Error('SYSTEM_ASSISTANT_TASK_ID_MISSING')
  await enqueueApprovedSystemTask(taskId)
  const taskSuspension = await prisma.$transaction(async (tx) => bindProjectAgentWaitToTasksInTransaction(tx, {
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    runId: run.id,
    runFence: {
      runId: resumedRun.id,
      runVersion: resumedRun.runVersion,
      eventSeq: resumedRun.eventSeq,
    },
    operationId: 'generate_character_image',
    taskIds: [taskId],
    followUpMode: 'resume_agent',
  }))
  if (!taskSuspension) throw new Error('SYSTEM_ASSISTANT_WAIT_MISSING')
  const waitId = taskSuspension.waitId
  expect((await getProjectAgentRun({ ...scope, runId: run.id }))?.status).toBe('awaiting_task')
  return { runId: run.id, waitId, taskId }
}

export async function expectAssistantTaskContinuation(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly runId: string
  readonly waitId: string
  readonly taskId: string
}): Promise<void> {
  const command = await prisma.outboxCommand.findFirst({
    where: { kind: 'project_agent.continue_wait', aggregateId: input.waitId },
  })
  if (!command || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
    throw new Error('SYSTEM_ASSISTANT_CONTINUATION_COMMAND_MISSING')
  }
  const payload = command.payload as Record<string, unknown>
  const claimOwner = randomUUID()
  const claim = await claimProjectAgentWaitContinuation({
    waitId: input.waitId,
    runId: input.runId,
    expectedRunVersion: Number(payload.expectedRunVersion),
    expectedEventSeq: String(payload.expectedEventSeq),
    commandId: command.id,
    claimOwner,
  })
  expect(claim.status).toBe('claimed')
  if (claim.status !== 'claimed') throw new Error('SYSTEM_ASSISTANT_FOLLOW_UP_NOT_CLAIMED')
  expect(claim.followUp).toMatchObject({
    runId: input.runId,
    waitId: input.waitId,
    taskIds: [input.taskId],
    terminalStatus: 'completed',
  })
  const consumed = await startProjectAgentWaitFollowUp({
    runId: input.runId,
    waitId: input.waitId,
    commandId: command.id,
    claimOwner,
    projectId: input.projectId,
    userId: input.userId,
  })
  expect(consumed?.followUpActivityId).toEqual(expect.any(String))
  expect((await getCurrentProjectAgentActivity({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    assistantId: 'workspace-command',
    runId: input.runId,
  }))).toMatchObject({
    type: 'task_follow_up',
    status: 'running',
    sourceOperationId: 'generate_character_image',
  })
  expect((await getProjectAgentRun({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    runId: input.runId,
  }))?.status).toBe('running')
  expect(await prisma.projectAgentWait.findUnique({
    where: { id: input.waitId },
    select: { status: true, followedAt: true },
  })).toMatchObject({ status: 'claimed', followedAt: null })
}
