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
    projectId, episodeId, episodeName, storyboards, editFirstWorkflow,
    editBible, editScript, editScripts, editShotExecutionPlan,
    activeTaskTargets, editScriptPending, streamTargets,
    finalVideo, videoGroups, defaultVideoModel, defaultSequenceVideoModel,
    savedLayouts, translate, onAction,
  } = input
  return useMemo(() => buildWorkspaceNodeCanvasProjection({
    projectId, episodeId, episodeName, storyboards, editFirstWorkflow,
    editBible, editScript, editScripts, editShotExecutionPlan,
    activeTaskTargets, editScriptPending, streamTargets,
    finalVideo, videoGroups, defaultVideoModel, defaultSequenceVideoModel,
    savedLayouts, translate, onAction,
  }), [
    projectId, episodeId, episodeName, storyboards, editFirstWorkflow,
    editBible, editScript, editScripts, editShotExecutionPlan,
    activeTaskTargets, editScriptPending, streamTargets,
    finalVideo, videoGroups, defaultVideoModel, defaultSequenceVideoModel,
    savedLayouts, translate, onAction,
  ])
}
