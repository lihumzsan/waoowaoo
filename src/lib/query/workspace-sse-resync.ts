import { WorkspaceSSESnapshotResyncRequiredError } from './workspace-sse-event-sequence'

export function isWorkspaceSseImmediateResyncError(
  error: unknown,
): error is WorkspaceSSESnapshotResyncRequiredError {
  return error instanceof WorkspaceSSESnapshotResyncRequiredError
}

export function recoverWorkspaceSseEventError(input: {
  error: unknown
  requestSnapshotResync: () => void
  scheduleResync: (context: string) => void
}): 'immediate_snapshot' | 'backoff' {
  if (isWorkspaceSseImmediateResyncError(input.error)) {
    input.requestSnapshotResync()
    return 'immediate_snapshot'
  }
  input.scheduleResync('event handling failed')
  return 'backoff'
}
