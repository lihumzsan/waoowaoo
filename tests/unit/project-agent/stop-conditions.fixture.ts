import type {
  ProjectAgentOperationOutcome,
  ProjectAgentToolErrorCode,
} from '@/lib/operations/types'

function toolErrorOutput(operationId: string, code: ProjectAgentToolErrorCode) {
  return {
    toolName: operationId,
    outcome: {
      kind: 'failed' as const,
      error: {
        operationId,
        code,
        message: code,
      },
    },
  }
}

function submittedTasksOutput(operationId: string, taskIds: readonly string[]) {
  return {
    toolName: operationId,
    outcome: {
      kind: 'submitted_tasks' as const,
      data: {},
      receipt: {
        kind: 'task_submission' as const,
        batchId: 'batch-1',
        backgroundRunId: 'background-run-1',
        operationId,
        waitId: `wait:${operationId}`,
        taskIds,
      },
    },
  }
}

function completedOutput(operationId: string) {
  return {
    toolName: operationId,
    outcome: { kind: 'completed' as const, data: {} },
  }
}

function noopOutput(operationId: string) {
  return {
    toolName: operationId,
    outcome: { kind: 'noop' as const, data: {} },
  }
}

function waitChoiceOutput(operationId: string) {
  return {
    toolName: operationId,
    outcome: {
      kind: 'wait_choice' as const,
      data: {},
      choiceHandoff: {
        kind: 'choice' as const,
        handoffId: `handoff:${operationId}`,
        executionSegmentId: 'segment-1',
        runId: 'run-1',
        operationId,
        toolCallId: `call:${operationId}`,
      },
    },
  }
}

function waitApprovalOutput(operationId: string) {
  return {
    toolName: operationId,
    outcome: { kind: 'wait_approval' as const },
  }
}

function typedOutcome(output: { toolName: string; outcome: ProjectAgentOperationOutcome }) {
  return output
}

export { describe, expect, it } from 'vitest'
export { PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION, PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN, PROJECT_AGENT_MAX_TURNS, createProjectAgentStopController } from '@/lib/project-agent/stop-conditions'
export {
  completedOutput,
  noopOutput,
  submittedTasksOutput,
  toolErrorOutput,
  typedOutcome,
  waitApprovalOutput,
  waitChoiceOutput,
}
