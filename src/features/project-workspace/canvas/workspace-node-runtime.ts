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
import {
  getWorkspaceCanvasNodeDefinition,
  type WorkspaceCanvasRuntimeAggregation,
} from './registry/workspace-canvas-node-registry'
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
    for (const target of nodeRuntimeTargets(node)) {
      targetsByKey.set(taskRuntimeTargetQueryKey(target), target)
    }
  }
  return Array.from(targetsByKey.values())
}

function nodeRuntimeTargets(node: WorkspaceCanvasFlowNode): TaskRuntimeTarget[] {
  const targets = [...(node.data.runtimeTargets ?? [])]
  if (node.data.kind !== 'editAssetGroup') return targets
  for (const asset of node.data.editAssetGroupDetails?.assets ?? []) {
    if (asset.runtimeTarget) targets.push(asset.runtimeTarget)
  }
  return targets
}

function orderedRuntimeStates(
  node: WorkspaceCanvasFlowNode,
  statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>,
): TaskRuntimeStateLike[] {
  const states: TaskRuntimeStateLike[] = []
  for (const target of nodeRuntimeTargets(node)) {
    const state = statesByQueryKey.get(taskRuntimeTargetQueryKey(target))
    if (state) states.push(state)
  }
  return states
}

function authoritativeTaskState(
  states: readonly TaskRuntimeStateLike[],
  aggregation: WorkspaceCanvasRuntimeAggregation,
): TaskRuntimeStateLike | null {
  const running = states.find((state) => isTaskRuntimeStateRunning(state))
  if (running) return running

  const failed = states.find((state) => state.phase === 'failed')
  const canceled = states.find((state) => state.phase === 'canceled' || state.phase === 'dismissed')
  const completed = states.find((state) => state.phase === 'completed')
  return aggregation === 'resourceAggregate'
    ? completed ?? failed ?? canceled ?? null
    : failed ?? canceled ?? completed ?? null
}

function runtimeAggregation(node: WorkspaceCanvasFlowNode): WorkspaceCanvasRuntimeAggregation {
  const capability = getWorkspaceCanvasNodeDefinition(node.data.kind).runtime
  if (capability.kind === 'supported') return capability.value.aggregation
  if ((node.data.runtimeTargets?.length ?? 0) > 0) {
    throw new Error(`WORKSPACE_CANVAS_RUNTIME_NOT_APPLICABLE:${node.data.kind}`)
  }
  return 'failureDominant'
}

function persistedPhase(lifecycle: WorkspaceCanvasLifecycle): WorkspaceCanvasPersistedPhase {
  if (lifecycle.phase === 'succeeded') return 'succeeded'
  if (lifecycle.phase === 'failed') return 'failed'
  if (lifecycle.phase === 'canceled') return 'canceled'
  return 'pending'
}

function streamFact(patch: WorkspaceCanvasStreamPatch | null) {
  return patch && patch.terminalHandoff !== true ? {
    taskId: patch.taskId,
    taskType: patch.taskType,
    presentation: patch.presentation,
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
  const task = authoritativeTaskState(states, runtimeAggregation(input.node))
  const basePhase = persistedPhase(input.node.data.lifecycle)
  const lifecycle = resolveWorkspaceCanvasLifecycle({
    persistedPhase: basePhase,
    task,
    stream: streamFact(input.streamPatch),
    submitting: input.submitting,
  })
  const acceptsStreamContent = lifecycle.phase === 'streaming'
    || Boolean(
      input.streamPatch?.terminalHandoff === true
      && basePhase === 'pending'
      && lifecycle.phase !== 'failed'
      && lifecycle.phase !== 'canceled',
    )
  const editAssetGroupDetails = resolveEditAssetGroupRuntimeDetails(input)

  return {
    ...input.node.data,
    ...(acceptsStreamContent ? input.streamPatch?.data ?? {} : {}),
    lifecycle,
    ...(editAssetGroupDetails ? { editAssetGroupDetails } : {}),
  }
}
