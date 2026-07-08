import { buildDiagnosticsSignature, classifyTaskFailure } from './diagnostics'
import type { E2eDiagnostics } from './diagnostics-types'
import type { E2eFailure } from './types'

export interface E2eWatchdogState {
  readonly startedAt: number
  readonly lastProgressAt: number
  readonly lastSignature: string | null
}

export function createE2eWatchdogState(now = Date.now()): E2eWatchdogState {
  return {
    startedAt: now,
    lastProgressAt: now,
    lastSignature: null,
  }
}

export function updateE2eWatchdogState(input: {
  readonly state: E2eWatchdogState
  readonly diagnostics: E2eDiagnostics
  readonly now?: number
}): E2eWatchdogState {
  const now = input.now ?? Date.now()
  const signature = buildDiagnosticsSignature(input.diagnostics)
  if (signature !== input.state.lastSignature) {
    return {
      startedAt: input.state.startedAt,
      lastProgressAt: now,
      lastSignature: signature,
    }
  }
  return input.state
}

export function findE2eTerminalFailure(input: {
  readonly diagnostics: E2eDiagnostics
  readonly stageTimeoutMs: number
  readonly overallTimeoutMs: number
  readonly state: E2eWatchdogState
  readonly now?: number
}): E2eFailure | null {
  const now = input.now ?? Date.now()
  if (now - input.state.startedAt > input.overallTimeoutMs) {
    return {
      status: 'SYSTEM_FAIL',
      code: 'E2E_OVERALL_TIMEOUT',
      message: `overall timeout exceeded at workflow stage ${input.diagnostics.workflow.stage}`,
    }
  }
  if (now - input.state.lastProgressAt > input.stageTimeoutMs) {
    return {
      status: 'SYSTEM_FAIL',
      code: 'E2E_STUCK',
      message: `no workflow, task, wait, or interruption progress for ${String(input.stageTimeoutMs)}ms at stage ${input.diagnostics.workflow.stage}`,
    }
  }
  if (input.diagnostics.workflow.stage === 'failed') {
    return {
      status: 'SYSTEM_FAIL',
      code: 'E2E_WORKFLOW_FAILED',
      message: input.diagnostics.workflow.blocking.reason ?? 'workflow entered failed stage',
    }
  }
  const failedTasks = input.diagnostics.tasks.filter((task) => task.status === 'failed')
  if (failedTasks.length === 0) return null
  const providerFailures = failedTasks.filter((task) => classifyTaskFailure(task) === 'provider')
  if (providerFailures.length === failedTasks.length) {
    return {
      status: 'PROVIDER_FAIL',
      code: 'E2E_PROVIDER_TASK_FAILED',
      message: providerFailures.map((task) => `${task.type}:${task.errorCode ?? task.errorMessage ?? task.id}`).join('; '),
    }
  }
  const systemFailures = failedTasks.filter((task) => classifyTaskFailure(task) === 'system')
  return {
    status: 'SYSTEM_FAIL',
    code: 'E2E_SYSTEM_TASK_FAILED',
    message: systemFailures.map((task) => `${task.type}:${task.errorCode ?? task.errorMessage ?? task.id}`).join('; '),
  }
}
