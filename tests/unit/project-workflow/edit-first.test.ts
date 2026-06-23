import { describe, expect, it } from 'vitest'
import {
  resolveEditFirstWorkflowCapabilityOperationIds,
  resolveEditFirstWorkflowStateFromSnapshot,
  type EditFirstWorkflowSnapshot,
} from '@/lib/project-workflow/edit-first'

function snapshot(overrides: Partial<EditFirstWorkflowSnapshot> = {}): EditFirstWorkflowSnapshot {
  return {
    hasEpisode: true,
    hasScreenplay: false,
    screenplayStatus: null,
    stylePreviewCount: 0,
    completedStylePreviewCount: 0,
    confirmedStylePreviewCount: 0,
    failedStylePreviewCount: 0,
    hasDirectorDecoupage: false,
    directorDecoupageStatus: null,
    hasEditScript: false,
    editScriptStatus: null,
    editScriptAssetReviewStatus: null,
    editAssetRequirementCount: 0,
    pendingAssetRequirementCount: 0,
    generatingAssetRequirementCount: 0,
    requiredLocationSpatialProfileCount: 0,
    readyLocationSpatialProfileCount: 0,
    hasCinematographyShotPlan: false,
    cinematographyShotPlanStatus: null,
    storyboardCount: 0,
    spatialBlockingReady: false,
    spatialBlockingFailed: false,
    activeSpatialBlockingTaskCount: 0,
    storyboardPanelPromptFailed: false,
    activeStoryboardPanelTaskCount: 0,
    panelCount: 0,
    storyboardPanelImageReadyCount: 0,
    storyboardPanelImageMissingCount: 0,
    storyboardPanelImageFailedCount: 0,
    activeStoryboardImageTaskCount: 0,
    ...overrides,
  }
}

