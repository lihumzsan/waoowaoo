import { describe, expect, it } from 'vitest'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import type { ProjectEditScript, ProjectVideoSegment } from '@/types/project'
import {
  createEditFirstWorkflowOperationPolicy,
  createEditFirstWorkflowView,
} from '@/lib/project-workflow/edit-first-view'

/**
 * Logic Specification
 * Authority: CN-01/CN-06/CN-07 and the editScript multi-chapter reference projection.
 * Rejects: waiting for workflow refresh or the first stream item before projecting active shot-plan Tasks.
 * Production entry: buildWorkspaceNodeCanvasProjection.
 * Oracle: one stable node and one canonical Task target per active chapter Task before workflow advances.
 * Command: npx vitest run tests/unit/project-workspace/multi-chapter-shot-execution-projection.test.ts
 */

function editScript(id: string, chapterId: string): ProjectEditScript {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    durationSec: 30,
    shotCount: 0,
    status: 'ready',
    assetReviewStatus: 'approved',
    shots: [],
    generationSegments: [],
    requirements: [],
  }
}

function editScriptWithVideoSegment(
  id: string,
  chapterId: string,
  shotId: string,
  videoSegmentId: string,
): ProjectEditScript {
  return {
    ...editScript(id, chapterId),
    durationSec: 6,
    shotCount: 1,
    shots: [{
      shotId,
      shotNumber: 1,
      shotPurpose: 'action',
      durationSec: 6,
      scene: {
        locationId: `location-${chapterId}`,
        name: `location-${chapterId}`,
        subScene: 'main',
      },
      action: `action-${chapterId}`,
      characters: [],
      dialogue: [],
      synchronousSound: 'room tone',
    }],
    generationSegments: [{
      videoSegmentId,
      segmentId: `segment-${chapterId}`,
      shotIds: [shotId],
      continuity: `continuity-${chapterId}`,
    }],
  }
}

function completedVideoSegment(
  id: string,
  editScriptId: string,
  chapterId: string,
): ProjectVideoSegment {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    editScriptId,
    segmentId: `segment-${chapterId}`,
    inputSignature: 'a'.repeat(64),
    durationSec: 6,
    status: 'completed',
    generationTaskId: `task-${id}`,
    errorMessage: null,
    videoMedia: {
      id: `media-${id}`,
      publicId: id,
      url: `/m/${id}`,
      mimeType: 'video/mp4',
      sizeBytes: null,
      width: null,
      height: null,
      durationMs: 6_000,
    },
  }
}

