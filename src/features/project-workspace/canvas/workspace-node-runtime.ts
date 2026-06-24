import type {
  TaskRuntimeStateLike,
  TaskRuntimeTarget,
} from '@/lib/task/runtime-targets'
import {
  isTaskRuntimeRunningPhase,
  taskRuntimeTargetQueryKey,
} from '@/lib/task/runtime-targets'
import type {
  WorkspaceCanvasEditAssetGroupDetails,
  WorkspaceCanvasEditAssetGroupItem,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeData,
} from './node-canvas-types'

export interface WorkspaceNodeRuntimeLabels {
  readonly running: string
  readonly failed: string
}

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

function firstRunningState(states: readonly TaskRuntimeStateLike[]): TaskRuntimeStateLike | null {
  return states.find((state) => isTaskRuntimeRunningPhase(state.phase)) ?? null
}

function firstFailedState(states: readonly TaskRuntimeStateLike[]): TaskRuntimeStateLike | null {
  return states.find((state) => state.phase === 'failed') ?? null
}

function readErrorMessage(state: TaskRuntimeStateLike | null): string | null {
  const message = state?.lastError?.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

function optimisticTaskProgress(node: WorkspaceCanvasFlowNode): TaskRuntimeStateLike | null {
  const target = node.data.runtimeTargets?.[0]
  const taskType = target?.types?.[0]
  if (!target || !taskType) return null
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phase: 'processing',
    runningTaskId: `optimistic:${node.id}:${taskType}`,
    runningTaskType: taskType,
    updatedAt: null,
    lastError: null,
  }
}

function optimisticAssetTaskProgress(asset: WorkspaceCanvasEditAssetGroupItem): TaskRuntimeStateLike | null {
  const target = asset.runtimeTarget
  const taskType = target?.types?.[0]
  if (!target || !taskType) return null
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phase: 'processing',
    runningTaskId: `optimistic:${asset.requirementId}:${taskType}`,
    runningTaskType: taskType,
    updatedAt: null,
    lastError: null,
  }
}

function resolveEditAssetItemRuntimePatch(input: {
  readonly asset: WorkspaceCanvasEditAssetGroupItem
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
  readonly labels: WorkspaceNodeRuntimeLabels
}): WorkspaceCanvasEditAssetGroupItem {
  const state = input.asset.runtimeTarget
    ? input.statesByQueryKey.get(taskRuntimeTargetQueryKey(input.asset.runtimeTarget)) ?? null
    : null

  if (state && isTaskRuntimeRunningPhase(state.phase)) {
    return {
      ...input.asset,
      isRunning: true,
      statusLabel: input.labels.running,
      taskProgress: state,
    }
  }

  if (state?.phase === 'failed') {
    return {
      ...input.asset,
      isRunning: false,
      statusLabel: input.labels.failed,
      taskProgress: state,
    }
  }

  if (input.asset.isRunning) {
    return {
      ...input.asset,
      statusLabel: input.labels.running,
      taskProgress: input.asset.taskProgress ?? optimisticAssetTaskProgress(input.asset),
    }
  }

  if (input.asset.taskProgress) {
    return {
      ...input.asset,
      taskProgress: null,
    }
  }

  return input.asset
}

function resolveEditAssetGroupRuntimeDetails(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
  readonly labels: WorkspaceNodeRuntimeLabels
}): WorkspaceCanvasEditAssetGroupDetails | null {
  const details = input.node.data.editAssetGroupDetails
  if (input.node.data.kind !== 'editAssetGroup' || !details) return null
  return {
    ...details,
    assets: details.assets.map((asset) => resolveEditAssetItemRuntimePatch({
      asset,
      statesByQueryKey: input.statesByQueryKey,
      labels: input.labels,
    })),
  }
}

function withRuntimeErrorMessage(
  node: WorkspaceCanvasFlowNode,
  patch: Partial<WorkspaceCanvasNodeData>,
  errorMessage: string | null,
): Partial<WorkspaceCanvasNodeData> {
  if (!errorMessage) return patch

  if (node.data.kind === 'videoPlan' && node.data.videoPlanDetails) {
    return {
      ...patch,
      videoPlanDetails: {
        ...node.data.videoPlanDetails,
        errorMessage,
      },
    }
  }

  if (node.data.kind === 'bgmScore' && node.data.bgmScoreDetails) {
    return {
      ...patch,
      meta: errorMessage,
      bgmScoreDetails: {
        ...node.data.bgmScoreDetails,
        errorMessage,
      },
    }
  }

  if (node.data.kind === 'finalTimeline') {
    return {
      ...patch,
      meta: errorMessage,
    }
  }

  if (node.data.kind === 'storyboardPanelGeneration') {
    return {
      ...patch,
      body: errorMessage,
    }
  }

  return patch
}

export function resolveWorkspaceNodeRuntimePatch(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
  readonly isOptimisticallyRunning: boolean
  readonly labels: WorkspaceNodeRuntimeLabels
}): Partial<WorkspaceCanvasNodeData> {
  const states = orderedRuntimeStates(input.node, input.statesByQueryKey)
  const runningState = firstRunningState(states)
  const editAssetGroupDetails = resolveEditAssetGroupRuntimeDetails({
    node: input.node,
    statesByQueryKey: input.statesByQueryKey,
    labels: input.labels,
  })
  const editAssetGroupPatch = editAssetGroupDetails ? { editAssetGroupDetails } : {}
  if (runningState || input.isOptimisticallyRunning) {
    return {
      ...editAssetGroupPatch,
      isRunning: true,
      statusLabel: input.labels.running,
      taskProgress: runningState ?? optimisticTaskProgress(input.node),
    }
  }

  const failedState = firstFailedState(states)
  if (failedState) {
    return withRuntimeErrorMessage(input.node, {
      ...editAssetGroupPatch,
      isRunning: false,
      statusLabel: input.labels.failed,
      taskProgress: failedState,
    }, readErrorMessage(failedState))
  }

  if (typeof input.node.data.isRunning === 'boolean') {
    return {
      ...editAssetGroupPatch,
      isRunning: input.node.data.isRunning,
      statusLabel: input.node.data.statusLabel,
      taskProgress: input.node.data.isRunning ? input.node.data.taskProgress ?? optimisticTaskProgress(input.node) : null,
    }
  }
  return {
    ...editAssetGroupPatch,
    statusLabel: input.node.data.statusLabel,
    taskProgress: null,
  }
}
