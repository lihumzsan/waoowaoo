import { describe, expect, it } from 'vitest'
import { buildWorkspaceNodeCanvasProjection } from '@/features/project-workspace/canvas/projection/workspace-node-canvas-projection'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { WorkspaceCanvasStreamPatch } from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'
import { resolveWorkspaceCanvasNodeDisclosure } from '@/features/project-workspace/canvas/node-presentation-profiles'
import { resolveWorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/workspace-node-runtime'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import { taskRuntimeTargetQueryKey } from '@/lib/task/runtime-targets'
import type { ProjectEditBible } from '@/types/project'

/**
 * Logic Specification
 * Authority: CN-02D/CN-07/CN-08 terminal stream-to-Query handoff.
 * Rejects: removing or collapsing a canonical preview before the exact Task-owned formal Query arrives.
 * Production entries: buildWorkspaceNodeCanvasProjection and resolveWorkspaceCanvasNodeData.
 * Oracle: durable identity keeps the node materialized; handoff content stays expanded until the same Task owns a terminal resource.
 * Command: npx vitest run tests/unit/project-workspace/canvas-terminal-handoff.test.ts
 */

const pendingLifecycle = {
  phase: 'pending', taskId: null, taskType: null, progress: null, error: null, stream: null,
} as const

const runtimeTarget = {
  targetType: 'ProjectEditSourceScript',
  targetId: 'bible-1',
  types: ['edit_source_script_generate'],
} as const

function sourceNode(input: {
  readonly lifecycle?: WorkspaceCanvasFlowNode['data']['lifecycle']
  readonly terminalHandoffTaskId?: string | null
  readonly body?: string
} = {}): WorkspaceCanvasFlowNode {
  return {
    id: workspaceNodeId.editSourceScript('episode-1'),
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'editSourceScript',
      mediaLoadingContext: null,
      layoutNodeType: 'editSourceScript',
      targetType: 'editSourceScript',
      targetId: 'bible-1',
      title: 'Source',
      eyebrow: 'Source',
      body: input.body ?? 'pending source',
      meta: '',
      lifecycle: input.lifecycle ?? pendingLifecycle,
      terminalHandoffTaskId: input.terminalHandoffTaskId ?? null,
      runtimeTargets: [runtimeTarget],
      width: 760,
      height: 360,
    },
  }
}

function editBible(status: ProjectEditBible['status'], sourceKind: string): ProjectEditBible {
  return {
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    status,
    sourceKind,
    sourceText: sourceKind === 'prompt_generated_script' ? 'Generated source' : 'Outline',
    styleBible: null,
    stylePreviews: [],
  }
}