describe('multi-chapter shot execution Canvas projection', () => {
  it('materializes every active chapter target before workflow and stream catch up', () => {
    const scripts = [
      editScript('edit-script-1', 'chapter-1'),
      editScript('edit-script-2', 'chapter-2'),
    ]
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'planned_assets',
        status: { kind: 'needs_user_choice', reason: 'cached workflow has not observed the submitted Tasks' },
      }),
      editScripts: scripts,
      editShotExecutionPlans: [],
      activeTaskTargets: scripts.map((script) => ({
        taskId: `task-${script.id}`,
        targetType: 'ProjectEditScript',
        targetId: script.id,
        types: ['edit_shot_execution_plan_generate'],
      })),
      savedLayouts: [],
      translate: (key) => key,
    })

    const nodes = projection.nodes.filter((node) => node.data.kind === 'editShotExecutionPlan')
    expect(nodes.map((node) => node.id)).toEqual([
      workspaceNodeId.editShotExecutionPlan('edit-script-1'),
      workspaceNodeId.editShotExecutionPlan('edit-script-2'),
    ])
    expect(nodes.map((node) => node.data.runtimeTargets)).toEqual([
      [{ targetType: 'ProjectEditScript', targetId: 'edit-script-1', types: ['edit_shot_execution_plan_generate'] }],
      [{ targetType: 'ProjectEditScript', targetId: 'edit-script-2', types: ['edit_shot_execution_plan_generate'] }],
    ])
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: workspaceNodeId.editScript('episode-1', 'chapter-1'),
        target: workspaceNodeId.editShotExecutionPlan('edit-script-1'),
      }),
      expect.objectContaining({
        source: workspaceNodeId.editScript('episode-1', 'chapter-2'),
        target: workspaceNodeId.editShotExecutionPlan('edit-script-2'),
      }),
    ]))
  })

  it('projects canonical video Task identities before Segment rows exist', () => {
    const scripts = [
      editScriptWithVideoSegment('edit-script-1', 'chapter-1', 'shot-1', 'video-segment-1'),
      editScriptWithVideoSegment('edit-script-2', 'chapter-2', 'shot-2', 'video-segment-2'),
    ]
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'video_segments',
        status: { kind: 'ready', reason: null },
        operationPolicy: createEditFirstWorkflowOperationPolicy({
          allowedOperationIds: ['generate_video_segments'],
        }),
      }),
      editScripts: scripts,
      editShotExecutionPlans: [],
      videoSegments: [],
      savedLayouts: [],
      translate: (key) => key,
    })

    const nodes = projection.nodes.filter((node) => node.data.kind === 'videoPlan')
    expect(nodes.map((node) => node.data.targetId)).toEqual([
      'video-segment-1',
      'video-segment-2',
    ])
    expect(nodes.map((node) => node.data.runtimeTargets)).toEqual([
      [{ targetType: 'ProjectVideoSegment', targetId: 'video-segment-1', types: ['video_segment'] }],
      [{ targetType: 'ProjectVideoSegment', targetId: 'video-segment-2', types: ['video_segment'] }],
    ])
    expect(nodes.map((node) => node.data.action)).toEqual([
      {
        type: 'generate_video_segments',
        scope: {
          kind: 'segment',
          chapterId: 'chapter-1',
          editScriptId: 'edit-script-1',
          segmentId: 'segment-chapter-1',
        },
      },
      {
        type: 'generate_video_segments',
        scope: {
          kind: 'segment',
          chapterId: 'chapter-2',
          editScriptId: 'edit-script-2',
          segmentId: 'segment-chapter-2',
        },
      },
    ])
  })

  it('projects every completed chapter video in the all-chapters scope', () => {
    const scripts = [
      editScriptWithVideoSegment('edit-script-1', 'chapter-1', 'shot-1', 'video-segment-1'),
      editScriptWithVideoSegment('edit-script-2', 'chapter-2', 'shot-2', 'video-segment-2'),
    ]
    const videoSegments = [
      completedVideoSegment('video-segment-1', 'edit-script-1', 'chapter-1'),
      completedVideoSegment('video-segment-2', 'edit-script-2', 'chapter-2'),
    ]
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editFirstWorkflow: createEditFirstWorkflowView({
        step: 'final_render',
        status: { kind: 'ready', reason: null },
        operationPolicy: createEditFirstWorkflowOperationPolicy({
          allowedOperationIds: ['render_final_video'],
        }),
      }),
      editScript: null,
      editScripts: scripts,
      editShotExecutionPlans: [],
      videoSegments,
      savedLayouts: [],
      translate: (key) => key,
    })

    const nodes = projection.nodes.filter((node) => node.data.kind === 'videoPlan')
    expect(nodes.map((node) => node.id)).toEqual([
      workspaceNodeId.videoPlan('edit-script-1', 1),
      workspaceNodeId.videoPlan('edit-script-2', 1),
    ])
    expect(nodes.map((node) => node.data.videoPlanDetails?.outputUrl)).toEqual([
      '/m/video-segment-1',
      '/m/video-segment-2',
    ])
    expect(nodes.map((node) => node.data.videoPlanDetails?.chapterId)).toEqual([
      'chapter-1',
      'chapter-2',
    ])
    expect(nodes.map((node) => node.data.runtimeTargets)).toEqual([
      [{ targetType: 'ProjectVideoSegment', targetId: 'video-segment-1', types: ['video_segment'] }],
      [{ targetType: 'ProjectVideoSegment', targetId: 'video-segment-2', types: ['video_segment'] }],
    ])
    expect(nodes[0]?.position).not.toEqual(nodes[1]?.position)
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: workspaceNodeId.editShotExecutionPlan('edit-script-1'),
        target: workspaceNodeId.videoPlan('edit-script-1', 1),
      }),
      expect.objectContaining({
        source: workspaceNodeId.editShotExecutionPlan('edit-script-2'),
        target: workspaceNodeId.videoPlan('edit-script-2', 1),
      }),
      expect.objectContaining({
        source: workspaceNodeId.videoPlan('edit-script-1', 1),
        target: workspaceNodeId.finalTimeline('episode-1'),
      }),
      expect.objectContaining({
        source: workspaceNodeId.videoPlan('edit-script-2', 1),
        target: workspaceNodeId.finalTimeline('episode-1'),
      }),
    ]))
  })
})
