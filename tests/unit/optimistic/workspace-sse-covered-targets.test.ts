import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { applyWorkspaceSSEEvent } from '@/lib/query/workspace-sse-event-sync'
import { queryKeys } from '@/lib/query/keys'
import type { TaskTargetState, TaskTargetStateQuery } from '@/lib/query/hooks/useTaskTargetStateMap'
import type { TaskTargetOverlayMap } from '@/lib/query/task-target-overlay'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, TASK_TYPE, type SSEEvent, type TaskLifecycleEventType } from '@/lib/task/types'

function targetStatesKey(projectId: string, targets: readonly TaskTargetStateQuery[]) {
  return queryKeys.tasks.targetStates(projectId, JSON.stringify(targets))
}

function createState(input: Partial<TaskTargetState> & Pick<TaskTargetState, 'targetType' | 'targetId'>): TaskTargetState {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    phase: input.phase ?? 'idle',
    runningTaskId: input.runningTaskId ?? null,
    runningTaskType: input.runningTaskType ?? null,
    progressGroupId: input.progressGroupId ?? null,
    intent: input.intent ?? 'process',
    hasOutputAtStart: input.hasOutputAtStart ?? null,
    progress: input.progress ?? null,
    stage: input.stage ?? null,
    stageLabel: input.stageLabel ?? null,
    lastError: input.lastError ?? null,
    updatedAt: input.updatedAt ?? null,
  }
}

function lifecycleEvent(input: {
  readonly lifecycleType: TaskLifecycleEventType
  readonly taskId: string
  readonly payload?: Record<string, unknown>
}): SSEEvent {
  return {
    id: `${input.lifecycleType}:1`,
    type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
    taskId: input.taskId,
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-06-24T00:00:00.000Z',
    taskType: TASK_TYPE.IMAGE_PANEL,
    targetType: 'ProjectPanel',
    targetId: 'panel-1',
    episodeId: 'episode-1',
    payload: {
      lifecycleType: input.lifecycleType,
      intent: 'generate',
      ui: {
        intent: 'generate',
        hasOutputAtStart: false,
        progressGroupId: 'operation:generate_storyboard_grid_images:request-1',
      },
      coveredTargets: [
        { targetType: 'ProjectPanel', targetId: 'panel-1' },
        { targetType: 'ProjectPanel', targetId: 'panel-2' },
        { targetType: 'ProjectPanel', targetId: 'panel-3' },
      ],
      ...input.payload,
    },
  }
}

describe('workspace SSE covered targets', () => {
  it('applies a storyboard grid image lifecycle event to every covered panel overlay', () => {
    const queryClient = new QueryClient()
    const scheduleTargetStatesInvalidation = vi.fn()

    applyWorkspaceSSEEvent({
      queryClient,
      event: lifecycleEvent({
        lifecycleType: TASK_EVENT_TYPE.PROCESSING,
        taskId: 'task-grid-1',
        payload: {
          progress: 42,
          stage: 'generate_panel_grid',
        },
      }),
      projectId: 'project-1',
      episodeId: 'episode-1',
      isGlobalAssetProject: false,
      scheduleTargetStatesInvalidation,
    })

    const overlay = queryClient.getQueryData<TaskTargetOverlayMap>(
      queryKeys.tasks.targetStateOverlay('project-1'),
    )

    expect(overlay?.['ProjectPanel:panel-1']).toEqual(expect.objectContaining({
      phase: 'processing',
      runningTaskId: 'task-grid-1',
      runningTaskType: TASK_TYPE.IMAGE_PANEL,
      progress: 42,
      stage: 'generate_panel_grid',
    }))
    expect(overlay?.['ProjectPanel:panel-2']).toEqual(expect.objectContaining({
      phase: 'processing',
      runningTaskId: 'task-grid-1',
      runningTaskType: TASK_TYPE.IMAGE_PANEL,
      progress: 42,
      stage: 'generate_panel_grid',
    }))
    expect(overlay?.['ProjectPanel:panel-3']).toEqual(expect.objectContaining({
      phase: 'processing',
      runningTaskId: 'task-grid-1',
      runningTaskType: TASK_TYPE.IMAGE_PANEL,
      progress: 42,
      stage: 'generate_panel_grid',
    }))
    expect(scheduleTargetStatesInvalidation).not.toHaveBeenCalled()
  })

  it('applies terminal storyboard grid image state to every covered panel target cache', () => {
    const queryClient = new QueryClient()
    const targets: TaskTargetStateQuery[] = [
      { targetType: 'ProjectPanel', targetId: 'panel-1', types: [TASK_TYPE.IMAGE_PANEL] },
      { targetType: 'ProjectPanel', targetId: 'panel-2', types: [TASK_TYPE.IMAGE_PANEL] },
      { targetType: 'ProjectPanel', targetId: 'panel-3', types: [TASK_TYPE.IMAGE_PANEL] },
    ]
    const key = targetStatesKey('project-1', targets)
    queryClient.setQueryData<readonly TaskTargetState[]>(key, targets.map((target) => createState({
      targetType: target.targetType,
      targetId: target.targetId,
      phase: 'processing',
      runningTaskId: 'task-grid-1',
      runningTaskType: TASK_TYPE.IMAGE_PANEL,
      progress: 82,
    })))
    const scheduleTargetStatesInvalidation = vi.fn()

    applyWorkspaceSSEEvent({
      queryClient,
      event: lifecycleEvent({
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
        taskId: 'task-grid-1',
        payload: {
          progress: 100,
          stage: 'persist_panel_images',
        },
      }),
      projectId: 'project-1',
      episodeId: 'episode-1',
      isGlobalAssetProject: false,
      scheduleTargetStatesInvalidation,
    })

    const states = queryClient.getQueryData<readonly TaskTargetState[]>(key)
    expect(states?.map((state) => ({
      targetId: state.targetId,
      phase: state.phase,
      runningTaskId: state.runningTaskId,
      runningTaskType: state.runningTaskType,
      progress: state.progress,
      stage: state.stage,
    }))).toEqual([
      {
        targetId: 'panel-1',
        phase: 'completed',
        runningTaskId: null,
        runningTaskType: TASK_TYPE.IMAGE_PANEL,
        progress: 100,
        stage: 'persist_panel_images',
      },
      {
        targetId: 'panel-2',
        phase: 'completed',
        runningTaskId: null,
        runningTaskType: TASK_TYPE.IMAGE_PANEL,
        progress: 100,
        stage: 'persist_panel_images',
      },
      {
        targetId: 'panel-3',
        phase: 'completed',
        runningTaskId: null,
        runningTaskType: TASK_TYPE.IMAGE_PANEL,
        progress: 100,
        stage: 'persist_panel_images',
      },
    ])
    expect(scheduleTargetStatesInvalidation).toHaveBeenCalledTimes(1)
  })
})
