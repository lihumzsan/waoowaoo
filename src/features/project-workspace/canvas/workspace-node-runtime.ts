import type {
  TaskRuntimeStateLike,
  TaskRuntimeTarget,
} from '@/lib/task/runtime-targets'
import {
  isTaskRuntimeStateRunning,
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
  readonly pending: string
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
  return states.find((state) => isTaskRuntimeStateRunning(state)) ?? null
}

function firstFailedState(states: readonly TaskRuntimeStateLike[]): TaskRuntimeStateLike | null {
  return states.find((state) => state.phase === 'failed') ?? null
}

function readErrorMessage(state: TaskRuntimeStateLike | null): string | null {
  const message = state?.lastError?.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

function resolveEditAssetItemRuntimePatch(input: {
  readonly asset: WorkspaceCanvasEditAssetGroupItem
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
  readonly labels: WorkspaceNodeRuntimeLabels
}): WorkspaceCanvasEditAssetGroupItem {
  const state = input.asset.runtimeTarget
    ? input.statesByQueryKey.get(taskRuntimeTargetQueryKey(input.asset.runtimeTarget)) ?? null
    : null

  if (state && isTaskRuntimeStateRunning(state)) {
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
      isRunning: false,
      statusLabel: input.labels.pending,
      taskProgress: null,
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

  if (node.data.kind === 'soundscape' && node.data.soundscapeDetails) {
    return {
      ...patch,
      meta: errorMessage,
      soundscapeDetails: {
        ...node.data.soundscapeDetails,
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

  return patch
}

export function resolveWorkspaceNodeRuntimePatch(input: {
  readonly node: WorkspaceCanvasFlowNode
  readonly statesByQueryKey: ReadonlyMap<string, TaskRuntimeStateLike>
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
  if (runningState) {
    return {
      ...editAssetGroupPatch,
      artifactPhase: 'running',
      isRunning: true,
      statusLabel: input.labels.running,
      taskProgress: runningState,
    }
  }

  const failedState = firstFailedState(states)
  if (failedState) {
    return withRuntimeErrorMessage(input.node, {
      ...editAssetGroupPatch,
      artifactPhase: 'failed',
      isRunning: false,
      statusLabel: input.labels.failed,
      taskProgress: failedState,
    }, readErrorMessage(failedState))
  }

  if (typeof input.node.data.isRunning === 'boolean') {
    const missingActiveTask = input.node.data.isRunning === true
    return {
      ...editAssetGroupPatch,
      artifactPhase: missingActiveTask ? undefined : input.node.data.artifactPhase,
      isRunning: false,
      statusLabel: missingActiveTask ? input.labels.pending : input.node.data.statusLabel,
      taskProgress: null,
    }
  }
  return {
    ...editAssetGroupPatch,
    artifactPhase: input.node.data.artifactPhase,
    statusLabel: input.node.data.statusLabel,
    taskProgress: null,
  }
}
