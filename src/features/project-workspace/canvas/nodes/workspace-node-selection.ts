import { createContext } from 'react'

/**
 * Renderer bridge into ProjectWorkspace's sole controlled Canvas selection.
 * The context owns no state; it only lets explicit card chrome request that
 * the Canvas owner select one durable Resource node.
 */
export const WorkspaceCanvasResourceSelectionContext = createContext<
  ((nodeId: string) => void) | null
>(null)
