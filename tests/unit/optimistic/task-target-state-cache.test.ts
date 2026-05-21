import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import type {
  TaskTargetState,
  TaskTargetStateQuery,
} from '@/lib/query/hooks/useTaskTargetStateMap'
import { applyTaskTargetTerminalStateToCache } from '@/lib/query/task-target-state-cache'

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
    intent: input.intent ?? 'process',
    hasOutputAtStart: input.hasOutputAtStart ?? null,
    progress: input.progress ?? null,
    stage: input.stage ?? null,
    stageLabel: input.stageLabel ?? null,
    lastError: input.lastError ?? null,
    updatedAt: input.updatedAt ?? null,
  }
}

describe('task target state cache terminal sync', () => {
  it('clears stale processing state when the matching task completes', () => {
    const queryClient = new QueryClient()
    const targets: TaskTargetStateQuery[] = [
      { targetType: 'CharacterAppearance', targetId: 'appearance-1', types: ['image_character'] },
    ]
    const key = targetStatesKey('project-1', targets)
    queryClient.setQueryData<readonly TaskTargetState[]>(key, [
      createState({
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
        phase: 'processing',
        runningTaskId: 'task-1',
        runningTaskType: 'image_character',
        intent: 'generate',
        progress: 80,
        updatedAt: '2026-05-21T00:00:01.000Z',
      }),
    ])

    applyTaskTargetTerminalStateToCache(queryClient, {
      projectId: 'project-1',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      phase: 'completed',
      taskId: 'task-1',
      taskType: 'image_character',
      intent: 'generate',
      hasOutputAtStart: false,
      progress: null,
      stage: null,
      stageLabel: null,
      errorCode: null,
      errorMessage: null,
      eventTs: '2026-05-21T00:00:02.000Z',
    })

    const data = queryClient.getQueryData<readonly TaskTargetState[]>(key)
    expect(data?.[0]).toEqual(expect.objectContaining({
      phase: 'completed',
      runningTaskId: null,
      runningTaskType: 'image_character',
      progress: 100,
      updatedAt: '2026-05-21T00:00:02.000Z',
    }))
  })

  it('does not clear a newer running task when an older terminal event arrives', () => {
    const queryClient = new QueryClient()
    const targets: TaskTargetStateQuery[] = [
      { targetType: 'LocationImage', targetId: 'location-1', types: ['image_location'] },
    ]
    const key = targetStatesKey('project-1', targets)
    queryClient.setQueryData<readonly TaskTargetState[]>(key, [
      createState({
        targetType: 'LocationImage',
        targetId: 'location-1',
        phase: 'processing',
        runningTaskId: 'task-new',
        runningTaskType: 'image_location',
        intent: 'generate',
        progress: 20,
      }),
    ])

    applyTaskTargetTerminalStateToCache(queryClient, {
      projectId: 'project-1',
      targetType: 'LocationImage',
      targetId: 'location-1',
      phase: 'completed',
      taskId: 'task-old',
      taskType: 'image_location',
      intent: 'generate',
      hasOutputAtStart: false,
      progress: null,
      stage: null,
      stageLabel: null,
      errorCode: null,
      errorMessage: null,
      eventTs: '2026-05-21T00:00:02.000Z',
    })

    const data = queryClient.getQueryData<readonly TaskTargetState[]>(key)
    expect(data?.[0]).toEqual(expect.objectContaining({
      phase: 'processing',
      runningTaskId: 'task-new',
      progress: 20,
    }))
  })

  it('updates only the matching task-type slice for shared targets', () => {
    const queryClient = new QueryClient()
    const imageTarget: TaskTargetStateQuery = {
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      types: ['image_panel'],
    }
    const videoTarget: TaskTargetStateQuery = {
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      types: ['video_panel'],
    }
    const key = targetStatesKey('project-1', [imageTarget, videoTarget])
    queryClient.setQueryData<readonly TaskTargetState[]>(key, [
      createState({
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        phase: 'processing',
        runningTaskId: 'task-image',
        runningTaskType: 'image_panel',
      }),
      createState({
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        phase: 'idle',
        runningTaskId: null,
        runningTaskType: null,
      }),
    ])

    applyTaskTargetTerminalStateToCache(queryClient, {
      projectId: 'project-1',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      phase: 'completed',
      taskId: 'task-image',
      taskType: 'image_panel',
      intent: 'generate',
      hasOutputAtStart: true,
      progress: null,
      stage: null,
      stageLabel: null,
      errorCode: null,
      errorMessage: null,
      eventTs: '2026-05-21T00:00:02.000Z',
    })

    const data = queryClient.getQueryData<readonly TaskTargetState[]>(key)
    expect(data?.[0]?.phase).toBe('completed')
    expect(data?.[0]?.runningTaskId).toBe(null)
    expect(data?.[1]?.phase).toBe('idle')
    expect(data?.[1]?.runningTaskId).toBe(null)
  })
})
