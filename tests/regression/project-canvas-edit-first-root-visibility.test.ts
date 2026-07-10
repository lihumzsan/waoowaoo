import {
  buildWorkspaceNodeCanvasProjection,
  describe,
  editBible,
  editScript,
  expect,
  it,
  t,
  workflow,
} from './project-canvas-edit-first-visibility.fixture'

describe('project canvas edit-first visibility', () => {
  it('does not duplicate bible status in footer meta', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('bible_ready_for_review'),
      editBible: editBible(),
      savedLayouts: [],
      translate: t,
    })
    const bible = projection.nodes.find((node) => node.data.kind === 'editBible')

    expect(bible?.data.lifecycle.phase).toBe('succeeded')
    expect(bible?.data.meta).toBe('')
  })

  it('uses the bible node as the edit-first root without an analysis fallback node', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('bible_ready_for_review'),
      editBible: editBible(),
      savedLayouts: [],
      translate: t,
    })
    const bible = projection.nodes.find((node) => node.data.kind === 'editBible')

    expect(projection.nodes.some((node) => node.id.startsWith('analysis:'))).toBe(false)
    expect(projection.edges.some((edge) => edge.source.startsWith('analysis:') || edge.target.startsWith('analysis:'))).toBe(false)
    expect(bible).toBeDefined()
    expect(projection.edges.some((edge) => edge.target === bible?.id)).toBe(false)
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

  it('does not treat an unloaded edit script as a running generation on completed workflows', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('completed'),
      editBible: editBible(),
      savedLayouts: [],
      translate: t,
    })
    const editScriptNode = projection.nodes.find((node) => node.data.kind === 'editScript')

    expect(editScriptNode).toBeDefined()
    expect(editScriptNode?.data.lifecycle.phase).toBe('pending')
    expect(editScriptNode?.data.body).toBe('nodes.editScript.pendingBody')
  })
})
