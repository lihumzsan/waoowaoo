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
    hasEditScript: false,
    editScriptStatus: null,
    editScriptAssetReviewStatus: null,
    editAssetRequirementCount: 0,
    pendingAssetRequirementCount: 0,
    generatingAssetRequirementCount: 0,
    requiredLocationSpatialProfileCount: 0,
    readyLocationSpatialProfileCount: 0,
    hasShotExecutionPlan: false,
    shotExecutionPlanStatus: null,
    storyboardCount: 0,
    storyboardPanelPromptFailed: false,
    activeStoryboardPanelTaskCount: 0,
    panelCount: 0,
    storyboardPanelImagePromptMissingCount: 0,
    storyboardPanelVideoPromptMissingCount: 0,
    imagePromptComposeFailed: false,
    videoPromptComposeFailed: false,
    activeImagePromptComposeTaskCount: 0,
    activeVideoPromptComposeTaskCount: 0,
    videoGroupPromptMissingCount: 0,
    storyboardPanelImageReadyCount: 0,
    storyboardPanelImageMissingCount: 0,
    storyboardPanelImageFailedCount: 0,
    activeStoryboardImageTaskCount: 0,
    ...overrides,
  }
}

describe('edit-first workflow state', () => {
  it('generates screenplay first without user confirmation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot())

    expect(state.stage).toBe('ready_to_generate_screenplay')
    expect(state.nextAction?.operationId).toBe('generate_edit_screenplay')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_screenplay'])
  })

  it('goes from confirmed style bible directly to the core edit plan', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      stylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_edit_script')
    expect(state.nextAction?.operationId).toBe('generate_edit_script')
    expect(state.allowedOperationIds).toEqual(['generate_edit_script'])
  })

  it('waits for required assets and spatial profiles before shot execution planning', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      pendingAssetRequirementCount: 1,
      generatingAssetRequirementCount: 1,
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 0,
    }))

    expect(state.stage).toBe('assets_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual([])
  })

  it('requires asset review before shot execution planning when reusable assets exist', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'pending',
      editAssetRequirementCount: 2,
      pendingAssetRequirementCount: 0,
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 1,
    }))

    expect(state.stage).toBe('assets_ready_for_review')
    expect(state.blocking.kind).toBe('needs_user_choice')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['revise_edit_script_assets'])
  })

  it('generates shot execution plan after core plan, assets, and spatial profiles are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      editScriptAssetReviewStatus: 'approved',
      editAssetRequirementCount: 2,
      pendingAssetRequirementCount: 0,
      requiredLocationSpatialProfileCount: 1,
      readyLocationSpatialProfileCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_shot_execution_plan')
    expect(state.nextAction?.operationId).toBe('generate_edit_shot_execution_plan')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_shot_execution_plan'])
  })

  it('generates storyboard panels after shot execution plan is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      panelCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_storyboard')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_edit_script_storyboard'])
  })

  it('composes image prompts when panels exist without final image prompts', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 2,
      storyboardPanelImageReadyCount: 1,
      storyboardPanelImageMissingCount: 2,
    }))

    expect(state.stage).toBe('ready_to_compose_image_prompts')
    expect(state.nextAction?.operationId).toBe('compose_edit_image_prompts')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
  })

  it('generates storyboard images after image prompts are composed', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 0,
      storyboardPanelImageReadyCount: 1,
      storyboardPanelImageMissingCount: 2,
    }))

    expect(state.stage).toBe('ready_to_generate_storyboard_images')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard_images')
    expect(state.nextAction?.requiresUserConfirmation).toBe(true)
  })

  it('composes video prompts after all storyboard panel images are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 0,
      storyboardPanelVideoPromptMissingCount: 3,
      videoGroupPromptMissingCount: 1,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
    }))

    expect(state.stage).toBe('ready_to_compose_video_prompts')
    expect(state.nextAction?.operationId).toBe('compose_edit_video_prompts')
    expect(state.nextAction?.requiresUserConfirmation).toBe(false)
  })

  it('allows video generation only after image and video prompts are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasScreenplay: true,
      screenplayStatus: 'ready',
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 0,
      storyboardPanelVideoPromptMissingCount: 0,
      videoGroupPromptMissingCount: 0,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_videos')
    expect(state.nextAction?.operationId).toBe('generate_episode_videos')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_episode_videos'])
  })
})
