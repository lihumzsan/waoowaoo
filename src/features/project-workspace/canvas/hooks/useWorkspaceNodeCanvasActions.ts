'use client'

import { useCallback } from 'react'
import { useWorkspaceRuntime } from '../../WorkspaceRuntimeContext'
import type { WorkspaceCanvasNodeAction } from '../node-canvas-types'
import { isWorkspaceCanvasBillableAction } from './useWorkspaceCanvasBillableAction'

export function useWorkspaceNodeCanvasActions() {
  const runtime = useWorkspaceRuntime()

  return useCallback(async (action: WorkspaceCanvasNodeAction) => {
    if (isWorkspaceCanvasBillableAction(action)) {
      throw new Error(`WORKSPACE_CANVAS_BILLABLE_ACTION_BYPASS:${action.type}`)
    }
    if (action.type === 'open_asset_library') {
      runtime.onOpenAssetLibraryForCharacter(action.characterId ?? null)
      return
    }

    if (action.type === 'ingest_script') {
      await runtime.onGenerateEditBible({
        prompt: action.prompt,
      })
      return
    }

    if (action.type === 'generate_edit_script') {
      await runtime.onGenerateEditScript()
      return
    }

    if (action.type === 'generate_edit_shot_execution_plan') {
      await runtime.onGenerateEditShotExecutionPlan(action.editScriptId)
      return
    }

    if (action.type === 'update_panel') {
      throw new Error('update_panel must be handled by the canvas detail command bridge')
    }

    if (action.type === 'delete_panel') {
      throw new Error('delete_panel must be handled by the canvas detail command bridge')
    }

    if (action.type === 'copy_panel') {
      throw new Error('copy_panel must be handled by the canvas detail command bridge')
    }

    if (action.type === 'update_video_prompt') {
      await runtime.onUpdateVideoPrompt(action.storyboardId, action.panelIndex, action.value, action.field)
      return
    }

    if (action.type === 'update_edit_asset_requirement_description') {
      await runtime.onUpdateEditAssetRequirementDescription(action.editScriptId, action.requirementId, action.description)
      return
    }

    if (action.type === 'update_panel_video_model') {
      await runtime.onUpdatePanelVideoModel(action.storyboardId, action.panelIndex, action.model)
      return
    }

    if (action.type === 'render_final_video') {
      await runtime.onRenderFinalVideo()
      return
    }

    if (action.type === 'plan_soundscape') {
      await runtime.onPlanSoundscape()
      return
    }

  }, [runtime])
}
