'use client'

import { useMemo } from 'react'
import type { WorkspaceCanvasProjection } from '../node-canvas-types'
import {
  buildWorkspaceNodeCanvasProjection,
  type BuildWorkspaceNodeCanvasProjectionInput,
} from '../projection/workspace-node-canvas-projection'

export {
  buildWorkspaceNodeCanvasProjection,
  type BuildWorkspaceNodeCanvasProjectionInput,
} from '../projection/workspace-node-canvas-projection'

export function useWorkspaceNodeCanvasProjection(
  input: BuildWorkspaceNodeCanvasProjectionInput,
): WorkspaceCanvasProjection {
  const {
    projectId, episodeName, projectAspectRatio, creativeResources, savedLayouts, translate,
  } = input
  return useMemo(() => buildWorkspaceNodeCanvasProjection({
    projectId, episodeName, projectAspectRatio, creativeResources, savedLayouts, translate,
  }), [
    projectId, episodeName, projectAspectRatio, creativeResources, savedLayouts, translate,
  ])
}
