import { describe, expect, it } from 'vitest'

import type { ProjectEditBible } from '@/types/project'

import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

import { TASK_TYPE } from '@/lib/task/types'

import {
  buildWorkspaceNodeCanvasProjection,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'

import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

import { isWorkspaceCanvasLifecycleRunning } from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'

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

function sourceScriptNode(input: {
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
    editFirstWorkflow: workflow(input.workflowStage ?? 'script_ready_for_review'),
    editBible: bible(input.status, input.bibleOverrides),
    activeAssistantOperationId: input.activeAssistantOperationId,
    savedLayouts: [],
    translate: t,
  })
  const node = projection.nodes.find((candidate) => candidate.data.kind === 'editSourceScript')
  if (!node) throw new Error('EDIT_SOURCE_SCRIPT_NODE_MISSING')
  return node
}

export { describe, expect, it } from 'vitest'
export type { ProjectEditBible } from '@/types/project'
export type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
export { TASK_TYPE } from '@/lib/task/types'
export { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection'
export type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
export { isWorkspaceCanvasLifecycleRunning } from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'
export { bible, editBibleNode, sourceScriptNode, t, workflow }
