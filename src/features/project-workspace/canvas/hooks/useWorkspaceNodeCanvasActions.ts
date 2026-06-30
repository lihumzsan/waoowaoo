'use client'

import { useCallback } from 'react'
import { useWorkspaceRuntime } from '../../WorkspaceRuntimeContext'
import type { WorkspaceCanvasNodeAction } from '../node-canvas-types'

export function useWorkspaceNodeCanvasActions() {
  const runtime = useWorkspaceRuntime()

  return useCallback(async (action: WorkspaceCanvasNodeAction) => {
    if (action.type === 'open_asset_library') {
      runtime.onOpenAssetLibraryForCharacter(action.characterId ?? null)
      return
    }

    if (action.type === 'generate_edit_screenplay') {
      await runtime.onGenerateEditScreenplay({
        prompt: action.prompt,
        durationTier: action.durationTier,
        aspectRatio: action.aspectRatio,
      })
      return
    }

    if (action.type === 'generate_edit_script') {
      await runtime.onGenerateEditScript(action.screenplayId)
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

    if (action.type === 'generate_image') {
      await runtime.onGeneratePanelImage(action.panelId)
      return
    }

    if (action.type === 'generate_storyboard_grid_images') {
      await runtime.onGenerateStoryboardGridImages({
        episodeId: action.episodeId,
        editScriptId: action.editScriptId,
        sourceGenerationSegmentId: action.sourceGenerationSegmentId,
        panelIds: action.panelIds,
        generationMode: action.generationMode,
      })
      return
    }

    if (action.type === 'select_candidate') {
      await runtime.onSelectPanelCandidate(action.panelId, action.imageUrl)
      return
    }

    if (action.type === 'cancel_candidate') {
      await runtime.onCancelPanelCandidate(action.panelId)
      return
    }

    if (action.type === 'generate_video') {
      await runtime.onGenerateVideo(
        action.storyboardId,
        action.panelIndex,
        action.generationOptions,
        action.panelId,
      )
      return
    }

    if (action.type === 'update_video_prompt') {
      await runtime.onUpdateVideoPrompt(action.storyboardId, action.panelIndex, action.value, action.field)
      return
    }

    if (action.type === 'update_video_plan_prompt') {
      await runtime.onUpdateGenerationSegmentContinuity(action.editScriptId, action.segmentIndex, action.continuity)
      return
    }

    if (action.type === 'open_video_block_arrangement') {
      throw new Error('open_video_block_arrangement must be handled by the canvas arrangement bridge')
    }

    if (action.type === 'update_edit_asset_requirement_description') {
      await runtime.onUpdateEditAssetRequirementDescription(action.editScriptId, action.requirementId, action.description)
      return
    }

    if (action.type === 'update_panel_video_model') {
      await runtime.onUpdatePanelVideoModel(action.storyboardId, action.panelIndex, action.model)
      return
    }

    if (action.type === 'generate_all_videos') {
      await runtime.onGenerateAllVideos({
        generationOptions: action.generationOptions,
      })
      return
    }

    if (action.type === 'generate_video_group') {
      await runtime.onGenerateAllVideos({
        generationOptions: action.generationOptions,
        mode: 'grid',
        gridMode: action.gridMode,
        shotNumbers: action.shotNumbers,
      })
      return
    }

    if (action.type === 'generate_asset_reference_video') {
      await runtime.onGenerateAllVideos({
        generationOptions: action.generationOptions,
        mode: 'asset-reference',
        segmentIndex: action.segmentIndex,
        referenceImageUrls: action.referenceImageUrls,
      })
      return
    }

    if (action.type === 'render_final_video') {
      await runtime.onRenderFinalVideo()
      return
    }

    if (action.type === 'generate_bgm_score') {
      await runtime.onGenerateBgmScore()
      return
    }

    if (action.type === 'generate_edit_assets') {
      await runtime.onGenerateEditAssets(action.editScriptId)
      return
    }

    if (action.type === 'generate_edit_asset') {
      await runtime.onGenerateEditAssets(action.editScriptId, action.requirementId)
      return
    }

    if (action.type === 'regenerate_edit_asset_image') {
      await runtime.onRegenerateProjectAssetImage(action.assetId, action.kind)
      return
    }

    if (action.type === 'generate_edit_storyboard') {
      await runtime.onGenerateEditStoryboard(action.editScriptId)
      return
    }

  }, [runtime])
}
