export type WorkspaceCanvasMotionPresenceAction =
  | 'idle'
  | 'show'
  | 'hide'
  | 'schedule_exit'

/**
 * Resolves the only state transition that Canvas motion presence may perform.
 * React children intentionally do not participate: their identity changes on
 * ordinary parent renders and must never be treated as a lifecycle event.
 */
export function resolveWorkspaceCanvasMotionPresenceAction(input: {
  readonly visible: boolean
  readonly exit: boolean
  readonly rendered: boolean
}): WorkspaceCanvasMotionPresenceAction {
  if (input.visible) return input.rendered ? 'idle' : 'show'
  if (!input.rendered) return 'idle'
  return input.exit ? 'schedule_exit' : 'hide'
}
