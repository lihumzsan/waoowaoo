import { QueryClient } from '@tanstack/react-query'
import { expect } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { applyWorkspaceSSEEvent } from '@/lib/query/workspace-sse-event-sync'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import { createProjectAgentRun } from '@/lib/project-agent/runs'
import {
  claimResolvedProjectAgentWaitFollowUps,
  createProjectAgentWait,
} from '@/lib/project-agent/waits'
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
    operationId: 'generate_character_image',
    taskIds: [scope.taskId],
    followUpMode: 'resume_agent',
  })
  expect(waitId).not.toBeNull()
}

export async function expectTerminalFailureConsistency(
  scope: FailureJourneyScope & { readonly expectedError: string },
): Promise<void> {
  const followUps = await claimResolvedProjectAgentWaitFollowUps({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    assistantId: 'workspace-command',
    followUpMode: 'resume_agent',
  })
  expect(followUps).toHaveLength(1)
  expect(followUps[0]).toMatchObject({
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
  await expect(claimResolvedProjectAgentWaitFollowUps({
    projectId: scope.projectId,
    userId: scope.userId,
    episodeId: scope.episodeId,
    assistantId: 'workspace-command',
    followUpMode: 'resume_agent',
  })).resolves.toEqual([])

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
