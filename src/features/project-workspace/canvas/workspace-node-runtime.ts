import type {
  TaskRuntimeStateLike,
  TaskRuntimeTarget,
} from '@/lib/task/runtime-targets'
import {
  isTaskRuntimeStateRunning,
  taskRuntimeTargetQueryKey,
} from '@/lib/task/runtime-targets'
import {
  resolveWorkspaceCanvasLifecycle,
  type WorkspaceCanvasLifecycle,
  type WorkspaceCanvasPersistedPhase,
} from './lifecycle/workspace-canvas-lifecycle'
import type {
  WorkspaceCanvasEditAssetGroupDetails,
  WorkspaceCanvasEditAssetGroupItem,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeData,
} from './node-canvas-types'
import type { WorkspaceCanvasStreamPatch } from './structured-stream/workspace-structured-stream-runtime-types'

export function collectWorkspaceNodeRuntimeTargets(
  nodes: readonly WorkspaceCanvasFlowNode[],
): TaskRuntimeTarget[] {
  const targetsByKey = new Map<string, TaskRuntimeTarget>()
  for (const node of nodes) {
    for (const target of node.data.runtimeTargets ?? []) {
      targetsByKey.set(taskRuntimeTargetQueryKey(target), target)
    }
  }
  return Array.from(targetsByKey.values())
}

function orderedRuntimeStates(
  node: WorkspaceCanvasFlowNode,
  statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>,
): TaskRuntimeStateLike[] {
  const states: TaskRuntimeStateLike[] = []
  for (const target of node.data.runtimeTargets ?? []) {
    const state = statesByQueryKey.get(taskRuntimeTargetQueryKey(target))
    if (state) states.push(state)
  }
  return states
}

function authoritativeTaskState(states: readonly TaskRuntimeStateLike[]): TaskRuntimeStateLike | null {
  return states.find((state) => isTaskRuntimeStateRunning(state))
    ?? states.find((state) => state.phase === 'failed')
    ?? states.find((state) => state.phase === 'canceled' || state.phase === 'dismissed')
    ?? states.find((state) => state.phase === 'completed')
    ?? null
}

function persistedPhase(lifecycle: WorkspaceCanvasLifecycle): WorkspaceCanvasPersistedPhase {
  if (lifecycle.phase === 'succeeded') return 'succeeded'
  if (lifecycle.phase === 'failed') return 'failed'
  if (lifecycle.phase === 'canceled') return 'canceled'
  return 'pending'
}

function completedWithoutMaterializedResource(
  task: TaskRuntimeStateLike | null,
  phase: WorkspaceCanvasPersistedPhase,
): boolean {
  return task?.phase === 'completed'
    && (
      phase === 'pending'
      || task.lastError?.code?.startsWith('CANVAS_TERMINAL_RESOURCE_') === true
    )
}

function streamFact(patch: WorkspaceCanvasStreamPatch | null) {
  return patch ? {
    taskId: patch.taskId,
    taskType: patch.taskType,
    presentation: patch.presentation,
    error: patch.error,
  } : null
}

function resolveItemLifecycle(input: {
  readonly item: WorkspaceCanvasEditAssetGroupItem
  readonly state: TaskRuntimeStateLike | null
}): WorkspaceCanvasLifecycle {
  const phase = persistedPhase(input.item.lifecycle)
  return resolveWorkspaceCanvasLifecycle({
    persistedPhase: phase,
    task: input.state,
    stream: null,
    submitting: false,
    contractError: completedWithoutMaterializedResource(input.state, phase)
      ? {
          code: 'CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING',
          message: 'Task completed before its materialized asset resource reached the canvas cache.',
        }
      : null,
  })
}

function resolveEditAssetGroupRuntimeDetails(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
}): WorkspaceCanvasEditAssetGroupDetails | null {
  const details = input.node.data.editAssetGroupDetails
  if (input.node.data.kind !== 'editAssetGroup' || !details) return null
  return {
    ...details,
    assets: details.assets.map((item) => {
      const state = item.runtimeTarget
        ? input.statesByQueryKey.get(taskRuntimeTargetQueryKey(item.runtimeTarget)) ?? null
        : null
      return {
        ...item,
        lifecycle: resolveItemLifecycle({ item, state }),
      }
    }),
  }
}

/**
 * Resolves one final node view from explicit persisted, task, stream, and
 * submission facts. No React state, query client, or global ref is read here.
 */
export function resolveWorkspaceCanvasNodeData(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
  readonly streamPatch: WorkspaceCanvasStreamPatch | null
  readonly submitting: boolean
}): WorkspaceCanvasNodeData {
  const states = orderedRuntimeStates(input.node, input.statesByQueryKey)
  const task = authoritativeTaskState(states)
  const basePhase = persistedPhase(input.node.data.lifecycle)
  const lifecycle = resolveWorkspaceCanvasLifecycle({
    persistedPhase: basePhase,
    task,
    stream: streamFact(input.streamPatch),
    submitting: input.submitting,
    contractError: completedWithoutMaterializedResource(task, basePhase)
      ? {
          code: 'CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING',
          message: 'Task completed before its materialized resource reached the canvas cache.',
        }
      : null,
  })
  const acceptsStreamContent = lifecycle.phase === 'streaming'
    || (lifecycle.phase === 'failed' && input.streamPatch?.error !== null)
  const editAssetGroupDetails = resolveEditAssetGroupRuntimeDetails(input)

  return {
    ...input.node.data,
    ...(acceptsStreamContent ? input.streamPatch?.data ?? {} : {}),
    lifecycle,
    ...(editAssetGroupDetails ? { editAssetGroupDetails } : {}),
  }
}
