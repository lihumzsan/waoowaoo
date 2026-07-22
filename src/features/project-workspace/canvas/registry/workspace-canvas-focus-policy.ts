import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'

/** Focus follows current Task facts; operation names do not encode a pipeline. */
export const WORKSPACE_CANVAS_RUNNING_FOCUS_KIND_PRIORITY = [
  'resourceCard',
] as const satisfies readonly WorkspaceCanvasNodeKind[]
