import {
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  buildWorkspaceNodeCanvasProjection,
  describe,
  editScript,
  expect,
  it,
  requirement,
  shotExecutionPlan,
  storyboard,
  t,
  workflow,
} from './project-canvas-edit-first-visibility.fixture'

describe('project canvas edit-first visibility', () => {
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

  it('renders BGM and soundscape from the video plan stage without rendering the final timeline', () => {
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
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes.some((node) => node.data.kind === 'videoPlan')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'bgmScore')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'soundscape')).toBe(true)
    expect(projection.nodes.some((node) => node.data.kind === 'finalTimeline')).toBe(false)
    expect(projection.edges.some((edge) => edge.id.startsWith('edge:bgm-final:'))).toBe(false)
    expect(projection.edges.some((edge) => edge.id.startsWith('edge:soundscape-final:'))).toBe(false)
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
})
