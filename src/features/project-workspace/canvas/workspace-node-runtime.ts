import type {
  TaskRuntimeStateLike,
  TaskRuntimeTarget,
} from '@/lib/task/runtime-targets'
import {
  isTaskRuntimeRunningPhase,
  taskRuntimeTargetQueryKey,
} from '@/lib/task/runtime-targets'
import type {
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
  if (runningState || input.isOptimisticallyRunning) {
    return {
      isRunning: true,
      statusLabel: input.labels.running,
    }
  }

  const failedState = firstFailedState(states)
  if (failedState) {
    return withRuntimeErrorMessage(input.node, {
      isRunning: false,
      statusLabel: input.labels.failed,
    }, readErrorMessage(failedState))
  }

  if (typeof input.node.data.isRunning === 'boolean') {
    return {
      isRunning: input.node.data.isRunning,
      statusLabel: input.node.data.statusLabel,
    }
  }
  return {
    statusLabel: input.node.data.statusLabel,
  }
}
