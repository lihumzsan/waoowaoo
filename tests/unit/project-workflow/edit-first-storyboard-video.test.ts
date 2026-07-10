import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowCapabilityOperationIds,
  resolveEditFirstWorkflowStateFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
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

  it('does not advance to video generation when some chapters have no storyboard', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
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
    expect(state.nextAction?.approvalKind).toBe('billable_media')
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
})
