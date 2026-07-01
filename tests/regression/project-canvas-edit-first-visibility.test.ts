import { describe, expect, it } from 'vitest'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type {
  ProjectEditAssetRequirement,
  ProjectEditScreenplay,
  ProjectEditScript,
  ProjectEditShotExecutionPlan,
  ProjectFinalVideo,
  ProjectPanel,
  ProjectStoryboard,
  ProjectVideoGroup,
} from '@/types/project'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import {
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
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

function requirement(
  overrides: Partial<ProjectEditAssetRequirement> = {},
): ProjectEditAssetRequirement {
  return {
    id: 'requirement-location-1',
    kind: 'location',
    name: '客厅',
    description: '昏暗客厅',
    shotNumbers: [1],
    status: 'completed',
    targetId: 'location-1',
    taskTargetType: 'LocationImage',
    taskTargetId: 'location-1',
    errorMessage: null,
    previewImageUrl: '/images/living-room.png',
    ...overrides,
  }
}

function editScreenplay(overrides: Partial<ProjectEditScreenplay> = {}): ProjectEditScreenplay {
  return {
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'story prompt',
    screenplayText: 'screenplay text',
    status: 'ready',
    ...overrides,
  }
}

function editScript(input: {
  readonly status: string
  readonly requirements?: readonly ProjectEditAssetRequirement[]
  readonly generationSegments?: ProjectEditScript['generationSegments']
}): ProjectEditScript {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    screenplayId: 'screenplay-1',
    userPrompt: 'story prompt',
    styleBible: null,
    screenplayText: 'screenplay text',
    durationSec: 30,
    shotCount: input.generationSegments?.flatMap((segment) => segment.shotNumbers).length ?? 0,
    status: input.status,
    assetReviewStatus: 'pending',
    shots: [],
    generationSegments: [...(input.generationSegments ?? [])],
    requirements: [...(input.requirements ?? [])],
  }
}

function shotExecutionPlan(): ProjectEditShotExecutionPlan {
  return {
    id: 'shot-execution-plan-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    editScriptId: 'edit-script-1',
    status: 'ready',
    shots: [{
      shotNumber: 1,
      camera: {
        shotScale: '中景',
        lens: '35mm',
        focus: '林晓',
        height: 'eye level',
        angle: 'front',
        movement: 'static',
        composition: 'centered',
        lighting: 'low key',
      },
      blocking: {
        axis: {
          type: 'dialogue',
          subjects: ['林晓'],
          screenDirection: 'left to right',
        },
        characters: [{
          name: '林晓',
          visibility: 'visible',
          position: '沙发前',
          screenPosition: 'center',
          facing: 'camera',
          eyeline: 'phone',
        }],
        objects: [],
        spatialNote: '林晓坐在客厅沙发前。',
      },
    }],
  }
}

function panel(): ProjectPanel {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    panelNumber: 1,
    shotType: '中景',
    cameraMove: 'static',
    description: '林晓坐在客厅里。',
    location: '客厅',
    characters: '林晓',
    props: null,
    srtSegment: null,
    srtStart: null,
    srtEnd: null,
    duration: 4,
    imagePrompt: 'panel image prompt',
    imageUrl: null,
    videoPrompt: 'panel video prompt',
    videoUrl: null,
    actingNotes: null,
    sourceShotNumber: 1,
  }
}

function storyboard(): ProjectStoryboard {
  return {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    editScriptId: 'edit-script-1',
    storyboardTextJson: null,
    panelCount: 1,
    storyboardImageUrl: null,
    lastError: null,
    storyboardTaskRunning: false,
    panels: [panel()],
  }
}

function videoGroup(overrides: Partial<ProjectVideoGroup> = {}): ProjectVideoGroup {
  return {
    id: 'video-group-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    gridMode: '2x2',
    shotNumbers: [1],
    durationSec: 3,
    prompt: 'video prompt',
    status: 'completed',
    taskId: null,
    errorCode: null,
    errorMessage: null,
    referenceImageUrl: null,
    referenceImageMedia: null,
    videoUrl: '/videos/group-1.mp4',
    videoMedia: null,
    ...overrides,
  }
}

function finalVideo(overrides: Partial<ProjectFinalVideo> = {}): ProjectFinalVideo {
  return {
    id: 'final-1',
    episodeId: 'episode-1',
    renderStatus: null,
    renderTaskId: null,
    outputUrl: null,
    updatedAt: null,
    bgmScore: {
      schemaVersion: 2,
      status: 'completed',
      taskId: 'task-bgm-1',
      editScriptId: 'edit-script-1',
      timelineSignature: 'timeline-signature',
      durationSeconds: 30,
      musicModel: 'music-model',
      mix: {
        mediaId: 'media-bgm-1',
        url: '/music/bgm.mp3',
        storageKey: 'music/bgm.mp3',
        mimeType: 'audio/mpeg',
        durationMs: 30_000,
      },
    },
    ...overrides,
  }
}

