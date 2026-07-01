import { describe, expect, it } from 'vitest'
import type { ProjectEditScript, ProjectPanel, ProjectStoryboard } from '@/types/project'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import { WORKSPACE_CANVAS_SHOT_NODE_SIZE } from '@/features/project-workspace/canvas/node-presentation-profiles'

function t(key: string): string {
  return key
}

function workflow(stage: EditFirstWorkflowState['stage']): EditFirstWorkflowState {
  return {
    active: true,
    stage,
    blocking: {
      kind: 'none',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  }
}

function panel(id: string, panelIndex: number): ProjectPanel {
  return {
    id,
    storyboardId: 'storyboard-1',
    panelIndex,
    panelNumber: panelIndex + 1,
    shotType: null,
    cameraMove: null,
    description: id,
    location: null,
    characters: null,
    props: null,
    srtSegment: null,
    srtStart: null,
    srtEnd: null,
    duration: null,
    imagePrompt: null,
    videoPrompt: null,
    imageUrl: null,
    candidateImages: null,
    media: null,
    videoUrl: null,
    videoModel: null,
    videoErrorCode: null,
    videoErrorMessage: null,
    lastVideoGenerationOptions: null,
    videoMedia: null,
    sourceShotNumber: panelIndex + 1,
    sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
    executionSnapshotJson: null,
    renderFactsJson: null,
    actingNotes: null,
    imageTaskRunning: false,
    videoTaskRunning: false,
    imageErrorMessage: null,
  }
}

function storyboard(panels: ProjectPanel[]): ProjectStoryboard {
  return {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    editScriptId: null,
    storyboardTextJson: null,
    panelCount: panels.length,
    storyboardImageUrl: null,
    lastError: null,
    panels,
  }
}

function editScript(): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    userPrompt: 'story prompt',
    styleBible: null,
    screenplayText: 'screenplay text',
    durationSec: 30,
    shotCount: 2,
    status: 'ready',
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [],
    requirements: [],
  }
}

describe('project canvas preserves business order', () => {
  it('does not derive shot order from saved canvas positions', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      episodeId: 'episode-1',
      storyboards: [storyboard([panel('panel-2', 1), panel('panel-1', 0)])],
      editFirstWorkflow: workflow('ready_to_generate_storyboard_images'),
      editScript: editScript(),
      savedLayouts: [
        {
          nodeKey: 'shot:panel-2',
          x: 0,
          y: 0,
          width: 320,
          height: 214,
          zIndex: 0,
          locked: false,
          collapsed: false,
        },
        {
          nodeKey: 'shot:panel-1',
          x: 1000,
          y: 1000,
          width: 320,
          height: 214,
          zIndex: 1,
          locked: false,
          collapsed: false,
        },
      ],
      translate: t,
    })

    const shotNodeIds = projection.nodes
      .filter((node) => node.data.kind === 'shot')
      .map((node) => node.id)

    expect(shotNodeIds).toEqual(['shot:panel-1', 'shot:panel-2'])
    expect(projection.nodes
      .filter((node) => node.data.kind === 'shot')
      .map((node) => node.data.height)).toEqual([
        WORKSPACE_CANVAS_SHOT_NODE_SIZE.height,
        WORKSPACE_CANVAS_SHOT_NODE_SIZE.height,
      ])
  })
})
