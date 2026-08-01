import type {
  WorkspaceCanvasLifecycle,
  WorkspaceCanvasLifecyclePhase,
} from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'
export function canvasLifecycle(
  phase: WorkspaceCanvasLifecyclePhase = 'pending',
): WorkspaceCanvasLifecycle {
  const running = phase === 'queued' || phase === 'processing'
  return {
    phase,
    taskId: running ? 'task-test' : null,
    taskType: running ? 'test_task' : null,
    progress: running ? 50 : null,
    error: phase === 'failed' ? { code: 'TEST_FAILED' } : null,
  }
}
