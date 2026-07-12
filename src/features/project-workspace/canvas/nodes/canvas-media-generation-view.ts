import type { WorkspaceCanvasLifecycle } from '../lifecycle/workspace-canvas-lifecycle'

export type CanvasMediaSurfacePhase =
  | 'empty'
  | 'generating'
  | 'regenerating'
  | 'ready'
  | 'failed-empty'
  | 'failed-existing'
  | 'contract-error'

export function resolveCanvasMediaSurfacePhase(input: {
  readonly lifecyclePhase: WorkspaceCanvasLifecycle['phase']
  readonly hasOutput: boolean
}): CanvasMediaSurfacePhase {
  const running = input.lifecyclePhase === 'submitting'
    || input.lifecyclePhase === 'queued'
    || input.lifecyclePhase === 'processing'
    || input.lifecyclePhase === 'streaming'
  if (running) return input.hasOutput ? 'regenerating' : 'generating'
  if (input.lifecyclePhase === 'failed') return input.hasOutput ? 'failed-existing' : 'failed-empty'
  if (input.lifecyclePhase === 'succeeded') return input.hasOutput ? 'ready' : 'contract-error'
  return input.hasOutput ? 'ready' : 'empty'
}
