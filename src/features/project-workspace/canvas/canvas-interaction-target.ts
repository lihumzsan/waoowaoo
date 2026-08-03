const WORKSPACE_CANVAS_INTERACTION_ATTRIBUTE = 'data-workspace-canvas-interaction'
const WORKSPACE_CANVAS_IMAGE_PREVIEW_INTERACTION = 'image-preview'

/**
 * Shared DOM marker for the image-preview surface inside a ReactFlow node.
 * The renderer opens the preview; the Canvas selection owner consumes the
 * same marker so that one pointer intent cannot also open node details.
 */
export const workspaceCanvasImagePreviewTargetProps = {
  [WORKSPACE_CANVAS_INTERACTION_ATTRIBUTE]: WORKSPACE_CANVAS_IMAGE_PREVIEW_INTERACTION,
} as const

export function isWorkspaceCanvasImagePreviewTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(
    `[${WORKSPACE_CANVAS_INTERACTION_ATTRIBUTE}="${WORKSPACE_CANVAS_IMAGE_PREVIEW_INTERACTION}"]`,
  ) !== null
}
