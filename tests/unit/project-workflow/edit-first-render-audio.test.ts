import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowStateFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'

describe('edit-first workflow state', () => {
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
    expect(state.allowedOperationIds).toEqual(['render_chapters'])
  })

  it('prioritizes rendering ready chapters while later episode video segments are still missing', () => {
    const state = resolveEditFirstWorkflowStateFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      storyboardCount: 2,
      panelCount: 6,
      storyboardPanelImageReadyCount: 6,
      storyboardPanelImageMissingCount: 0,
      videoPlanSegmentCount: 4,
      completedVideoSegmentCount: 2,
      chapterCount: 2,
      renderableChapterCount: 1,
      completedChapterRenderCount: 0,
    }))

    expect(state.stage).toBe('ready_to_generate_videos')
    expect(state.nextAction?.operationId).toBe('render_chapters')
    expect(state.allowedOperationIds).toEqual([
      'render_chapters',
      'generate_episode_videos',
    ])
  })

  it('requires audio layer generation after all chapter renders are ready', () => {
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

    expect(state.stage).toBe('ready_to_generate_audio_layers')
    expect(state.nextAction?.operationId).toBe('generate_episode_bgm_score')
    expect(state.allowedOperationIds).toEqual([
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
    ])
  })

  it('blocks final render while required BGM is generating', () => {
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

    expect(state.stage).toBe('bgm_score_generating')
    expect(state.nextAction).toBeNull()
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual(['plan_episode_soundscape'])
  })

  it('requires explicit BGM regeneration after a BGM task fails', () => {
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
      bgmScoreStatus: 'failed',
    }))

    expect(state.stage).toBe('failed')
    expect(state.nextAction?.operationId).toBe('generate_episode_bgm_score')
    expect(state.allowedOperationIds).toEqual(['generate_episode_bgm_score'])
  })

  it('allows final render after videos, chapters, and required BGM are ready', () => {
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
      soundscapeStatus: 'completed',
      soundscapeDecision: 'none_needed',
    }))

    expect(state.stage).toBe('ready_to_render_final')
    expect(state.nextAction?.operationId).toBe('render_final_video')
    expect(state.allowedOperationIds).toEqual(['render_final_video'])
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
    expect(state.allowedOperationIds).toEqual([])
  })
})
