import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowViewFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
  it('fails closed when a ready shot plan is missing its automatic storyboard projection', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('shot_execution')
    expect(state.status.kind).toBe('failed')
    expect(state.status.reason).toBe('ready shot execution plan is missing its automatic storyboard projection')
    expect(state.operationPolicy.recommendedAction).toBeNull()
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('does not advance to video generation when some chapters have no storyboard', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      chapterCount: 2,
      storyboardCount: 1,
      panelCount: 3,
      storyboardPanelImagePromptMissingCount: 0,
      storyboardPanelVideoPromptMissingCount: 0,
      storyboardPanelImageReadyCount: 3,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
    }))

    expect(state.step).toBe('shot_execution')
    expect(state.status.kind).toBe('failed')
    expect(state.status.reason).toBe('ready shot execution plan is missing its automatic storyboard projection')
    expect(state.operationPolicy.recommendedAction).toBeNull()
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('fails explicitly when generated storyboard panels are missing deterministic prompts', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('storyboard_images')
    expect(state.status.kind).toBe('failed')
    expect(state.status.reason).toBe('storyboard panel prompt facts are incomplete')
    expect(state.operationPolicy.recommendedAction).toBeNull()
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('offers billable storyboard images immediately after automatic panels are materialized', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('storyboard_images')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_edit_script_storyboard_images')
  })

  it('fails explicitly when generated storyboard panels are missing video prompts', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('storyboard_images')
    expect(state.status.kind).toBe('failed')
    expect(state.status.reason).toBe('storyboard panel prompt facts are incomplete')
    expect(state.operationPolicy.recommendedAction).toBeNull()
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('allows video generation only after image and video prompts are ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('video_segments')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_episode_videos')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_episode_videos'])
  })

  it('does not expose BGM while video segments are generating because chapter renders are not ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('video_segments')
    expect(state.status.kind).toBe('processing')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('does not allow final render until every video segment has output even when BGM is ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
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

    expect(state.step).toBe('video_segments')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_episode_videos')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_episode_videos'])
  })
})
