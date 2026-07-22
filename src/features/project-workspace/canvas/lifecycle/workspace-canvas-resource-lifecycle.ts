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
    }),
  }
}

export const workspaceCanvasPendingResourcePresentation = () => workspaceCanvasResourcePresentation('pending')
export const workspaceCanvasSucceededResourcePresentation = () => workspaceCanvasResourcePresentation('succeeded')
export const workspaceCanvasFailedResourcePresentation = () => workspaceCanvasResourcePresentation('failed')
