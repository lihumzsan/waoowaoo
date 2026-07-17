import { randomUUID } from 'node:crypto'
import type { ProjectAgentTaskSubmissionReceipt } from '@/lib/operations/types'
import {
  assignProjectAgentRunFence,
  createInitialProjectAgentRunFence,
  type ProjectAgentRunFence,
} from './run-fence'

export interface ProjectAgentOperationBatchIdentity {
  readonly batchId: string
  readonly originRunId: string
  readonly backgroundRunId: string
  readonly waitId: string
  readonly activityId: string
  readonly primaryOperationId: string
}

export interface ProjectAgentOperationBatchMember {
  readonly toolCallId: string
  readonly operationId: string
  readonly taskIds: readonly string[]
  readonly receipt: ProjectAgentTaskSubmissionReceipt
}

export interface ProjectAgentOperationBatchCoordinator {
  claim(operationId: string): ProjectAgentOperationBatchIdentity
  readRunFence(): ProjectAgentRunFence
  commitMember(input: {
    toolCallId: string
    operationId: string
    taskIds: readonly string[]
    receipt: ProjectAgentTaskSubmissionReceipt
    runFence: ProjectAgentRunFence
  }): void
  readMembers(): readonly ProjectAgentOperationBatchMember[]
}

function normalizeIdentity(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function normalizeTaskIds(taskIds: readonly string[]): string[] {
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
}

export function createProjectAgentOperationBatchCoordinator(input: {
  originRunId: string
}): ProjectAgentOperationBatchCoordinator {
  const originRunId = normalizeIdentity(input.originRunId, 'PROJECT_AGENT_OPERATION_BATCH_ORIGIN_RUN_REQUIRED')
  const batchId = randomUUID()
  const backgroundRunId = randomUUID()
  const waitId = randomUUID()
  const activityId = randomUUID()
  const backgroundRunFence = createInitialProjectAgentRunFence(backgroundRunId)
  let primaryOperationId: string | null = null
  const members = new Map<string, ProjectAgentOperationBatchMember>()

  const identity = (): ProjectAgentOperationBatchIdentity => {
    if (!primaryOperationId) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_EMPTY:${batchId}`)
    return {
      batchId,
      originRunId,
      backgroundRunId,
      waitId,
      activityId,
      primaryOperationId,
    }
  }

  return {
    claim(operationId) {
      const normalizedOperationId = normalizeIdentity(
        operationId,
        'PROJECT_AGENT_OPERATION_BATCH_OPERATION_REQUIRED',
      )
      primaryOperationId ??= normalizedOperationId
      return identity()
    },
    readRunFence() {
      return { ...backgroundRunFence }
    },
    commitMember(inputMember) {
      const toolCallId = normalizeIdentity(
        inputMember.toolCallId,
        'PROJECT_AGENT_OPERATION_BATCH_TOOL_CALL_REQUIRED',
      )
      const operationId = normalizeIdentity(
        inputMember.operationId,
        'PROJECT_AGENT_OPERATION_BATCH_OPERATION_REQUIRED',
      )
      const batch = identity()
      const taskIds = normalizeTaskIds(inputMember.taskIds)
      if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_OPERATION_BATCH_TASKS_EMPTY:${toolCallId}`)
      if (
        inputMember.receipt.batchId !== batch.batchId
        || inputMember.receipt.backgroundRunId !== batch.backgroundRunId
        || inputMember.receipt.waitId !== batch.waitId
        || inputMember.receipt.operationId !== operationId
        || JSON.stringify(normalizeTaskIds(inputMember.receipt.taskIds)) !== JSON.stringify(taskIds)
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_BATCH_RECEIPT_MISMATCH:${toolCallId}`)
      }
      const existing = members.get(toolCallId)
      if (existing) {
        throw new Error(`PROJECT_AGENT_OPERATION_BATCH_MEMBER_DUPLICATE:${toolCallId}`)
      }
      members.set(toolCallId, {
        toolCallId,
        operationId,
        taskIds,
        receipt: inputMember.receipt,
      })
      assignProjectAgentRunFence(backgroundRunFence, inputMember.runFence)
    },
    readMembers() {
      return Array.from(members.values())
    },
  }
}
