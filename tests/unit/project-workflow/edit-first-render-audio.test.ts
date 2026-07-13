import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowStateFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'
import { resolveEditFirstCanvasVisibility } from '@/lib/project-workflow/edit-first-canvas-visibility'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'

function visibilityAt(stage: EditFirstWorkflowStage) {
  return resolveEditFirstCanvasVisibility({
    active: true,
    stage,
    blocking: { kind: 'none', reason: null },
    nextAction: null,
    allowedOperationIds: [],
    operationGroup: null,
  })
}

describe('edit-first workflow state', () => {
  /**
   * Logic Specification
   * Authority: CN-02/CN-07 and the canonical edit-first stage order.
   * Rejects: showing BGM or soundscape nodes before video and chapter rendering finish.
   * Production entry: resolveEditFirstCanvasVisibility.
   * Oracle: audio nodes are hidden through chapter rendering and visible when audio planning starts.
   * Command: npx vitest run tests/unit/project-workflow/edit-first-render-audio.test.ts
   */
  it('reveals audio nodes only when the workflow reaches audio planning', () => {
    expect(visibilityAt('ready_to_generate_videos')).toMatchObject({ bgmScore: false, soundscape: false })
    expect(visibilityAt('chapters_rendering')).toMatchObject({ bgmScore: false, soundscape: false })
    expect(visibilityAt('ready_to_plan_audio_layers')).toMatchObject({ bgmScore: true, soundscape: true })
  })

  it('materializes active audio Tasks while the workflow context catches up', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: {
        active: true,
        stage: 'chapters_rendering',
        blocking: { kind: 'processing', reason: 'chapter renders are still running' },
        nextAction: null,
        allowedOperationIds: [],
        operationGroup: null,
      },
      activeTaskTargets: [
        {
          taskId: 'bgm-task-1',
          targetType: 'ProjectEpisode',
          targetId: 'episode-1',
          types: ['music_score_plan'],
        },
        {
          taskId: 'soundscape-task-1',
          targetType: 'ProjectEpisode',
          targetId: 'episode-1',
          types: ['soundscape_plan'],
        },
      ],
      savedLayouts: [],
      translate: (key) => key,
    })

    expect(projection.nodes.filter((node) => (
      node.data.kind === 'bgmScore' || node.data.kind === 'soundscape'
    )).map((node) => node.id)).toEqual([
      workspaceNodeId.bgmScore('episode-1'),
      workspaceNodeId.soundscape('episode-1'),
    ])
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

  it('groups music and soundscape planning after all chapter renders are ready', () => {
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

    expect(state.stage).toBe('ready_to_plan_audio_layers')
    expect(state.nextAction?.operationId).toBe('plan_episode_bgm_score')
    expect(state.allowedOperationIds).toEqual([
      'plan_episode_bgm_score',
      'plan_episode_soundscape',
    ])
    expect(state.operationGroup).toEqual({
      id: 'edit_first_audio_layer_planning',
      operationIds: ['plan_episode_bgm_score', 'plan_episode_soundscape'],
      approvalOperationIds: [],
    })
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
      bgmScoreHasPlan: true,
      bgmScoreStatus: 'generating',
      activeBgmScoreGenerationTaskCount: 1,
      soundscapeStatus: 'completed',
      soundscapeDecision: 'none_needed',
    }))

    expect(state.stage).toBe('audio_layers_generating')
    expect(state.nextAction).toBeNull()
    expect(state.blocking.kind).toBe('processing')
    expect(state.allowedOperationIds).toEqual([])
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
      bgmScoreHasPlan: true,
      bgmScoreStatus: 'failed',
    }))

    expect(state.stage).toBe('failed')
    expect(state.nextAction?.operationId).toBe('generate_episode_bgm_score')
    expect(state.allowedOperationIds).toEqual(['generate_episode_bgm_score'])
  })

  it('groups the two paid audio generators after both plans are durable', () => {
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
      bgmScoreStatus: 'planned',
      bgmScoreHasPlan: true,
      soundscapeStatus: 'planned',
      soundscapeDecision: 'soundscape',
    }))

    expect(state.stage).toBe('ready_to_generate_audio_layers')
    expect(state.allowedOperationIds).toEqual([
      'generate_episode_bgm_score',
      'generate_episode_soundscape',
    ])
    expect(state.operationGroup).toEqual({
      id: 'edit_first_audio_layer_generation',
      operationIds: ['generate_episode_bgm_score', 'generate_episode_soundscape'],
      approvalOperationIds: ['generate_episode_bgm_score', 'generate_episode_soundscape'],
    })
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
      bgmScoreHasPlan: true,
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
