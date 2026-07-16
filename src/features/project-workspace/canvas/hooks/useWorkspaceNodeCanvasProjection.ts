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
    projectId, episodeId, episodeName,
    editBible, editScript, editScripts, editShotExecutionPlans, projectCharacters, projectLocations,
    activeTaskTargets, editScriptPending, streamTargets,
    finalVideo, videoSegments, defaultVideoModel, creativeResources,
    savedLayouts, translate, onAction,
  } = input
  return useMemo(() => buildWorkspaceNodeCanvasProjection({
    projectId, episodeId, episodeName,
    editBible, editScript, editScripts, editShotExecutionPlans, projectCharacters, projectLocations,
    activeTaskTargets, editScriptPending, streamTargets,
    finalVideo, videoSegments, defaultVideoModel, creativeResources,
    savedLayouts, translate, onAction,
  }), [
    projectId, episodeId, episodeName,
    editBible, editScript, editScripts, editShotExecutionPlans, projectCharacters, projectLocations,
    activeTaskTargets, editScriptPending, streamTargets,
    finalVideo, videoSegments, defaultVideoModel, creativeResources,
    savedLayouts, translate, onAction,
  ])
}
