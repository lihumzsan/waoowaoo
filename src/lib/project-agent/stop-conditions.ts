import {
  normalizeOperationRuntimeSignal,
  type OperationRuntimeSignal,
} from './runtime-signal'
import type { ProjectAgentStopPartData } from './types'

export const PROJECT_AGENT_MAX_TURNS = 12

/**
 * Tool errors are returned to the model so it can correct the call (fix
 * arguments, switch operation, explain the failure). The run only stops when
 * the same operation keeps failing, too many errors accumulate, or the error
 * is fatal (retrying can never succeed). This keeps runtime behavior aligned
 * with the system prompt, which tells the model to read error codes and decide
 * the next step.
 */
export const PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION = 2
export const PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN = 4

const FATAL_TOOL_ERROR_CODES: ReadonlySet<string> = new Set([
  'OPERATION_NOT_ALLOWED',
  'OPERATION_NOT_FOUND',
  'OPERATION_OUTPUT_INVALID',
])

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
    fatal?: boolean
  }

function signalToDescriptor(signal: OperationRuntimeSignal): RuntimeSignalDescriptor | null {
  if (signal.kind === 'await_task') {
    return {
      reason: 'awaiting_external_task',
      operationId: signal.operationId,
      taskIds: signal.taskIds,
      phases: signal.phases,
    }
  }
  if (signal.kind === 'active_status') return null
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
      ...(signal.fatal ? { fatal: true } : {}),
    }
  }
  return null
}

function mergeAwaitDescriptors(
  stepCount: number,
  firstReason: 'awaiting_external_task' | 'awaiting_user_confirmation',
  descriptors: RuntimeSignalDescriptor[],
): ProjectAgentStopPartData {
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

  return {
    reason: firstReason,
    stepCount,
    operationIds: Array.from(new Set(matching.map((descriptor) => descriptor.operationId))).sort(),
  }
}

export interface ProjectAgentStopController {
  evaluateStep(toolOutputs: ProjectAgentToolOutputSignalInput[]): ProjectAgentStopPartData | null
}

export function createProjectAgentStopController(): ProjectAgentStopController {
  const errorCountByOperation = new Map<string, number>()
  let totalErrorCount = 0
  let totalStepOutputCount = 0

  return {
    evaluateStep(toolOutputs) {
      totalStepOutputCount += toolOutputs.length
      const descriptors = toolOutputs.flatMap((result) => {
        const signal = normalizeOperationRuntimeSignal({
          toolName: result.toolName,
          output: result.output,
        })
        const descriptor = signalToDescriptor(signal)
        return descriptor ? [descriptor] : []
      })

      const awaitReason = descriptors.find((descriptor) => (
        descriptor.reason === 'awaiting_external_task' || descriptor.reason === 'awaiting_user_confirmation'
      ))?.reason
      if (awaitReason === 'awaiting_external_task' || awaitReason === 'awaiting_user_confirmation') {
        return mergeAwaitDescriptors(totalStepOutputCount, awaitReason, descriptors)
      }

      const errorDescriptors = descriptors.filter((descriptor): descriptor is Extract<RuntimeSignalDescriptor, { reason: 'tool_error' }> => (
        descriptor.reason === 'tool_error'
      ))
      if (errorDescriptors.length === 0) return null

      let exhausted = false
      for (const descriptor of errorDescriptors) {
        totalErrorCount += 1
        const operationErrorCount = (errorCountByOperation.get(descriptor.operationId) ?? 0) + 1
        errorCountByOperation.set(descriptor.operationId, operationErrorCount)
        if (descriptor.fatal) exhausted = true
        if (descriptor.code && FATAL_TOOL_ERROR_CODES.has(descriptor.code)) exhausted = true
        if (operationErrorCount >= PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION) exhausted = true
      }
      if (totalErrorCount >= PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN) exhausted = true
      if (!exhausted) return null

      return {
        reason: 'tool_error',
        stepCount: totalStepOutputCount,
        operationIds: Array.from(new Set(errorDescriptors.map((descriptor) => descriptor.operationId))).sort(),
        codes: Array.from(new Set(errorDescriptors.flatMap((descriptor) => descriptor.code ? [descriptor.code] : []))).sort(),
      }
    },
  }
}
