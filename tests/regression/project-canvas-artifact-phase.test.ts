import { describe, expect, it } from 'vitest'
import type { ProjectEditBible } from '@/types/project'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { TASK_TYPE } from '@/lib/task/types'
import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

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

function bible(status: string, overrides: Partial<ProjectEditBible> = {}): ProjectEditBible {
  return {
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'story prompt',
    bibleText: 'bible text',
    status,
    stylePreviews: [],
    ...overrides,
  }
}

function editBibleNode(input: {
  readonly status: string
  readonly activeAssistantOperationId?: string
  readonly bibleOverrides?: Partial<ProjectEditBible>
  readonly workflowStage?: EditFirstWorkflowState['stage']
}): WorkspaceCanvasFlowNode {
  const projection = buildWorkspaceNodeCanvasProjection({
    projectId: 'project-1',
    episodeId: 'episode-1',
    episodeName: 'Episode 1',
    storyboards: [],
    editFirstWorkflow: workflow(input.workflowStage ?? 'bible_ready_for_review'),
    editBible: bible(input.status, input.bibleOverrides),
    activeAssistantOperationId: input.activeAssistantOperationId,
    savedLayouts: [],
    translate: t,
  })
  const node = projection.nodes.find((candidate) => candidate.data.kind === 'editBible')
  if (!node) throw new Error('EDIT_BIBLE_NODE_MISSING')
  return node
}

describe('project canvas artifact phase', () => {
  it('does not render a placeholder node when the bible artifact does not exist', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_ingest_script'),
      savedLayouts: [],
      translate: t,
    })

    expect(projection.nodes).toEqual([])
    expect(projection.edges).toEqual([])
  })

  it('treats bible review as a succeeded artifact instead of a running node', () => {
    const node = editBibleNode({ status: 'ready_for_review' })

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('treats style confirmation as a succeeded artifact instead of a running node', () => {
    const node = editBibleNode({ status: 'confirmed' })

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('does not use assistant focus as the edit bible lifecycle authority', () => {
    const node = editBibleNode({ status: 'ready_for_review', activeAssistantOperationId: 'ingest_script' })

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('keeps a submitted edit bible generation task visible before the bible query catches up', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_ingest_script'),
      activeAssistantOperationId: 'ingest_script',
      activeTaskTargets: [{
        operationId: 'ingest_script',
        targetType: 'ProjectEditBible',
        targetId: 'bible-1',
        types: [TASK_TYPE.EDIT_BIBLE_GENERATE],
        sourceKind: 'prompt_generated_outline',
      }],
      savedLayouts: [],
      translate: t,
    })
    const node = projection.nodes.find((candidate) => candidate.data.kind === 'editBible')

    expect(node?.id).toBe('edit-bible:episode:episode-1')
    expect(node?.data.targetId).toBe('bible-1')
    expect(node?.data.title).toBe('nodes.editScriptSource.pendingTitle')
    expect(node?.data.eyebrow).toBe('nodes.editScriptSource.eyebrow')
    expect(node?.data.body).toBe('nodes.editScriptSource.pendingBody')
    expect(node?.data.artifactPhase).toBe('running')
  })

  it('labels a prompt-expanded script review node as script instead of episode plan', () => {
    const node = editBibleNode({
      status: 'script_ready_for_review',
      workflowStage: 'script_ready_for_review',
      bibleOverrides: {
        sourceKind: 'prompt_generated_script',
        sourceText: '完整扩写剧本',
      },
    })

    expect(node.data.title).toBe('nodes.editScriptSource.title')
    expect(node.data.eyebrow).toBe('nodes.editScriptSource.eyebrow')
    expect(node.data.body).toBe('完整扩写剧本')
    expect(node.data.artifactPhase).toBe('succeeded')
  })
})