describe('Canvas terminal handoff', () => {
  it('keeps the durable source and planning nodes materialized without active Task or stream facts', () => {
    const sourceProjection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: {
        active: true,
        stage: 'script_generating',
        blocking: { kind: 'processing', reason: 'source generation is running' },
        nextAction: null,
        allowedOperationIds: [],
        operationGroup: null,
      },
      editBible: editBible('generating', 'prompt_generated_outline'),
      savedLayouts: [],
      translate: (key) => key,
    })
    expect(sourceProjection.nodes.map((node) => node.id)).toContain(workspaceNodeId.editSourceScript('episode-1'))

    const bibleProjection = buildWorkspaceNodeCanvasProjection({
      projectId: 'project-1',
      episodeId: 'episode-1',
      storyboards: [],
      editFirstWorkflow: {
        active: true,
        stage: 'bible_generating',
        blocking: { kind: 'processing', reason: 'planning is running' },
        nextAction: null,
        allowedOperationIds: [],
        operationGroup: null,
      },
      editBible: editBible('generating', 'prompt_generated_script'),
      savedLayouts: [],
      translate: (key) => key,
    })
    expect(bibleProjection.nodes.map((node) => node.id)).toContain(workspaceNodeId.editBible('episode-1'))
  })

  it('keeps completed handoff content until the formal resource becomes authoritative', () => {
    const handoffPatch = {
      nodeId: workspaceNodeId.editSourceScript('episode-1'),
      streamKind: 'editSourceScript',
      taskId: 'task-1',
      taskType: 'edit_source_script_generate',
      terminalHandoff: true,
      presentation: {
        isStreaming: false,
        activeItemKey: 'scene-1',
        displayedItemKeys: ['scene-1'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: { 'scene-1': 1 },
      },
      data: { body: 'last streamed scene' },
    } as WorkspaceCanvasStreamPatch & { readonly terminalHandoff: true }
    const completedTask = {
      phase: 'completed',
      taskId: 'task-1',
      runningTaskId: null,
      runningTaskType: 'edit_source_script_generate',
      progress: 100,
    } as const

    const resolved = resolveWorkspaceCanvasNodeData({
      node: sourceNode(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), completedTask]]),
      streamPatch: handoffPatch,
      submitting: false,
    })

    expect(resolved.lifecycle.phase).toBe('pending')
    expect(resolved.lifecycle.stream).toMatchObject({ isStreaming: false })
    expect(resolved.body).toBe('last streamed scene')
  })

  it('rejects an old succeeded resource during regeneration of the same canonical node', () => {
    const handoffPatch = {
      nodeId: workspaceNodeId.editSourceScript('episode-1'),
      streamKind: 'editSourceScript',
      taskId: 'task-current',
      taskType: 'edit_source_script_generate',
      terminalHandoff: true,
      presentation: {
        isStreaming: false,
        activeItemKey: null,
        displayedItemKeys: ['scene-current'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: { 'scene-current': 1 },
      },
      data: { body: 'current streamed result' },
    } as WorkspaceCanvasStreamPatch & { readonly terminalHandoff: true }
    const completedTask = {
      phase: 'completed',
      taskId: 'task-current',
      runningTaskId: null,
      runningTaskType: 'edit_source_script_generate',
      progress: 100,
    } as const
    const oldSucceededLifecycle = {
      ...pendingLifecycle,
      phase: 'succeeded' as const,
    }

    const resolved = resolveWorkspaceCanvasNodeData({
      node: sourceNode({
        lifecycle: oldSucceededLifecycle,
        terminalHandoffTaskId: 'task-old',
        body: 'old formal result',
      }),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), completedTask]]),
      streamPatch: handoffPatch,
      submitting: false,
    })

    expect(resolved.lifecycle.phase).toBe('pending')
    expect(resolved.lifecycle.stream).toMatchObject({ isStreaming: false })
    expect(resolved.body).toBe('current streamed result')
  })

  it('hands off only when the terminal formal resource belongs to the streamed Task', () => {
    const handoffPatch = {
      nodeId: workspaceNodeId.editSourceScript('episode-1'),
      streamKind: 'editSourceScript',
      taskId: 'task-current',
      taskType: 'edit_source_script_generate',
      terminalHandoff: true,
      presentation: {
        isStreaming: false,
        activeItemKey: null,
        displayedItemKeys: ['scene-current'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: { 'scene-current': 1 },
      },
      data: { body: 'streamed result' },
    } as WorkspaceCanvasStreamPatch & { readonly terminalHandoff: true }
    const completedTask = {
      phase: 'completed',
      taskId: 'task-current',
      runningTaskId: null,
      runningTaskType: 'edit_source_script_generate',
      progress: 100,
    } as const

    const resolved = resolveWorkspaceCanvasNodeData({
      node: sourceNode({
        lifecycle: { ...pendingLifecycle, phase: 'succeeded' },
        terminalHandoffTaskId: 'task-current',
        body: 'formal result',
      }),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), completedTask]]),
      streamPatch: handoffPatch,
      submitting: false,
    })

    expect(resolved.lifecycle.phase).toBe('succeeded')
    expect(resolved.lifecycle.stream).toBeNull()
    expect(resolved.body).toBe('formal result')
  })

  it('keeps collapsible details open until the terminal handoff presentation ends', () => {
    const handoffDisclosure = resolveWorkspaceCanvasNodeDisclosure({
      kind: 'editShotExecutionPlan',
      isStreaming: false,
      hasStreamPresentation: true,
    })
    const formalDisclosure = resolveWorkspaceCanvasNodeDisclosure({
      kind: 'editShotExecutionPlan',
      isStreaming: false,
      hasStreamPresentation: false,
    })

    expect(handoffDisclosure).toMatchObject({
      effectiveExpanded: true,
      mode: 'expanded',
      canToggle: false,
      isStreamPresentationExpanded: true,
    })
    expect(formalDisclosure).toMatchObject({
      effectiveExpanded: false,
      mode: 'collapsed',
      canToggle: true,
      isStreamPresentationExpanded: false,
    })
  })
})
