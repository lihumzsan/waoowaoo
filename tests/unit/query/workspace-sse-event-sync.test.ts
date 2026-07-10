import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { applyWorkspaceSSEEvent } from '@/lib/query/workspace-sse-event-sync'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, type SSEEvent, type TaskSSEEvent } from '@/lib/task/types'
import type { TaskTargetState, TaskTargetStateQuery } from '@/lib/query/hooks/useTaskTargetStateMap'

const target: TaskTargetStateQuery = {
  targetType: 'ProjectPanel',
  targetId: 'panel-1',
  types: ['video_panel'],
}

function targetState(): TaskTargetState {
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phase: 'processing',
    runningTaskId: 'task-1',
    runningTaskType: 'video_panel',
    progressGroupId: null,
    intent: 'generate',
    hasOutputAtStart: false,
    progress: 80,
    stage: null,
    stageLabel: null,
    lastError: null,
    updatedAt: '2026-07-11T00:01:00.000Z',
  }
}

function episodeSnapshot(updatedAt: string, name: string) {
  return {
    id: 'episode-1',
    name,
    updatedAt,
    resourceVersion: { scheme: 'aggregate_updated_at' as const, value: updatedAt },
  }
}

function completedEvent(updatedAt: string): TaskSSEEvent {
  return {
    id: `event:${updatedAt}`,
    type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
    taskId: 'task-1',
    taskType: 'video_panel',
    targetType: target.targetType,
    targetId: target.targetId,
    episodeId: 'episode-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-11T00:03:00.000Z',
    payload: {
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      materializedResources: [{
        kind: 'episodeData',
        taskId: 'task-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        resourceKey: 'episodeData:project-1:episode-1',
        resourceVersion: { scheme: 'aggregate_updated_at', value: updatedAt },
        data: episodeSnapshot(updatedAt, 'terminal snapshot'),
      }],
    },
  }
}

function apply(queryClient: QueryClient, event: SSEEvent) {
  applyWorkspaceSSEEvent({
    queryClient,
    event,
    projectId: 'project-1',
    episodeId: 'episode-1',
    isGlobalAssetProject: false,
    scheduleTargetStatesInvalidation: vi.fn(),
  })
}

describe('workspace SSE terminal materialized handoff', () => {
  it('projects canceled as a terminal state and does not require a materialized resource', () => {
    const queryClient = new QueryClient()
    const stateKey = queryKeys.tasks.targetStates('project-1', JSON.stringify([target]))
    queryClient.setQueryData(stateKey, [targetState()])
    const event: TaskSSEEvent = {
      ...completedEvent('2026-07-11T00:02:00.000Z'),
      id: 'event:canceled',
      payload: { lifecycleType: TASK_EVENT_TYPE.CANCELED },
    }

    apply(queryClient, event)

    expect(queryClient.getQueryData<readonly TaskTargetState[]>(stateKey)?.[0]).toMatchObject({
      phase: 'canceled',
      runningTaskId: null,
      lastError: null,
    })
  })

  it.each([
    ['duplicate', '2026-07-11T00:02:00.000Z'],
    ['stale', '2026-07-11T00:01:00.000Z'],
  ] as const)('treats a %s terminal snapshot as a valid idempotent handoff', (_case, incomingVersion) => {
    const queryClient = new QueryClient()
    const stateKey = queryKeys.tasks.targetStates('project-1', JSON.stringify([target]))
    queryClient.setQueryData(stateKey, [targetState()])
    queryClient.setQueryData(
      queryKeys.episodeData('project-1', 'episode-1'),
      episodeSnapshot('2026-07-11T00:02:00.000Z', 'current snapshot'),
    )

    apply(queryClient, completedEvent(incomingVersion))

    const states = queryClient.getQueryData<readonly TaskTargetState[]>(stateKey)
    expect(states?.[0]).toMatchObject({
      phase: 'completed',
      runningTaskId: null,
      lastError: null,
    })
    expect(queryClient.getQueryData(queryKeys.episodeData('project-1', 'episode-1')))
      .toEqual(episodeSnapshot('2026-07-11T00:02:00.000Z', 'current snapshot'))
  })

  it('projects identity conflict as an explicit terminal contract failure', () => {
    const queryClient = new QueryClient()
    const stateKey = queryKeys.tasks.targetStates('project-1', JSON.stringify([target]))
    queryClient.setQueryData(stateKey, [targetState()])
    const event = completedEvent('2026-07-11T00:02:00.000Z')
    const payload = event.payload as Record<string, unknown>
    const resources = payload.materializedResources as Array<Record<string, unknown>>
    resources[0] = { ...resources[0], projectId: 'different-project' }

    apply(queryClient, event)

    expect(queryClient.getQueryData<readonly TaskTargetState[]>(stateKey)?.[0]).toMatchObject({
      phase: 'completed',
      lastError: {
        code: 'CANVAS_TERMINAL_RESOURCE_ENVELOPE_SCOPE_MISMATCH:episodeData:project-1:episode-1',
      },
    })
  })
})
