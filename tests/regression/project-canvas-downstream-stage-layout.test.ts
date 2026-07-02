import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import type { ProjectEditScript, ProjectPanel, ProjectStoryboard } from '@/types/project'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import {
  WORKSPACE_CANVAS_SHOT_NODE_SIZE,
  WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
} from '@/features/project-workspace/canvas/node-presentation-profiles'

function t(key: string, values?: Record<string, string | number>): string {
  if (!values) return key
  return `${key}:${JSON.stringify(values)}`
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

function panel(index: number): ProjectPanel {
  const shotNumber = index + 1
  return {
    id: `panel-${shotNumber}`,
    storyboardId: 'storyboard-1',
    panelIndex: index,
    panelNumber: shotNumber,
    shotType: '中景',
    cameraMove: 'static',
    description: `shot ${shotNumber}`,
    location: '客厅',
    characters: null,
    props: null,
    srtSegment: null,
    srtStart: null,
    srtEnd: null,
    duration: 4,
    imagePrompt: `image prompt ${shotNumber}`,
    imageUrl: `/images/panel-${shotNumber}.png`,
    candidateImages: null,
    media: null,
    videoPrompt: `video prompt ${shotNumber}`,
    videoUrl: null,
    videoModel: null,
    videoErrorCode: null,
    videoErrorMessage: null,
    lastVideoGenerationOptions: null,
    videoMedia: null,
    sourceShotNumber: shotNumber,
    sourceGenerationSegmentId: `edit-script-1:generationSegment:${Math.ceil(shotNumber / 2)}`,
    executionSnapshotJson: null,
    renderFactsJson: null,
    actingNotes: null,
    imageTaskRunning: false,
    videoTaskRunning: false,
    imageErrorMessage: null,
  }
}

function storyboard(panelCount: number): ProjectStoryboard {
  const panels = Array.from({ length: panelCount }, (_item, index) => panel(index))
  return {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    editScriptId: 'edit-script-1',
    storyboardTextJson: null,
    panelCount,
    storyboardImageUrl: null,
    media: null,
    storyboardTaskRunning: false,
    lastError: null,
    panels,
  }
}

function editScript(segmentCount: number): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    userPrompt: 'story prompt',
    styleBible: null,
    screenplayText: 'screenplay text',
    durationSec: segmentCount * 8,
    shotCount: segmentCount * 2,
    status: 'ready',
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: Array.from({ length: segmentCount }, (_item, index) => ({
      shotNumbers: [index * 2 + 1, index * 2 + 2],
      continuity: `segment ${index + 1}`,
    })),
    requirements: [],
  }
}

function layout(nodeKey: string, y: number): CanvasNodeLayout {
  return {
    nodeKey,
    x: 100,
    y,
    width: 420,
    height: 560,
    zIndex: 0,
    locked: false,
    collapsed: false,
  }
}

function nodeBottom(node: WorkspaceCanvasFlowNode): number {
  return node.position.y + node.data.height
}

function requireNode(
  nodes: readonly WorkspaceCanvasFlowNode[],
  kind: WorkspaceCanvasFlowNode['data']['kind'],
): WorkspaceCanvasFlowNode {
  const node = nodes.find((candidate) => candidate.data.kind === kind)
  if (!node) throw new Error(`missing node kind ${kind}`)
  return node
}

describe('project canvas downstream stage layout', () => {
  it('places default video, BGM, and final stages below the rendered storyboard rows', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [storyboard(12)],
      editFirstWorkflow: workflow('ready_to_render_final'),
      editScript: editScript(6),
      savedLayouts: [],
      translate: t,
    })

    const shotNodes = projection.nodes.filter((node) => node.data.kind === 'shot')
    const videoPlanNodes = projection.nodes.filter((node) => node.data.kind === 'videoPlan')
    const bgmNode = requireNode(projection.nodes, 'bgmScore')
    const finalNode = requireNode(projection.nodes, 'finalTimeline')
    const storyboardBottom = Math.max(...shotNodes.map(nodeBottom))
    const firstVideoY = Math.min(...videoPlanNodes.map((node) => node.position.y))
    const firstShotX = Math.min(...shotNodes.map((node) => node.position.x))
    const firstVideoX = Math.min(...videoPlanNodes.map((node) => node.position.x))
    const videoPlanBottom = Math.max(...videoPlanNodes.map(nodeBottom))

    expect(shotNodes).toHaveLength(12)
    expect(videoPlanNodes).toHaveLength(6)
    expect(firstVideoY).toBeGreaterThan(storyboardBottom)
    expect(firstVideoX).toBe(firstShotX)
    expect(bgmNode.position.y).toBeGreaterThan(videoPlanBottom)
    expect(finalNode.position.y).toBeGreaterThan(nodeBottom(bgmNode))
  })

  it('uses saved upstream positions as anchors when placing unsaved downstream defaults', () => {
    const savedShotY = 5000
    const savedVideoY = 6200
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [storyboard(2)],
      editFirstWorkflow: workflow('ready_to_generate_videos'),
      editScript: editScript(1),
      savedLayouts: [
        layout('shot:panel-1', savedShotY),
        layout('video-plan:edit-script-1:1', savedVideoY),
      ],
      translate: t,
    })

    const videoPlanNode = requireNode(projection.nodes, 'videoPlan')
    const bgmNode = requireNode(projection.nodes, 'bgmScore')

    expect(videoPlanNode.position.y).toBe(savedVideoY)
    expect(bgmNode.position.y).toBeGreaterThan(savedShotY + WORKSPACE_CANVAS_SHOT_NODE_SIZE.height)
    expect(bgmNode.position.y).toBeGreaterThan(savedVideoY + WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height)
  })
})
