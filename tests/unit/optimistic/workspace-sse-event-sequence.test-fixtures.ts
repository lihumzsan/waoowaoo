import {
  TASK_SSE_EVENT_TYPE,
  type TaskLifecycleEventType,
  type TaskSSEEvent,
} from '@/lib/task/types'

export function taskEvent(input: {
  readonly id: string
  readonly taskId?: string
  readonly lifecycleType?: TaskLifecycleEventType
  readonly type?: typeof TASK_SSE_EVENT_TYPE[keyof typeof TASK_SSE_EVENT_TYPE]
}): TaskSSEEvent {
  return {
    id: input.id,
    type: input.type ?? TASK_SSE_EVENT_TYPE.LIFECYCLE,
    taskId: input.taskId ?? 'task-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-11T00:00:00.000Z',
    payload: input.lifecycleType ? { lifecycleType: input.lifecycleType } : null,
  }
}
