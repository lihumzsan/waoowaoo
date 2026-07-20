import type { ProjectAgentOperationOutcome } from '@/lib/operations/types'
import type { ProjectAgentStopPartData } from './types'

export const PROJECT_AGENT_MAX_TURNS = 12

/**
 * Tool errors are returned to the model so it can correct the call (fix
 * arguments, switch operation, explain the failure). Parallel calls emitted
 * by one model step are one correction opportunity: repeated members of the
 * same Operation count once for that step, and the run-level budget advances
 * once. Fatal errors still stop immediately.
 */
export const PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION = 2
export const PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN = 4

const FATAL_TOOL_ERROR_CODES: ReadonlySet<string> = new Set([
  'OPERATION_NOT_ALLOWED',
  'OPERATION_NOT_FOUND',
  'OPERATION_PLAN_CHANGED',
  'OPERATION_OUTPUT_INVALID',
])

export interface ProjectAgentToolOutcomeInput {
  toolName: string
  outcome: ProjectAgentOperationOutcome
}

type RuntimeSignalDescriptor =
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

function outcomeToDescriptor(input: ProjectAgentToolOutcomeInput): RuntimeSignalDescriptor | null {
  const { outcome } = input
  switch (outcome.kind) {
    case 'submitted_tasks':
      return null
    case 'wait_choice':
      return {
        reason: 'awaiting_user_confirmation',
        operationId: outcome.choiceHandoff.operationId,
      }
    case 'wait_approval':
      return {
        reason: 'awaiting_user_confirmation',
        operationId: input.toolName,
      }
    case 'failed':
      return {
        reason: 'tool_error',
        operationId: outcome.error.operationId ?? input.toolName,
        code: outcome.error.code,
      }
    case 'completed':
    case 'noop':
      return null
  }
}

function mergeAwaitDescriptors(
  stepCount: number,
  firstReason: 'awaiting_user_confirmation',
  descriptors: RuntimeSignalDescriptor[],
): ProjectAgentStopPartData {
  const matching = descriptors.filter((descriptor) => descriptor.reason === firstReason)

  return {
    reason: firstReason,
    stepCount,
    operationIds: Array.from(new Set(matching.map((descriptor) => descriptor.operationId))).sort(),
  }
}

export interface ProjectAgentStopController {
  evaluateStep(outcomes: ProjectAgentToolOutcomeInput[]): ProjectAgentStopPartData | null
}

export function createProjectAgentStopController(): ProjectAgentStopController {
  const errorCountByOperation = new Map<string, number>()
  let totalErrorCount = 0
  let totalStepCount = 0

  return {
    evaluateStep(outcomes) {
      totalStepCount += 1
      const descriptors = outcomes.flatMap((outcome) => {
        const descriptor = outcomeToDescriptor(outcome)
        return descriptor ? [descriptor] : []
      })

      const awaitReason = descriptors.find((descriptor) => (
        descriptor.reason === 'awaiting_user_confirmation'
      ))?.reason
      if (awaitReason === 'awaiting_user_confirmation') {
        return mergeAwaitDescriptors(totalStepCount, awaitReason, descriptors)
      }

      const errorDescriptors = descriptors.filter((descriptor): descriptor is Extract<RuntimeSignalDescriptor, { reason: 'tool_error' }> => (
        descriptor.reason === 'tool_error'
      ))
      if (errorDescriptors.length === 0) return null

      const fatal = errorDescriptors.some((descriptor) => (
        descriptor.fatal === true
        || (descriptor.code ? FATAL_TOOL_ERROR_CODES.has(descriptor.code) : false)
      ))
      const operationIds = Array.from(new Set(errorDescriptors.map((descriptor) => descriptor.operationId)))
      totalErrorCount += 1
      let exhausted = fatal
      for (const operationId of operationIds) {
        const operationErrorCount = (errorCountByOperation.get(operationId) ?? 0) + 1
        errorCountByOperation.set(operationId, operationErrorCount)
        if (operationErrorCount >= PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION) exhausted = true
      }
      if (totalErrorCount >= PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN) exhausted = true
      if (!exhausted) return null

      return {
        reason: 'tool_error',
        stepCount: totalStepCount,
        operationIds: operationIds.sort(),
        codes: Array.from(new Set(errorDescriptors.flatMap((descriptor) => descriptor.code ? [descriptor.code] : []))).sort(),
      }
    },
  }
}
