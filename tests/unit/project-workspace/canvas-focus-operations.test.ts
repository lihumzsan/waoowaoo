import {
  buildWorkspaceCanvasFocusKey,
  describe,
  expect,
  it,
  resolveWorkspaceCanvasFocusNodeIds,
  resolveWorkspaceCanvasStyleBibleFocusNodeIds,
  workspaceNode,
} from './canvas-focus-follow.fixture'

describe('workspace canvas focus follow', () => {
  it('focuses only the operation primary card instead of every running node', () => {
    const nodes = [
      workspaceNode('edit-process:script-1', 'editProcessGroup', true),
      workspaceNode('edit-script:script-1', 'editScript', true),
      workspaceNode('shot:panel-1', 'shot', true),
    ]

    const focusNodeIds = resolveWorkspaceCanvasFocusNodeIds(nodes, 'generate_edit_script')

    expect(focusNodeIds).toEqual(['edit-script:script-1'])
    expect(buildWorkspaceCanvasFocusKey(focusNodeIds)).toBe('edit-script:script-1')
  })

  it('falls back to one prioritized running card when there is no active operation', () => {
    const nodes = [
      workspaceNode('edit-process:script-1', 'editProcessGroup', true),
      workspaceNode('shot:panel-1', 'shot', true),
      workspaceNode('edit-script:script-1', 'editScript', true),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, null)).toEqual(['edit-script:script-1'])
  })

  it('keeps bulk storyboard image generation focused to a single card', () => {
    const nodes = [
      workspaceNode('shot:panel-2', 'shot', true),
      workspaceNode('shot:panel-1', 'shot', true),
      workspaceNode('shot:panel-3', 'shot', false),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, 'generate_edit_script_storyboard_images')).toEqual(['shot:panel-2'])
  })

  it('focuses generated shot nodes for storyboard structure generation', () => {
    const nodes = [
      workspaceNode('edit-shot-execution-plan:edit-script:script-1', 'editShotExecutionPlan', false),
      workspaceNode('shot:panel-1', 'shot', false),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, 'generate_edit_script_storyboard'))
      .toEqual(['shot:panel-1'])
  })

  it('focuses script creation operations on the source script card', () => {
    const nodes = [
      workspaceNode('edit-source-script:episode:episode-1', 'editSourceScript', true),
      workspaceNode('edit-bible:episode:episode-1', 'editBible', true),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, 'ingest_script'))
      .toEqual(['edit-source-script:episode:episode-1'])
    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, 'revise_script'))
      .toEqual(['edit-source-script:episode:episode-1'])
  })

  it('resolves confirmed style bible focus requests to the style bible card', () => {
    const nodes = [
      workspaceNode('edit-bible:bible-1', 'editBible', false),
      workspaceNode('edit-style-bible:bible-1', 'editStyleBible', false),
    ]

    expect(resolveWorkspaceCanvasStyleBibleFocusNodeIds(nodes)).toEqual(['edit-style-bible:bible-1'])
  })
})
