import {
  describe,
  expect,
  it,
  resolveEditFirstWorkflowViewFromSnapshot,
  snapshot,
} from './edit-first-workflow.fixture'
import {
  createEditFirstWorkflowOperationPolicy,
  createEditFirstWorkflowView,
  type EditFirstWorkflowStep,
} from '@/lib/project-workflow/edit-first-view'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import { resolveWorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/workspace-node-runtime'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import type { WorkspaceCanvasStreamPatch } from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'
import { createValidBgmDesign } from '../bgm-design/bgm-design-fixture'
import { TASK_RUNTIME_TARGETS, taskRuntimeTargetQueryKey } from '@/lib/task/runtime-targets'

function capabilitiesAt(step: EditFirstWorkflowStep) {
  return createEditFirstWorkflowView({
    step,
    status: { kind: 'ready', reason: null },
  }).capabilities
}

describe('edit-first workflow state', () => {
  /**
   * Logic Specification
   * Authority: CN-02/CN-07 and the canonical edit-first semantic step order.
   * Rejects: showing BGM before video and chapter rendering finish, or materializing a deleted environment-audio node.
   * Production entry: createEditFirstWorkflowView.
   * Oracle: audio nodes are hidden through chapter rendering and visible when audio planning starts.
   * Command: npx vitest run tests/unit/project-workflow/edit-first-render-audio.test.ts
   */
  it('reveals audio nodes only when the workflow reaches audio planning', () => {
    expect(capabilitiesAt('video_segments')).toMatchObject({ bgmScore: false })
    expect(capabilitiesAt('chapter_render')).toMatchObject({ bgmScore: false })
    expect(capabilitiesAt('audio_plan')).toMatchObject({ bgmScore: true })
    expect(capabilitiesAt('chapter_render').finalTimeline).toBe(false)
    expect(capabilitiesAt('audio_plan').finalTimeline).toBe(false)
    expect(capabilitiesAt('final_render').finalTimeline).toBe(true)
  })

  it('materializes active audio Tasks while the workflow context catches up', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'chapter_render',
        status: { kind: 'processing', reason: 'chapter renders are still running' },
      }),
      activeTaskTargets: [
        {
          taskId: 'bgm-design-task-1',
          targetType: 'ProjectEpisode',
          targetId: 'episode-1',
          types: ['bgm_design_plan'],
        },
      ],
      savedLayouts: [],
      translate: (key) => key,
    })

    expect(projection.nodes.filter((node) => node.data.kind === 'bgmScore').map((node) => node.id)).toEqual([
      workspaceNodeId.bgmScore('episode-1'),
    ])
  })

  it('renders chapters after all video segments are ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 0,
    }))

    expect(state.step).toBe('chapter_render')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('render_chapters')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['render_chapters'])
  })

  it('keeps a stale final-render failure behind missing chapter and audio prerequisites', () => {
    const beforeChapterRender = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 0,
      finalRenderStatus: 'failed',
    }))

    expect(beforeChapterRender.step).toBe('chapter_render')
    expect(beforeChapterRender.operationPolicy.allowedOperationIds).toEqual(['render_chapters'])

    const beforeAudioPlanning = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      finalRenderStatus: 'failed',
    }))

    expect(beforeAudioPlanning.step).toBe('audio_plan')
    expect(beforeAudioPlanning.operationPolicy.allowedOperationIds).toEqual([
      'plan_episode_bgm_design',
    ])
  })

  it('keeps a stale failed final resource visible without an executable final action', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      finalVideo: {
        id: 'final-1',
        episodeId: 'episode-1',
        renderStatus: 'failed',
        renderTaskId: 'final-task-1',
        outputUrl: null,
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'chapter_render',
        status: { kind: 'ready', reason: null },
        operationPolicy: createEditFirstWorkflowOperationPolicy({
          recommendedAction: {
          id: 'render_chapters',
          operationId: 'render_chapters',
          title: 'Render chapter videos',
          },
        }),
      }),
      savedLayouts: [],
      translate: (key) => key,
    })

    const finalNode = projection.nodes.find((node) => node.data.kind === 'finalTimeline')
    expect(finalNode?.id).toBe(workspaceNodeId.finalTimeline('episode-1'))
    expect(finalNode?.data.action).toBeUndefined()
  })

  it('prioritizes rendering ready chapters while later episode video segments are still missing', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 4,
      completedVideoSegmentCount: 2,
      chapterCount: 2,
      renderableChapterCount: 1,
      completedChapterRenderCount: 0,
    }))

    expect(state.step).toBe('video_segments')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('render_chapters')
    expect(state.operationPolicy.allowedOperationIds).toEqual([
      'render_chapters',
      'generate_video_segments',
    ])
  })

  it('offers one BGM design plan after all chapter renders are ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
    }))

    expect(state.step).toBe('audio_plan')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('plan_episode_bgm_design')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['plan_episode_bgm_design'])
    expect(state.operationPolicy.group).toBeNull()
  })

  it('blocks final render while required BGM is generating', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      bgmDesignStatus: 'planned',
      bgmDesignHasPlan: true,
      bgmScoreStatus: 'generating',
      activeBgmScoreGenerationTaskCount: 1,
    }))

    expect(state.step).toBe('audio_generation')
    expect(state.operationPolicy.recommendedAction).toBeNull()
    expect(state.status.kind).toBe('processing')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })

  it('keeps the BGM terminal presentation until the generation Task takes over', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      finalVideo: {
        id: 'final-1',
        episodeId: 'episode-1',
        renderStatus: null,
        renderTaskId: null,
        outputUrl: null,
        updatedAt: '2026-07-15T00:00:00.000Z',
        bgmDesign: {
          id: 'bgm-design-1',
          status: 'planned',
          taskId: 'bgm-design-task-1',
          timelineSignature: 'timeline-1',
          designSignature: 'design-1',
          analysisModel: 'analysis-model',
          musicModel: 'music-model',
          design: createValidBgmDesign(),
          diagnostics: null,
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
        musicScore: {
          id: 'music-score-1',
          status: 'generating',
          taskId: 'bgm-generate-task-1',
          designSignature: 'design-1',
          timelineSignature: 'timeline-1',
          musicModel: 'music-model',
        },
      },
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'audio_generation',
        status: { kind: 'processing', reason: 'BGM generation is running' },
      }),
      savedLayouts: [],
      translate: (key) => key,
    })
    const bgmNode = projection.nodes.find((node) => node.data.kind === 'bgmScore')
    expect(bgmNode?.data.lifecycle.phase).toBe('pending')
    expect(bgmNode?.data.terminalHandoffTaskId).toBe('bgm-design-task-1')
    expect(bgmNode?.data.bgmScoreDetails?.status).toBe('generating')

    const runtimeTarget = TASK_RUNTIME_TARGETS.projectEpisodeBgmScore('episode-1')
    if (!runtimeTarget) throw new Error('BGM_RUNTIME_TARGET_REQUIRED')
    const handoffPatch = {
      nodeId: workspaceNodeId.bgmScore('episode-1'),
      streamKind: 'bgmScore',
      taskId: 'bgm-design-task-1',
      taskType: 'bgm_design_plan',
      terminalHandoff: true,
      presentation: {
        isStreaming: false,
        activeItemKey: 'score-main',
        displayedItemKeys: ['score-main'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: { 'score-main': 1 },
      },
      data: { body: 'frozen BGM design' },
    } as WorkspaceCanvasStreamPatch & { readonly terminalHandoff: true }
    const awaitingGenerationRuntime = resolveWorkspaceCanvasNodeData({
      node: bgmNode!,
      statesByQueryKey: new Map(),
      streamPatch: handoffPatch,
      submitting: false,
    })
    expect(awaitingGenerationRuntime.lifecycle).toMatchObject({ phase: 'pending' })
    expect(awaitingGenerationRuntime.lifecycle.stream).toMatchObject({ isStreaming: false })
    expect(awaitingGenerationRuntime.body).toBe('frozen BGM design')

    const resolved = resolveWorkspaceCanvasNodeData({
      node: bgmNode!,
      statesByQueryKey: new Map([[
        taskRuntimeTargetQueryKey(runtimeTarget),
        {
          phase: 'processing',
          taskId: 'bgm-generate-task-1',
          runningTaskId: 'bgm-generate-task-1',
          runningTaskType: 'music_score_generate',
          progress: 40,
        },
      ]]),
      streamPatch: handoffPatch,
      submitting: false,
    })
    expect(resolved.lifecycle).toMatchObject({
      phase: 'processing',
      taskId: 'bgm-generate-task-1',
      progress: 40,
    })
    expect(resolved.lifecycle.stream).toBeNull()
  })

  it('requires explicit BGM regeneration after a BGM task fails', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      bgmDesignStatus: 'planned',
      bgmDesignHasPlan: true,
      bgmScoreStatus: 'failed',
    }))

    expect(state.step).toBe('audio_generation')
    expect(state.status.kind).toBe('failed')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('generate_episode_bgm_score')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_episode_bgm_score'])
  })

  it('offers only the paid BGM generator selected by the frozen BGM design', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      bgmDesignStatus: 'planned',
      bgmDesignHasPlan: true,
      bgmScoreStatus: 'pending',
    }))

    expect(state.step).toBe('audio_generation')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['generate_episode_bgm_score'])
    expect(state.operationPolicy.group).toBeNull()
  })

  it('allows final render after videos, chapters, and required BGM are ready', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      chapterCount: 1,
      completedChapterRenderCount: 1,
      bgmDesignStatus: 'planned',
      bgmDesignHasPlan: true,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
    }))

    expect(state.step).toBe('final_render')
    expect(state.operationPolicy.recommendedAction?.operationId).toBe('render_final_video')
    expect(state.operationPolicy.allowedOperationIds).toEqual(['render_final_video'])
  })

  it('tracks final render processing before completion', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
      finalRenderStatus: 'processing',
      activeFinalRenderTaskCount: 1,
    }))

    expect(state.step).toBe('final_render')
    expect(state.status.kind).toBe('processing')
  })

  it('marks the workflow completed only when final render has output', () => {
    const state = resolveEditFirstWorkflowViewFromSnapshot(snapshot({
      hasBible: true,
      bibleStatus: 'confirmed',
      stylePreviewCount: 1,
      confirmedStylePreviewCount: 1,
      hasEditScript: true,
      editScriptStatus: 'ready',
      hasShotExecutionPlan: true,
      shotExecutionPlanStatus: 'ready',
      videoPlanSegmentCount: 2,
      completedVideoSegmentCount: 2,
      bgmScoreStatus: 'completed',
      bgmScoreHasMix: true,
      finalRenderStatus: 'completed',
      finalRenderHasOutput: true,
    }))

    expect(state.step).toBe('final_render')
    expect(state.status.kind).toBe('completed')
    expect(state.operationPolicy.allowedOperationIds).toEqual([])
  })
})