describe('project canvas edit-first visibility', () => {
  it('does not duplicate screenplay status in footer meta', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('screenplay_ready_for_review'),
      editScreenplay: editScreenplay(),
      savedLayouts: [],
      translate: t,
    })
    const screenplay = projection.nodes.find((node) => node.data.kind === 'editScreenplay')

    expect(screenplay?.data.statusLabel).toBeTruthy()
    expect(screenplay?.data.meta).toBe('')
  })

  it('uses the screenplay node as the edit-first root without an analysis fallback node', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('screenplay_ready_for_review'),
      editScreenplay: editScreenplay(),
      savedLayouts: [],
      translate: t,
    })
    const screenplay = projection.nodes.find((node) => node.data.kind === 'editScreenplay')

    expect(projection.nodes.some((node) => node.id.startsWith('analysis:'))).toBe(false)
    expect(projection.edges.some((edge) => edge.source.startsWith('analysis:') || edge.target.startsWith('analysis:'))).toBe(false)
    expect(screenplay).toBeDefined()
    expect(projection.edges.some((edge) => edge.target === screenplay?.id)).toBe(false)
  })

  it('does not render asset or execution nodes while the edit script is still generating', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('edit_script_generating'),
      editScript: editScript({ status: 'generating' }),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'editScript')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'editAssetGroup')).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'editShotExecutionPlan')).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(false)
  })

  it('renders required assets without rendering the shot execution plan before asset review advances', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('assets_ready_for_review'),
      editScript: editScript({
        status: 'ready',
        requirements: [requirement()],
      }),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'editAssetGroup')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'editShotExecutionPlan')).toBe(false)
  })

  it('does not render a separate location asset node for an edit-first location requirement', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_assets'),
      editScript: editScript({
        status: 'ready',
        requirements: [requirement()],
      }),
      savedLayouts: [],
      translate: t,
    })
    const assetGroup = projection.nodes.find((node) => node.data.kind === 'editAssetGroup')

    expect(assetGroup?.data.editAssetGroupDetails?.assets.map((asset) => asset.name)).toEqual(['客厅'])
    expect(assetGroup?.data.height).toBe(WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.height)
    expect(projection.nodes.some((node) => node.id.startsWith('location-asset:'))).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'imageAsset')).toBe(false)
  })

  it('renders BGM from the video plan stage without rendering the final timeline', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_videos'),
      editScript: editScript({
        status: 'ready',
        generationSegments: [{ shotNumbers: [1], continuity: 'first segment' }],
      }),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'videoPlan')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(false)
    expect(projection.edges.some((edge) => edge.id.startsWith('edge:bgm-final:'))).toBe(false)
  })

  it('renders shot cards directly after execution plan without a storyboard structure node', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [storyboard()],
      editFirstWorkflow: workflow('ready_to_generate_storyboard_images'),
      editScript: editScript({
        status: 'ready',
      }),
      editShotExecutionPlan: shotExecutionPlan(),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.id.startsWith('storyboard-panel-generation:'))).toBe(false)
    expect(projection.nodes.some((node) => node.data.kind === 'shot')).toBe(true)
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'edit-shot-execution-plan:edit-script:edit-script-1',
        target: 'shot:panel-1',
      }),
    ]))
  })

  it('projects edit-first collapsed nodes with compact widths before disclosure expands them', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_storyboard_images'),
      editScript: editScript({
        status: 'ready',
      }),
      editShotExecutionPlan: shotExecutionPlan(),
      savedLayouts: [],
      translate: t,
    })
    const editScriptNode = projection.nodes.find((node) => node.data.kind === 'editScript')
    const executionNode = projection.nodes.find((node) => node.data.kind === 'editShotExecutionPlan')

    expect(editScriptNode?.data.width).toBe(WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.width)
    expect(editScriptNode?.style?.width).toBe(WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.width)
    expect(executionNode?.data.width).toBe(WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.width)
    expect(executionNode?.style?.width).toBe(WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.width)
  })

  it('keeps the final timeline hidden while BGM is ready but video output is not complete', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_videos'),
      editScript: editScript({
        status: 'ready',
        generationSegments: [{ shotNumbers: [1], continuity: 'first segment' }],
      }),
      finalVideo: finalVideo(),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(false)
  })

  it('renders the final timeline only when the workflow reaches final render readiness', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_render_final'),
      editScript: editScript({
        status: 'ready',
        generationSegments: [{ shotNumbers: [1], continuity: 'first segment' }],
      }),
      videoGroups: [videoGroup()],
      finalVideo: finalVideo(),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(true)
    expect(projection.edges.some((edge) => edge.id.startsWith('edge:bgm-final:'))).toBe(true)
  })
})
