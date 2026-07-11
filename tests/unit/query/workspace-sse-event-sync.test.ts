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

function terminalEvent(lifecycleType: 'task.completed' | 'task.failed' | 'task.canceled'): TaskSSEEvent {
  return {
    id: `event:${lifecycleType}`,
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
      lifecycleType,
      affectedResources: [{ kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' }],
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

describe('workspace SSE terminal resource refetch', () => {
  it('actively invalidates the exact Assistant Thread when Session state changes', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    apply(queryClient, {
      id: 'agent:42',
      type: 'assistant.session.changed',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-07-11T00:00:00.000Z',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      agentEventId: '42',
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.project.assistantThread('project-1', 'episode-1'),
      exact: true,
    })
  })

  it.each([
    TASK_EVENT_TYPE.COMPLETED,
    TASK_EVENT_TYPE.FAILED,
    TASK_EVENT_TYPE.CANCELED,
  ] as const)('uses %s only as a notification to refetch the canonical Episode Query', (lifecycleType) => {
    const queryClient = new QueryClient()
    const queryKey = queryKeys.episodeData('project-1', 'episode-1')
    const staleSnapshot = { id: 'episode-1', name: 'stale cache' }
    queryClient.setQueryData(queryKey, staleSnapshot)
    const setQueryData = vi.spyOn(queryClient, 'setQueryData')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const refetch = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue()

    apply(queryClient, terminalEvent(lifecycleType))

    expect(setQueryData).not.toHaveBeenCalledWith(queryKey, expect.anything())
    expect(queryClient.getQueryData(queryKey)).toEqual(staleSnapshot)
    expect(invalidate).toHaveBeenCalledWith({ queryKey })
    expect(refetch).toHaveBeenCalledWith({ queryKey, type: 'active' })
  })

  it('projects canceled as a terminal target state without a content handoff contract', () => {
    const queryClient = new QueryClient()
    const stateKey = queryKeys.tasks.targetStates('project-1', JSON.stringify([target]))
    queryClient.setQueryData(stateKey, [targetState()])

    apply(queryClient, terminalEvent(TASK_EVENT_TYPE.CANCELED))

    expect(queryClient.getQueryData<readonly TaskTargetState[]>(stateKey)?.[0]).toMatchObject({
      phase: 'canceled',
      runningTaskId: null,
      lastError: null,
    })
  })
})
