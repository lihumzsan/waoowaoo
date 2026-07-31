import type { SSEEvent } from '@/lib/sse/events'

export function lifecycleEvent(id: string, progress: number): SSEEvent {
  return {
    id,
    type: 'task.lifecycle',
    taskId: 'task-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-11T00:00:00.000Z',
    payload: {
      lifecycleType: 'task.progress',
      progress,
    },
  }
}