describe('edit-first workflow state', () => {
  it('exposes initial screenplay generation without an execution approval block', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot())

    expect(state.stage).toBe('ready_to_generate_screenplay')
    expect(state.blocking.kind).toBe('none')
    expect(state.nextAction?.operationId).toBe('generate_edit_screenplay')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.allowedOperationIds).toEqual(['generate_edit_screenplay'])
  })

  it('requires screenplay review before style preview generation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'screenplay_ready',
    }))

    expect(state.stage).toBe('screenplay_ready_for_review')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.nextAction?.operationId).toBe('generate_edit_style_previews')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.allowedOperationIds).toEqual(['generate_edit_style_previews', 'revise_edit_screenplay'])
  })

  it('blocks later operations while style preview images are generating', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_generating',
      stylePreviewCount: 3,
      completedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('style_preview_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.nextAction).toBeNull()
    expect(state.allowedOperationIds).toEqual([])
  })

  it('keeps generating when one style preview failed but other candidates are still pending', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_generating',
      stylePreviewCount: 3,
      failedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('style_preview_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.nextAction).toBeNull()
    expect(state.allowedOperationIds).toEqual([])
  })

  it('requires user style choice before director decoupage', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_ready',
      stylePreviewCount: 3,
      completedStylePreviewCount: 3,
    }))

    expect(state.stage).toBe('needs_style_choice')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.nextAction).toBeNull()
    expect(state.allowedOperationIds).toEqual(['generate_edit_style_previews'])
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_style_previews'])
  })

  it('allows choosing a completed style preview when sibling style preview tasks failed', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_generating',
      stylePreviewCount: 2,
      completedStylePreviewCount: 1,
      failedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('needs_style_choice')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.allowedOperationIds).toEqual(['generate_edit_style_previews'])
  })

  it('regenerates style previews instead of screenplay when all style preview tasks failed', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'style_preview_generating',
      stylePreviewCount: 2,
      failedStylePreviewCount: 2,
    }))

    expect(state.stage).toBe('failed')
    expect(state.blocking.reason).toBe('all style preview generation tasks failed')
    expect(state.nextAction?.operationId).toBe('generate_edit_style_previews')
    expect(state.allowedOperationIds).toEqual(['generate_edit_style_previews'])
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_style_previews'])
  })

  it('allows only director decoupage after screenplay is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      stylePreviewCount: 3,
      completedStylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_director_decoupage')
    expect(state.nextAction?.operationId).toBe('generate_edit_director_decoupage')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.blocking.kind).toBe('none')
    expect(state.allowedOperationIds).toEqual(['generate_edit_director_decoupage'])
    expect(state.allowedOperationIds).not.toContain('revise_edit_screenplay')
  })

  it('ignores failed sibling style previews after one style preview is confirmed', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      stylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
      failedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_director_decoupage')
    expect(state.nextAction?.operationId).toBe('generate_edit_director_decoupage')
    expect(state.allowedOperationIds).toEqual(['generate_edit_director_decoupage'])
  })

  it('moves to edit core table only after director decoupage is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
    }))

    expect(state.stage).toBe('ready_to_generate_edit_script')
    expect(state.nextAction?.operationId).toBe('generate_edit_script')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.blocking.kind).toBe('none')
    expect(state.allowedOperationIds).toEqual(['generate_edit_script'])
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script'])
  })

  it('exposes asset generation after edit core table is ready and requirements are pending', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      pendingAssetRequirementCount: 2,
    }))

    expect(state.stage).toBe('ready_to_generate_assets')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_assets')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.blocking.kind).toBe('none')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_assets'])
  })

  it('keeps asset stage processing while generated assets or spatial profiles are still running', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      pendingAssetRequirementCount: 1,
      generatingAssetRequirementCount: 1,
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 0,
    }))

    expect(state.stage).toBe('assets_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })

  it('requires user asset review after edit core table assets and spatial profiles are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'pending',
      editAssetRequirementCount: 2,
      pendingAssetRequirementCount: 0,
      requiredLocationSpatialProfileCount: 2,
      readyLocationSpatialProfileCount: 2,
    }))

    expect(state.stage).toBe('assets_ready_for_review')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(state.nextAction).toBeNull()
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['revise_edit_script_assets'])
  })

  it('moves to cinematography after required assets are approved by the user', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'approved',
      editAssetRequirementCount: 2,
      pendingAssetRequirementCount: 0,
      requiredLocationSpatialProfileCount: 2,
      readyLocationSpatialProfileCount: 2,
    }))

    expect(state.stage).toBe('ready_to_generate_cinematography')
    expect(state.nextAction?.operationId).toBe('generate_edit_cinematography_shot_plan')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.blocking.kind).toBe('none')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_cinematography_shot_plan'])
  })

  it('does not require asset review when the edit script has no reusable asset requirements', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'pending',
      editAssetRequirementCount: 0,
      pendingAssetRequirementCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_cinematography')
    expect(state.nextAction?.operationId).toBe('generate_edit_cinematography_shot_plan')
  })

  it('requires spatial blocking after cinematography before storyboard panel generation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      spatialBlockingReady: false,
      panelCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_storyboard_spatial_blocking')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard_spatial_blocking')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.blocking.kind).toBe('none')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_storyboard_spatial_blocking'])
  })

  it('does not expose storyboard panel generation while spatial blocking is still running', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      spatialBlockingReady: false,
      activeSpatialBlockingTaskCount: 1,
      panelCount: 0,
    }))

    expect(state.stage).toBe('storyboard_spatial_blocking_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.nextAction).toBeNull()
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })

  it('offers spatial blocking regeneration when spatial preparation fails', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      spatialBlockingReady: false,
      spatialBlockingFailed: true,
      panelCount: 0,
    }))

    expect(state.stage).toBe('failed')
    expect(state.blocking).toEqual({
      kind: 'failed',
      reason: 'storyboard spatial blocking generation failed',
    })
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard_spatial_blocking')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_storyboard_spatial_blocking'])
  })

  it('allows storyboard panel generation only after spatial blocking is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      spatialBlockingReady: true,
      panelCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_storyboard')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(state.blocking.kind).toBe('none')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_storyboard'])
  })

  it('does not expose storyboard panel regeneration while panel prompts are generating', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      spatialBlockingReady: true,
      activeStoryboardPanelTaskCount: 1,
      panelCount: 0,
    }))

    expect(state.stage).toBe('storyboard_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.nextAction).toBeNull()
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })

  it('offers storyboard panel regeneration when panel prompt generation fails', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      spatialBlockingReady: true,
      storyboardPanelPromptFailed: true,
      panelCount: 0,
    }))

    expect(state.stage).toBe('failed')
    expect(state.blocking).toEqual({
      kind: 'failed',
      reason: 'storyboard panel prompt generation failed',
    })
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_storyboard'])
  })

  it('does not expose video generation when storyboard panels exist but images are missing', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      storyboardCount: 1,
      spatialBlockingReady: true,
      panelCount: 17,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 14,
    }))

    expect(state.stage).toBe('ready_to_generate_storyboard_images')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard_images')
    expect(state.nextAction?.requiresUserConfirmation).toBe(true)
    expect(state.blocking.kind).toBe('needs_confirmation')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_storyboard_images'])
  })

  it('keeps storyboard image generation blocked while panel image tasks are active', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      storyboardCount: 1,
      spatialBlockingReady: true,
      panelCount: 17,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 14,
      activeStoryboardImageTaskCount: 14,
    }))

    expect(state.stage).toBe('storyboard_images_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })

  it('allows video generation only after all storyboard panel images are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasDirectorDecoupage: true,
      directorDecoupageStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasCinematographyShotPlan: true,
      cinematographyShotPlanStatus: 'ready',
      storyboardCount: 1,
      spatialBlockingReady: true,
      panelCount: 17,
      storyboardPanelImageReadyCount: 17,
      storyboardPanelImageMissingCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_videos')
    expect(state.nextAction?.operationId).toBe('generate_episode_videos')
    expect(state.nextAction?.requiresUserConfirmation).toBe(true)
    expect(state.blocking.kind).toBe('needs_confirmation')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_episode_videos'])
  })
})
