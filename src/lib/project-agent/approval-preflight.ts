import type { NextRequest } from 'next/server'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import { persistOperationPlanView, planOperation, type OperationPlanView } from '@/lib/operations/planning'
import { prepareProjectAgentOperationInput } from '@/lib/operations/invocation'
import { issueApprovalGrant, type PlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
import type {
  ProjectAgentOperationDefinition,
  ProjectAgentToolResult,
} from '@/lib/operations/types'
import type { ProjectAgentContext } from './types'

type ApprovalPreflightRecord =
  | {
      status: 'planned'
      operationPlan: OperationPlanView
    }
  | {
      status: 'failed'
      result: ProjectAgentToolResult<never>
    }

export interface ProjectAgentApprovalPreflightStore {
  setPlanned(params: ApprovalPreflightKeyParams & {
    operationPlan: OperationPlanView
  }): void
  setFailed(params: ApprovalPreflightKeyParams & {
    result: ProjectAgentToolResult<never>
  }): void
  getPlanned(params: ApprovalPreflightKeyParams): OperationPlanView | null
  consumeFailed(params: ApprovalPreflightKeyParams): ProjectAgentToolResult<never> | null
}

interface ApprovalPreflightKeyParams {
  operationId: string
  toolCallId?: string | null
  input: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKeyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKeyValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeKeyValue(child)]),
  )
}

function stringifyKeyInput(value: unknown): string {
  try {
    const serialized = JSON.stringify(normalizeKeyValue(value))
    return serialized || 'null'
  } catch {
    return String(value)
  }
}

function buildApprovalPreflightKey(params: ApprovalPreflightKeyParams): string {
  const toolCallId = typeof params.toolCallId === 'string' ? params.toolCallId.trim() : ''
  if (toolCallId) return `${params.operationId}:call:${toolCallId}`
  return `${params.operationId}:input:${stringifyKeyInput(params.input)}`
}

export function createProjectAgentApprovalPreflightStore(): ProjectAgentApprovalPreflightStore {
  const records = new Map<string, ApprovalPreflightRecord>()
  return {
    setPlanned(params) {
      records.set(buildApprovalPreflightKey(params), {
        status: 'planned',
        operationPlan: params.operationPlan,
      })
    },
    setFailed(params) {
      records.set(buildApprovalPreflightKey(params), {
        status: 'failed',
        result: params.result,
      })
    },
    getPlanned(params) {
      const record = records.get(buildApprovalPreflightKey(params))
      return record?.status === 'planned' ? record.operationPlan : null
    },
    consumeFailed(params) {
      const key = buildApprovalPreflightKey(params)
      const record = records.get(key)
      if (record?.status !== 'failed') return null
      records.delete(key)
      return record.result
    },
  }
}

async function createPersistedProjectAgentOperationPlan<Input>(params: {
  request: NextRequest
  operation: ProjectAgentOperationDefinition<Input, unknown>
  projectId: string
  userId: string
  context: ProjectAgentContext
  source: string
  input: unknown
  toolCallId?: string | null
}): Promise<OperationPlanView> {
  if (!params.operation.plan) {
    throw new Error(`PROJECT_AGENT_BILLABLE_OPERATION_PLAN_REQUIRED:${params.operation.id}`)
  }
  const prepared = prepareProjectAgentOperationInput({
    channel: 'tool',
    operation: params.operation,
    context: params.context,
    input: params.input,
  })
  const plan = await planOperation({
    operation: params.operation,
    ctx: {
      request: params.request,
      userId: params.userId,
      projectId: params.projectId,
      context: params.context,
      source: params.source,
      writer: null,
      toolCallId: params.toolCallId,
    },
    input: prepared.input,
  })
  return await persistOperationPlanView({
    plan,
    executionContractRevision: params.operation.planContractRevision,
    normalizedInput: prepared.input,
    episodeId: params.context.episodeId ?? null,
  })
}

export async function authorizeProjectAgentToolAutomatically<Input>(params: {
  request: NextRequest
  operation: ProjectAgentOperationDefinition<Input, unknown>
  projectId: string
  userId: string
  context: ProjectAgentContext
  source: string
  input: unknown
  toolCallId: string
}): Promise<PlannedOperationInvocation> {
  if (params.operation.confirmation.kind !== 'billable_media') {
    throw new Error(`PROJECT_AGENT_AUTOMATIC_BILLING_GRANT_NOT_APPLICABLE:${params.operation.id}`)
  }
  const operationPlan = await createPersistedProjectAgentOperationPlan(params)
  if (!operationPlan.planSnapshotId) {
    throw new Error(`PROJECT_AGENT_OPERATION_PLAN_SNAPSHOT_REQUIRED:${params.operation.id}`)
  }
  const executionSegmentId = params.context.executionSegmentId?.trim()
  if (!executionSegmentId) {
    throw new Error(`PROJECT_AGENT_EXECUTION_SEGMENT_REQUIRED:${params.operation.id}`)
  }
  const grant = await issueApprovalGrant({
    userId: params.userId,
    planSnapshotId: operationPlan.planSnapshotId,
    requestId: `assistant-auto:${executionSegmentId}:${params.toolCallId}`,
  })
  return {
    approvalGrantId: grant.approvalGrantId,
    requestId: grant.operationRequestId,
  }
}

export async function preflightProjectAgentToolApproval<Input>(params: {
  request: NextRequest
  operation: ProjectAgentOperationDefinition<Input, unknown>
  projectId: string
  userId: string
  context: ProjectAgentContext
  source: string
  input: unknown
  toolCallId?: string | null
  store: ProjectAgentApprovalPreflightStore
}): Promise<boolean> {
  if (!params.operation.plan) return true

  try {
    params.store.setPlanned({
      operationId: params.operation.id,
      toolCallId: params.toolCallId,
      input: params.input,
      operationPlan: await createPersistedProjectAgentOperationPlan(params),
    })
    return true
  } catch (error) {
    params.store.setFailed({
      operationId: params.operation.id,
      toolCallId: params.toolCallId,
      input: params.input,
      result: {
        ok: false,
        error: normalizeOperationExecutionToolError({
          error,
          operation: params.operation,
          operationId: params.operation.id,
        }),
      },
    })
    return false
  }
}
