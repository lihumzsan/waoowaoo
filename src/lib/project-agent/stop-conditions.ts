import {
  normalizeOperationRuntimeSignal,
  type OperationRuntimeSignal,
} from './runtime-signal'
import type { ProjectAgentStopPartData } from './types'

export const PROJECT_AGENT_MAX_TURNS = 12

export interface ProjectAgentToolOutputSignalInput {
  toolName: string
  output: unknown
}

type RuntimeSignalDescriptor =
  | {
    reason: 'awaiting_external_task'
    operationId: string
    taskIds: string[]
    phases: string[]
  }
  | {
    reason: 'awaiting_user_confirmation'
    operationId: string
  }
  | {
    reason: 'tool_error'
    operationId: string
    code?: string
  }

function signalToDescriptor(signal: OperationRuntimeSignal): RuntimeSignalDescriptor | null {
  if (signal.kind === 'await_task' || signal.kind === 'active_status') {
    return {
      reason: 'awaiting_external_task',
      operationId: signal.operationId,
      taskIds: signal.taskIds,
      phases: signal.phases,
    }
  }
  if (signal.kind === 'await_user_confirmation') {
    return {
      reason: 'awaiting_user_confirmation',
      operationId: signal.operationId,
    }
  }
  if (signal.kind === 'tool_error') {
    return {
      reason: 'tool_error',
      operationId: signal.operationId,
      ...(signal.code ? { code: signal.code } : {}),
    }
  }
  return null
}

function mergeDescriptors(
  stepCount: number,
  descriptors: RuntimeSignalDescriptor[],
): ProjectAgentStopPartData | null {
  const firstReason = descriptors[0]?.reason
  if (!firstReason) return null
  const matching = descriptors.filter((descriptor) => descriptor.reason === firstReason)

  if (firstReason === 'awaiting_external_task') {
    const externalTaskDescriptors = matching.filter((descriptor): descriptor is Extract<RuntimeSignalDescriptor, { reason: 'awaiting_external_task' }> => (
      descriptor.reason === 'awaiting_external_task'
    ))
    return {
      reason: firstReason,
      stepCount,
      operationIds: Array.from(new Set(externalTaskDescriptors.map((descriptor) => descriptor.operationId))).sort(),
      taskIds: Array.from(new Set(externalTaskDescriptors.flatMap((descriptor) => descriptor.taskIds))).sort(),
      phases: Array.from(new Set(externalTaskDescriptors.flatMap((descriptor) => descriptor.phases))).sort(),
    }
  }

  if (firstReason === 'awaiting_user_confirmation') {
    return {
      reason: firstReason,
      stepCount,
      operationIds: Array.from(new Set(matching.map((descriptor) => descriptor.operationId))).sort(),
    }
  }

  const toolErrorDescriptors = matching.filter((descriptor): descriptor is Extract<RuntimeSignalDescriptor, { reason: 'tool_error' }> => (
    descriptor.reason === 'tool_error'
  ))
  return {
    reason: 'tool_error',
    stepCount,
    operationIds: Array.from(new Set(toolErrorDescriptors.map((descriptor) => descriptor.operationId))).sort(),
    codes: Array.from(new Set(toolErrorDescriptors.flatMap((descriptor) => descriptor.code ? [descriptor.code] : []))).sort(),
  }
}

export function buildProjectAgentStopPartFromToolOutputs(
  toolOutputs: ProjectAgentToolOutputSignalInput[],
): ProjectAgentStopPartData | null {
  const descriptors = toolOutputs.flatMap((result) => {
    const signal = normalizeOperationRuntimeSignal({
      toolName: result.toolName,
      output: result.output,
    })
    const descriptor = signalToDescriptor(signal)
    return descriptor ? [descriptor] : []
  })
  return mergeDescriptors(toolOutputs.length, descriptors)
}
