import { describe, expect, it } from 'vitest'
import type { ProjectEditBible } from '@/types/project'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
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

function bible(status: string): ProjectEditBible {
  return {
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'story prompt',
    bibleText: 'bible text',
    status,
    stylePreviews: [],
  }
}

function editBibleNode(status: string, activeAssistantOperationId?: string): WorkspaceCanvasFlowNode {
  const projection = buildWorkspaceNodeCanvasProjection({
    projectId: 'project-1',
    episodeId: 'episode-1',
    episodeName: 'Episode 1',
    storyboards: [],
    editFirstWorkflow: workflow('bible_ready_for_review'),
    editBible: bible(status),
    activeAssistantOperationId,
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
    const node = editBibleNode('ready_for_review')

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('treats style confirmation as a succeeded artifact instead of a running node', () => {
    const node = editBibleNode('confirmed')

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('uses the explicit assistant operation as the running signal', () => {
    const node = editBibleNode('ready_for_review', 'ingest_script')

    expect(node.data.artifactPhase).toBe('running')
    expect(node.data.statusLabel).toBe('status.processing')
    expect(node.data.isRunning).toBe(true)
  })
})
