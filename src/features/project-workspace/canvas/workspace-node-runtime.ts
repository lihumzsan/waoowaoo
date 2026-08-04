import type { TaskRuntimeStateLike, TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import {
  isTaskRuntimeStateRunning,
  taskRuntimeTargetQueryKey,
} from '@/lib/task/runtime-targets'
import {
  resolveWorkspaceCanvasLifecycle,
  type WorkspaceCanvasPersistedPhase,
} from './lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasFlowNode, WorkspaceCanvasNodeData } from './node-canvas-types'

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

function authoritativeTaskState(
  node: WorkspaceCanvasFlowNode,
  statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>,
): TaskRuntimeStateLike | null {
  const states = (node.data.runtimeTargets ?? []).flatMap((target) => {
    const state = statesByQueryKey.get(taskRuntimeTargetQueryKey(target))
    return state ? [state] : []
  })
  return states.find(isTaskRuntimeStateRunning)
    ?? states.find((state) => state.phase === 'completed')
    ?? states.find((state) => state.phase === 'failed')
    ?? states.find((state) => state.phase === 'canceled' || state.phase === 'dismissed')
    ?? null
}

function persistedPhase(node: WorkspaceCanvasFlowNode): WorkspaceCanvasPersistedPhase {
  if (node.data.lifecycle.phase === 'succeeded') return 'succeeded'
  if (node.data.lifecycle.phase === 'failed') return 'failed'
  if (node.data.lifecycle.phase === 'canceled') return 'canceled'
  return 'pending'
}

export function resolveWorkspaceCanvasNodeData(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
}): WorkspaceCanvasNodeData {
  return {
    ...input.node.data,
    lifecycle: resolveWorkspaceCanvasLifecycle({
      persistedPhase: persistedPhase(input.node),
      task: authoritativeTaskState(input.node, input.statesByQueryKey),
    }),
  }
}
