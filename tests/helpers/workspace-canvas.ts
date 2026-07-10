import type {
  WorkspaceCanvasLifecycle,
  WorkspaceCanvasLifecyclePhase,
} from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasStreamPresentation } from '@/features/project-workspace/canvas/node-canvas-types'

export function canvasLifecycle(
  phase: WorkspaceCanvasLifecyclePhase = 'pending',
  stream: WorkspaceCanvasStreamPresentation | null = null,
): WorkspaceCanvasLifecycle {
  const running = phase === 'queued' || phase === 'processing' || phase === 'streaming'
  return {
    phase,
    taskId: running ? 'task-test' : null,
    taskType: running ? 'test_task' : null,
    progress: running ? 50 : null,
    error: phase === 'failed' ? { code: 'TEST_FAILED', message: 'Test failed' } : null,
    stream,
  }
}
