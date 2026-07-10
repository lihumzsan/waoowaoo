import { randomUUID } from 'node:crypto'
import { QueryClient } from '@tanstack/react-query'
import { expect } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { applyWorkspaceSSEEvent } from '@/lib/query/workspace-sse-event-sync'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import { createProjectAgentRun } from '@/lib/project-agent/runs'
import {
  claimProjectAgentWaitContinuation,
  createProjectAgentWait,
  startProjectAgentWaitFollowUp,
} from '@/lib/project-agent/waits'
import { prisma } from '../../helpers/prisma'
import { listTaskLifecycleEvents } from '@/lib/task/publisher'

type FailureJourneyScope = {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly taskId: string
  readonly targetType: string
  readonly targetId: string
}

export async function bindAssistantWaitToSystemTask(scope: FailureJourneyScope): Promise<void> {
  const run = await createProjectAgentRun({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    requestId: `system-terminal-failure:${scope.taskId}`,
    controlKind: 'approval_response',
  })
  const waitId = await createProjectAgentWait({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    runId: run.id,
    runFence: { runId: run.id, runVersion: run.runVersion, eventSeq: run.eventSeq },
    operationId: 'generate_character_image',
    taskIds: [scope.taskId],
    followUpMode: 'resume_agent',
  })
  expect(waitId).not.toBeNull()
}

export async function expectTerminalFailureConsistency(
  scope: FailureJourneyScope & { readonly expectedError: string },
): Promise<void> {
  const wait = await prisma.projectAgentWait.findFirst({
    where: { taskIds: { array_contains: scope.taskId } },
    orderBy: { createdAt: 'desc' },
  })
  if (!wait) throw new Error('SYSTEM_FAILURE_WAIT_MISSING')
  const command = await prisma.outboxCommand.findFirst({
    where: { kind: 'project_agent.continue_wait', aggregateId: wait.id },
  })
  if (!command || !command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
    throw new Error('SYSTEM_FAILURE_CONTINUATION_COMMAND_MISSING')
  }
  const payload = command.payload as Record<string, unknown>
  const claimOwner = randomUUID()
  const claim = await claimProjectAgentWaitContinuation({
    waitId: wait.id,
    runId: wait.runId!,
    expectedRunVersion: Number(payload.expectedRunVersion),
    expectedEventSeq: String(payload.expectedEventSeq),
    commandId: command.id,
    claimOwner,
  })
  expect(claim.status).toBe('claimed')
  if (claim.status !== 'claimed') throw new Error('SYSTEM_FAILURE_CONTINUATION_NOT_CLAIMED')
  expect(claim.followUp).toMatchObject({
    terminalStatus: 'failed',
    taskIds: [scope.taskId],
    failedTaskIds: [scope.taskId],
    failedTasks: [{
      taskId: scope.taskId,
      targetType: scope.targetType,
      targetId: scope.targetId,
      status: 'failed',
      errorMessage: scope.expectedError,
    }],
  })
  await startProjectAgentWaitFollowUp({
    runId: wait.runId!,
    waitId: wait.id,
    commandId: command.id,
    claimOwner,
    projectId: scope.projectId,
    userId: scope.userId,
  })
  await expect(claimProjectAgentWaitContinuation({
    waitId: wait.id,
    runId: wait.runId!,
    expectedRunVersion: Number(payload.expectedRunVersion),
    expectedEventSeq: String(payload.expectedEventSeq),
    commandId: command.id,
    claimOwner: randomUUID(),
  })).resolves.toMatchObject({ status: 'busy' })

  const lifecycleEvents = await listTaskLifecycleEvents(scope.taskId)
  const failedEvent = lifecycleEvents.find((event) => (
    event.payload?.lifecycleType === TASK_EVENT_TYPE.FAILED
  ))
  expect(failedEvent).toBeTruthy()
  if (!failedEvent) throw new Error('SYSTEM_FAILED_LIFECYCLE_EVENT_MISSING')

  const queryClient = new QueryClient()
  const serializedTargets = JSON.stringify([{
    targetType: scope.targetType,
    targetId: scope.targetId,
  }])
  const targetStateKey = queryKeys.tasks.targetStates(scope.projectId, serializedTargets)
  queryClient.setQueryData<readonly TaskTargetState[]>(targetStateKey, [{
    targetType: scope.targetType,
    targetId: scope.targetId,
    phase: 'processing',
    runningTaskId: scope.taskId,
    runningTaskType: failedEvent.taskType ?? null,
    progressGroupId: null,
    intent: 'generate',
    hasOutputAtStart: true,
    progress: 80,
    stage: 'generating',
    stageLabel: 'progress.stage.generating',
    lastError: null,
    updatedAt: new Date(Date.parse(failedEvent.ts) - 1).toISOString(),
  }])

  applyWorkspaceSSEEvent({
    queryClient,
    event: failedEvent,
    projectId: scope.projectId,
    episodeId: scope.episodeId,
    isGlobalAssetProject: false,
    scheduleTargetStatesInvalidation: () => undefined,
  })

  expect(queryClient.getQueryData<readonly TaskTargetState[]>(targetStateKey)).toEqual([
    expect.objectContaining({
      phase: 'failed',
      taskId: scope.taskId,
      runningTaskId: null,
      lastError: expect.objectContaining({ message: scope.expectedError }),
    }),
  ])
  queryClient.clear()
}
