import {
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
  buildWorkspaceNodeCanvasProjection,
  describe,
  editScript,
  expect,
  finalVideo,
  it,
  requirement,
  shotExecutionPlan,
  storyboard,
  t,
  videoGroup,
  workflow,
} from './project-canvas-edit-first-visibility.fixture'

describe('project canvas edit-first visibility', () => {
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
        generationSegments: [{ shotIds: ['shot-1'], continuity: 'first segment' }],
      }),
      finalVideo: finalVideo(),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'soundscape')).toBe(true)
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
        generationSegments: [{ shotIds: ['shot-1'], continuity: 'first segment' }],
      }),
      videoGroups: [videoGroup()],
      finalVideo: finalVideo(),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'soundscape')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(true)
    expect(projection.edges.some((edge) => edge.id.startsWith('edge:bgm-final:'))).toBe(true)
    expect(projection.edges.some((edge) => edge.id.startsWith('edge:soundscape-final:'))).toBe(true)
  })

  it('keeps existing assets, storyboards, and video groups visible when chapter render fails', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [storyboard()],
      editFirstWorkflow: workflow('failed', ['render_chapters']),
      editScript: editScript({
        status: 'ready',
        requirements: [requirement()],
        generationSegments: [{ shotIds: ['shot-1'], continuity: 'first segment' }],
      }),
      editShotExecutionPlan: shotExecutionPlan(),
      videoGroups: [videoGroup()],
      finalVideo: finalVideo(),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'editAssetGroup')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'editShotExecutionPlan')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'shot')).toBe(true)
    expect(projection.nodes.some((node) => (
      node.data.kind === 'videoPlan'
      && node.data.videoPlanDetails?.outputUrl === '/videos/group-1.mp4'
    ))).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(true)
  })
})
