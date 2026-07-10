import {
  resolveWorkspaceCanvasLifecycle,
  type WorkspaceCanvasLifecycle,
  type WorkspaceCanvasPersistedPhase,
} from './workspace-canvas-lifecycle'

export interface WorkspaceCanvasResourcePresentation {
  readonly lifecycle: WorkspaceCanvasLifecycle
}

export function workspaceCanvasResourcePresentation(
  phase: WorkspaceCanvasPersistedPhase,
): WorkspaceCanvasResourcePresentation {
  return {
    lifecycle: resolveWorkspaceCanvasLifecycle({
      persistedPhase: phase,
      task: null,
      stream: null,
      submitting: false,
    }),
  }
}

export const workspaceCanvasPendingResourcePresentation = () => workspaceCanvasResourcePresentation('pending')
export const workspaceCanvasSucceededResourcePresentation = () => workspaceCanvasResourcePresentation('succeeded')
export const workspaceCanvasFailedResourcePresentation = () => workspaceCanvasResourcePresentation('failed')

export function workspaceCanvasResourcePhaseFromStatus(
  status: string | null | undefined,
): Exclude<WorkspaceCanvasPersistedPhase, 'pending' | 'canceled'> | null {
  if (status === 'failed') return 'failed'
  if (
    status === 'ready'
    || status === 'script_ready_for_review'
    || status === 'script_approved'
    || status === 'ready_for_review'
    || status === 'planned'
    || status === 'completed'
    || status === 'confirmed'
  ) {
    return 'succeeded'
  }
  return null
}
