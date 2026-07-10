import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { expect } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import {
  commitOperationPlan,
  planOperation,
  toOperationPlanView,
} from '@/lib/operations/planning'
import { createProjectAgentRun, getProjectAgentRun } from '@/lib/project-agent/runs'
import {
  consumeProjectAgentApprovalInterruption,
  createProjectAgentApprovalInterruption,
} from '@/lib/project-agent/interruptions'
import { getProjectAgentSessionState } from '@/lib/project-agent/session-state'
import {
  claimResolvedProjectAgentWaitFollowUps,
  consumeProjectAgentWaitFollowUp,
  createProjectAgentWait,
} from '@/lib/project-agent/waits'
import { getCurrentProjectAgentActivity } from '@/lib/project-agent/event'
import { prisma } from '../../helpers/prisma'

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
  const planView = await toOperationPlanView(plan)
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
  const interruptionId = await createProjectAgentApprovalInterruption({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    runId: run.id,
    operationId: 'generate_character_image',
    approvalId: `system-approval:${run.id}`,
    toolCallId: operationContext.toolCallId,
    runState: '{"kind":"system-approval-checkpoint"}',
    payload: { operationPlan: planView as unknown as Prisma.InputJsonValue },
  })
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
  expect((await getProjectAgentRun({ ...scope, runId: run.id }))?.status).toBe('running')

  const confirmedInput = operation.inputSchema.safeParse({
    ...baseInput,
    confirmed: true,
    ...(typeof planView.quote.totalMaxFrozenCost === 'number'
      ? { confirmedMaxCost: planView.quote.totalMaxFrozenCost }
      : {}),
  })
  if (!confirmedInput.success) throw new Error('SYSTEM_ASSISTANT_CONFIRMED_INPUT_INVALID')
  const committed = await commitOperationPlan({
    operation,
    ctx: operationContext,
    input: confirmedInput.data,
    plan,
    confirmedMaxCost: planView.quote.totalMaxFrozenCost ?? null,
  })
  const output = operation.outputSchema.safeParse(committed)
  expect(output.success).toBe(true)
  if (!output.success || !output.data || typeof output.data !== 'object' || Array.isArray(output.data)) {
    throw new Error('SYSTEM_ASSISTANT_OPERATION_OUTPUT_INVALID')
  }
  const taskId = (output.data as Record<string, unknown>).taskId
  if (typeof taskId !== 'string' || !taskId) throw new Error('SYSTEM_ASSISTANT_TASK_ID_MISSING')
  const waitId = await createProjectAgentWait({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    runId: run.id,
    operationId: 'generate_character_image',
    taskIds: [taskId],
    followUpMode: 'resume_agent',
  })
  if (!waitId) throw new Error('SYSTEM_ASSISTANT_WAIT_MISSING')
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
  const followUps = await claimResolvedProjectAgentWaitFollowUps({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    assistantId: 'workspace-command',
    followUpMode: 'resume_agent',
  })
  expect(followUps).toHaveLength(1)
  expect(followUps[0]).toMatchObject({
    runId: input.runId,
    waitId: input.waitId,
    taskIds: [input.taskId],
    terminalStatus: 'completed',
  })
  const followUp = followUps[0]
  if (!followUp) throw new Error('SYSTEM_ASSISTANT_FOLLOW_UP_MISSING')
  const consumed = await consumeProjectAgentWaitFollowUp({
    runId: input.runId,
    waitId: input.waitId,
    claimId: followUp.claimId,
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
  })).toMatchObject({ status: 'followed', followedAt: expect.any(Date) })
}
