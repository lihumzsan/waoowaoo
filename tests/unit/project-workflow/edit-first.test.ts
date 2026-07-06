import { describe, expect, it } from 'vitest'
import {
  resolveEditFirstWorkflowCapabilityOperationIds,
  resolveEditFirstWorkflowStateFromSnapshot,
  type EditFirstWorkflowSnapshot,
} from '@/lib/project-workflow/edit-first'

function snapshot(overrides: Partial<EditFirstWorkflowSnapshot> = {}): EditFirstWorkflowSnapshot {
  return {
    hasEpisode: true,
    hasBible: false,
    bibleStatus: null,
    stylePreviewCount: 0,
    completedStylePreviewCount: 0,
    confirmedStylePreviewCount: 0,
    failedStylePreviewCount: 0,
    hasEditScript: false,
    activeEditScriptTaskCount: 0,
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
    storyboardPanelImageReadyCount: 0,
    storyboardPanelImageMissingCount: 0,
    storyboardPanelImageFailedCount: 0,
    activeStoryboardImageTaskCount: 0,
    videoPlanSegmentCount: 0,
    completedVideoSegmentCount: 0,
    failedVideoSegmentCount: 0,
    activeVideoTaskCount: 0,
    chapterCount: 0,
    completedChapterRenderCount: 0,
    failedChapterRenderCount: 0,
    activeChapterRenderTaskCount: 0,
    bgmScoreStatus: null,
    bgmScoreHasMix: false,
    activeBgmScoreTaskCount: 0,
    finalRenderStatus: null,
    finalRenderHasOutput: false,
    activeFinalRenderTaskCount: 0,
    ...overrides,
  }
}

describe('edit-first workflow state', () => {
  it('ingests source script first with explicit confirmation', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot())

    expect(state.stage).toBe('ready_to_ingest_script')
    expect(state.nextAction?.operationId).toBe('ingest_script')
    expect(state.nextAction?.requiresUserConfirmation).toBe(true)
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['ingest_script'])
  })

  it('goes from confirmed style bible to chapter planning', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 2,
      confirmedStylePreviewCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_edit_script')
    expect(state.nextAction?.operationId).toBe('plan_chapters')
    expect(state.allowedOperationIds).toEqual(['plan_chapters'])
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['plan_chapters'])
  })

  it('treats submitted chapter planning tasks as an active edit-script generation edge', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      activeEditScriptTaskCount: 2,
    }))

    expect(state.stage).toBe('edit_script_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })

  it('waits for required assets and spatial profiles before shot execution planning', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
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
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
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
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
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
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
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

  it('fails explicitly when generated storyboard panels are missing deterministic prompts', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
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

    expect(state.stage).toBe('failed')
    expect(state.blocking.reason).toBe('storyboard panel prompt facts are incomplete')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard')
  })

  it('generates storyboard images after image prompts are composed', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
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

  it('fails explicitly when generated storyboard panels are missing video prompts', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 0,
      storyboardPanelVideoPromptMissingCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
    }))

    expect(state.stage).toBe('failed')
    expect(state.blocking.reason).toBe('storyboard panel prompt facts are incomplete')
    expect(state.nextAction?.operationId).toBe('generate_edit_script_storyboard')
  })

  it('allows video generation only after image and video prompts are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 0,
      storyboardPanelVideoPromptMissingCount: 0,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 1,
    }))

    expect(state.stage).toBe('ready_to_generate_videos')
    expect(state.nextAction?.operationId).toBe('generate_episode_videos')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_episode_videos'])
  })

  it('does not expose BGM while video segments are generating because chapter renders are not ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 1,
      activeVideoTaskCount: 1,
    }))

    expect(state.stage).toBe('videos_generating')
    expect(state.blocking.kind).toBe('processing')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })

  it('does not allow final render until every video segment has output even when BGM is ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 1,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
    }))

    expect(state.stage).toBe('ready_to_generate_videos')
    expect(state.nextAction?.operationId).toBe('generate_episode_videos')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['generate_episode_videos'])
  })

  it('renders chapters after all video segments are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 0,
    }))

    expect(state.stage).toBe('ready_to_render_chapters')
    expect(state.nextAction?.operationId).toBe('render_chapters')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['render_chapters'])
  })

  it('allows final render after all chapter renders are ready and keeps BGM optional', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
    }))

    expect(state.stage).toBe('ready_to_render_final')
    expect(state.nextAction?.operationId).toBe('render_final_video')
    expect(state.nextAction?.requiresUserConfirmation).toBe(true)
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([
      'render_final_video',
      'generate_episode_bgm_score',
    ])
  })

  it('does not block final render while optional BGM is generating', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      bgmScoreStatus: 'generating',
      activeBgmScoreTaskCount: 1,
    }))

    expect(state.stage).toBe('ready_to_render_final')
    expect(state.nextAction?.operationId).toBe('render_final_video')
    expect(state.blocking.kind).toBe('needs_confirmation')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['render_final_video'])
  })

  it('allows final render after videos, chapters, and optional BGM are ready', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
    }))

    expect(state.stage).toBe('ready_to_render_final')
    expect(state.nextAction?.operationId).toBe('render_final_video')
    expect(state.nextAction?.requiresUserConfirmation).toBe(true)
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual(['render_final_video'])
  })

  it('tracks final render processing before completion', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
      finalRenderStatus: 'processing',
      activeFinalRenderTaskCount: 1,
    }))

    expect(state.stage).toBe('final_rendering')
    expect(state.blocking.kind).toBe('processing')
  })

  it('marks the workflow completed only when final render has output', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
      finalRenderStatus: 'completed',
      finalRenderHasOutput: true,
    }))

    expect(state.stage).toBe('completed')
    expect(resolveEditFirstWorkflowCapabilityOperationIds(state)).toEqual([])
  })
})
