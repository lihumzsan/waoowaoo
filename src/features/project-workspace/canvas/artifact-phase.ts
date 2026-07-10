export type WorkspaceCanvasArtifactPhase = 'running' | 'succeeded' | 'failed'

export interface WorkspaceCanvasArtifactPhaseLabels {
  readonly running: string
  readonly succeeded: string
  readonly failed: string
}

export interface WorkspaceCanvasArtifactPresentation {
  readonly artifactPhase: WorkspaceCanvasArtifactPhase
  readonly statusLabel: string
  readonly isRunning: boolean
}

export function workspaceCanvasArtifactPresentation(
  phase: WorkspaceCanvasArtifactPhase,
  labels: WorkspaceCanvasArtifactPhaseLabels,
): WorkspaceCanvasArtifactPresentation {
  return {
    artifactPhase: phase,
    statusLabel: labels[phase],
    isRunning: phase === 'running',
  }
}

export function workspaceCanvasSucceededPresentation(
  labels: WorkspaceCanvasArtifactPhaseLabels,
): WorkspaceCanvasArtifactPresentation {
  return workspaceCanvasArtifactPresentation('succeeded', labels)
}

export function workspaceCanvasRunningPresentation(
  labels: WorkspaceCanvasArtifactPhaseLabels,
): WorkspaceCanvasArtifactPresentation {
  return workspaceCanvasArtifactPresentation('running', labels)
}

export function workspaceCanvasFailedPresentation(
  labels: WorkspaceCanvasArtifactPhaseLabels,
): WorkspaceCanvasArtifactPresentation {
  return workspaceCanvasArtifactPresentation('failed', labels)
}

export function workspaceCanvasArtifactPhaseFromTerminalStatus(
  status: string | null | undefined,
): Exclude<WorkspaceCanvasArtifactPhase, 'running'> | null {
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

export function workspaceCanvasArtifactPhaseFromTaskBackedStatus(
  status: string | null | undefined,
): WorkspaceCanvasArtifactPhase | null {
  const terminalPhase = workspaceCanvasArtifactPhaseFromTerminalStatus(status)
  if (terminalPhase) return terminalPhase
  if (
    status === 'generating'
    || status === 'planning'
    || status === 'queued'
    || status === 'processing'
  ) return 'running'
  return null
}
