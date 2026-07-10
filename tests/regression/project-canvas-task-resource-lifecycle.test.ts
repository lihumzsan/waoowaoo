import {
  TASK_TYPE,
  bible,
  buildWorkspaceNodeCanvasProjection,
  describe,
  expect,
  it,
  sourceScriptNode,
  t,
  workflow,
} from './project-canvas-resource-lifecycle.fixture'

describe('project canvas resource lifecycle', () => {
  it('keeps a submitted edit bible generation task visible before the bible query catches up', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_ingest_script'),
      activeAssistantOperationId: 'ingest_script',
      activeTaskTargets: [{
        taskId: 'task-bible-1',
        operationId: 'ingest_script',
        targetType: 'ProjectEditSourceScript',
        targetId: 'bible-1',
        types: [TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE],
        sourceKind: 'prompt_generated_outline',
      }],
      savedLayouts: [],
      translate: t,
    })
    const node = projection.nodes.find((candidate) => candidate.data.kind === 'editSourceScript')

    expect(node?.id).toBe('edit-source-script:episode:episode-1')
    expect(node?.data.targetId).toBe('bible-1')
    expect(node?.data.title).toBe('nodes.editSourceScript.pendingTitle')
    expect(node?.data.eyebrow).toBe('nodes.editSourceScript.eyebrow')
    expect(node?.data.body).toBe('nodes.editSourceScript.pendingBody')
    expect(node?.data.lifecycle.phase).toBe('pending')
  })

  it('isolates source script, production plan, and visual style runtime targets', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('style_preview_generating'),
      editBible: bible('confirmed', {
        sourceKind: 'prompt_generated_script',
        sourceText: '完整源剧本',
        bible: { title: '制作规划' },
        stylePreviews: [{
          id: 'style-preview-1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          bibleId: 'bible-1',
          styleKey: 'style_a',
          aspectRatio: '16:9',
          title: '候选一',
          summary: '候选摘要',
          styleBible: {},
          gridImagePrompt: 'prompt',
          imageKey: null,
          imageUrl: null,
          status: 'pending',
          taskId: null,
          errorMessage: null,
        }],
      }),
      activeTaskTargets: [{
        taskId: 'task-style-1',
        operationId: 'generate_edit_style_previews',
        targetType: 'ProjectEditBible',
        targetId: 'bible-1',
        types: [TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE],
      }],
      savedLayouts: [],
      translate: t,
    })

    const sourceNode = projection.nodes.find((node) => node.data.kind === 'editSourceScript')
    const bibleNode = projection.nodes.find((node) => node.data.kind === 'editBible')
    const styleNode = projection.nodes.find((node) => node.data.kind === 'editStylePreview')
    expect(sourceNode?.data.lifecycle.phase).toBe('succeeded')
    expect(bibleNode?.data.lifecycle.phase).toBe('succeeded')
    expect(styleNode).toMatchObject({
      id: 'edit-style-preview:pending:bible-1',
      data: {
        title: 'nodes.editStylePreview.pendingTitle',
        targetId: 'bible-1',
        lifecycle: expect.objectContaining({ phase: 'pending' }),
        runtimeTargets: [{
          targetType: 'ProjectEditBible',
          targetId: 'bible-1',
          types: [TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE],
        }],
      },
    })
  })

  it('labels a prompt-expanded script review node as source script instead of production plan', () => {
    const node = sourceScriptNode({
      status: 'script_ready_for_review',
      workflowStage: 'script_ready_for_review',
      bibleOverrides: {
        sourceKind: 'prompt_generated_script',
        sourceText: '完整扩写剧本',
      },
    })

    expect(node.data.title).toBe('nodes.editSourceScript.title')
    expect(node.data.eyebrow).toBe('nodes.editSourceScript.eyebrow')
    expect(node.data.body).toBe('完整扩写剧本')
    expect(node.data.sourceScriptDetails?.sourceText).toBe('完整扩写剧本')
    expect(node.data.lifecycle.phase).toBe('succeeded')
  })
})
