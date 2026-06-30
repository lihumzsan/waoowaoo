import { describe, expect, it } from 'vitest'
import type { ProjectEditScreenplay } from '@/types/project'
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

function screenplay(status: string): ProjectEditScreenplay {
  return {
    id: 'screenplay-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'story prompt',
    screenplayText: 'screenplay text',
    status,
    stylePreviews: [],
  }
}

function editScreenplayNode(status: string, activeAssistantOperationId?: string): WorkspaceCanvasFlowNode {
  const projection = buildWorkspaceNodeCanvasProjection({
    projectId: 'project-1',
    episodeId: 'episode-1',
    episodeName: 'Episode 1',
    storyText: 'story',
    storyboards: [],
    editFirstWorkflow: workflow('screenplay_ready_for_review'),
    editScreenplay: screenplay(status),
    activeAssistantOperationId,
    savedLayouts: [],
    translate: t,
  })
  const node = projection.nodes.find((candidate) => candidate.data.kind === 'editScreenplay')
  if (!node) throw new Error('EDIT_SCREENPLAY_NODE_MISSING')
  return node
}

describe('project canvas artifact phase', () => {
  it('does not render an empty badge when the input artifact does not exist', () => {
    const projection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      episodeName: 'Episode 1',
      storyText: '',
      storyboards: [],
      editFirstWorkflow: workflow('ready_to_generate_screenplay'),
      savedLayouts: [],
      translate: t,
    })
    const node = projection.nodes.find((candidate) => candidate.data.kind === 'analysis')
    if (!node) throw new Error('ANALYSIS_NODE_MISSING')

    expect(node.data.artifactPhase).toBeUndefined()
    expect(node.data.statusLabel).toBe('')
    expect(node.data.isRunning).toBe(false)
  })

  it('treats screenplay review as a succeeded artifact instead of a running node', () => {
    const node = editScreenplayNode('screenplay_ready')

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('treats style confirmation as a succeeded artifact instead of a running node', () => {
    const node = editScreenplayNode('style_preview_ready')

    expect(node.data.artifactPhase).toBe('succeeded')
    expect(node.data.statusLabel).toBe('status.succeeded')
    expect(node.data.isRunning).toBe(false)
  })

  it('uses the explicit assistant operation as the running signal', () => {
    const node = editScreenplayNode('screenplay_ready', 'generate_edit_screenplay')

    expect(node.data.artifactPhase).toBe('running')
    expect(node.data.statusLabel).toBe('status.processing')
    expect(node.data.isRunning).toBe(true)
  })
})
