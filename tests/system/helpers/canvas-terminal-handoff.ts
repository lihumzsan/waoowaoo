import { QueryClient } from '@tanstack/react-query'
import { expect } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { applyWorkspaceSSEEvent } from '@/lib/query/workspace-sse-event-sync'
import type { TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import { listTaskLifecycleEvents } from '@/lib/task/publisher'
import { resolveWorkspaceCanvasLifecycle } from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'

export async function expectCompletedCanvasHandoff(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly taskId: string
  readonly taskType: string
  readonly targetType: string
  readonly targetId: string
  readonly persistedOutput: string
}): Promise<void> {
  const events = await listTaskLifecycleEvents(input.taskId)
  const completedEvent = events.find((event) => (
    event.payload?.lifecycleType === TASK_EVENT_TYPE.COMPLETED
  ))
  expect(completedEvent).toBeTruthy()
  if (!completedEvent) throw new Error('SYSTEM_COMPLETED_LIFECYCLE_EVENT_MISSING')
  expect(completedEvent.payload?.materializedResources).toEqual([
    expect.objectContaining({
      kind: 'episodeData',
      projectId: input.projectId,
      episodeId: input.episodeId,
      taskId: input.taskId,
    }),
  ])

  const queryClient = new QueryClient()
  const serializedTargets = JSON.stringify([{
    targetType: input.targetType,
    targetId: input.targetId,
  }])
  const targetStateKey = queryKeys.tasks.targetStates(input.projectId, serializedTargets)
  queryClient.setQueryData<readonly TaskTargetState[]>(targetStateKey, [{
    targetType: input.targetType,
    targetId: input.targetId,
    phase: 'processing',
    runningTaskId: input.taskId,
    runningTaskType: input.taskType,
    progressGroupId: null,
    intent: 'generate',
    hasOutputAtStart: false,
    progress: 95,
    stage: 'polling',
    stageLabel: 'progress.stage.polling',
    lastError: null,
    updatedAt: new Date(Date.parse(completedEvent.ts) - 1).toISOString(),
  }])

  applyWorkspaceSSEEvent({
    queryClient,
    event: completedEvent,
    projectId: input.projectId,
    episodeId: input.episodeId,
    isGlobalAssetProject: false,
    scheduleTargetStatesInvalidation: () => undefined,
  })

  const materializedEpisode = queryClient.getQueryData<unknown>(
    queryKeys.episodeData(input.projectId, input.episodeId),
  )
  expect(JSON.stringify(materializedEpisode)).toContain(input.persistedOutput)
  const states = queryClient.getQueryData<readonly TaskTargetState[]>(targetStateKey)
  expect(states).toEqual([
    expect.objectContaining({
      phase: 'completed',
      taskId: input.taskId,
      runningTaskId: null,
      progress: 100,
      lastError: null,
    }),
  ])
  const terminalState = states?.[0]
  if (!terminalState) throw new Error('SYSTEM_CANVAS_TERMINAL_STATE_MISSING')
  expect(resolveWorkspaceCanvasLifecycle({
    persistedPhase: 'succeeded',
    task: terminalState,
    stream: null,
    submitting: false,
  })).toMatchObject({
    phase: 'succeeded',
    taskId: input.taskId,
    error: null,
    stream: null,
  })
  queryClient.clear()
}
