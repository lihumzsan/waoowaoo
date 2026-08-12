import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import type { TaskType } from '@/lib/task/types'
import { getTaskDefinition } from '@/lib/task/definition'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import type { Locale } from '@/i18n/routing'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationId,
} from './types'
import { isPlannedOperation } from './types'
import { createProjectAgentOperationRegistryForApi } from './registry'
import { assertOperationChannelAllowed } from './channel-policy'
import { submitApprovedOperationPlanTasks } from '@/lib/task/approved-plan-submitter'
import type { SubmitTaskResult } from '@/lib/task/submitter'
import {
  attachPersistedPlanIdentity,
  loadOperationPlanSnapshotByApiRequest,
  persistOperationPlanSnapshot,
} from './operation-plan-snapshot'
import { freezeProjectVideoRatioIntoPlan } from './project-video-ratio-policy'

export type OperationPlanKind = 'task_submission'

export interface PlannedTaskTarget {
  targetType: string
  targetId: string
}

export interface PlannedTask {
  id: string
  taskType: TaskType
  target: PlannedTaskTarget
  payload: Record<string, unknown>
  dedupeKey?: string | null
  locale: Locale
}

export interface PlannedTaskDependency {
  taskId: string
  taskType: TaskType
  target: PlannedTaskTarget
}

export interface PlannedTaskEdge {
  readonly sourceTaskPlanId: string
  readonly targetTaskPlanId: string
  readonly requirement: 'required_success'
}

export interface OperationPlan {
  kind: OperationPlanKind
  operationId: ProjectAgentOperationId
  projectId: string
  userId: string
  tasks: PlannedTask[]
  taskDependencies?: PlannedTaskDependency[]
  taskEdges?: readonly PlannedTaskEdge[]
  reservedIdentityIds?: string[]
  summary?: string | null
  metadata?: Record<string, unknown>
}

export interface OperationPlanView {
  /** Stable API generation intent carried unchanged through plan/grant/execute. */
  operationRequestId?: string
  planSnapshotId?: string
  inputHash?: string
  planHash?: string
  operationId: ProjectAgentOperationId
  kind: OperationPlanKind
  taskCount: number
  tasks: Array<{
    id: string
    taskType: TaskType
    targetType: string
    targetId: string
  }>
}

export function assertOperationPlanTaskResourceScopes(plan: OperationPlan): void {
  for (const task of plan.tasks) {
    resolveWorkspaceResourceRefs({
      impact: getTaskDefinition(task.taskType).terminalResourceImpact,
      projectId: plan.projectId,
    })
  }
}

export function createPlannedTask(params: {
  id: string
  taskType: TaskType
  targetType: string
  targetId: string
  payload: Record<string, unknown>
  locale: PlannedTask['locale']
  dedupeKey?: string | null
}): PlannedTask {
  return {
    id: params.id,
    taskType: params.taskType,
    target: {
      targetType: params.targetType,
      targetId: params.targetId,
    },
    payload: params.payload,
    locale: params.locale,
    dedupeKey: params.dedupeKey ?? null,
  }
}

function projectOperationPlanView(
  plan: OperationPlan,
): OperationPlanView {
  return {
    operationId: plan.operationId,
    kind: plan.kind,
    taskCount: plan.tasks.length,
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      taskType: task.taskType,
      targetType: task.target.targetType,
      targetId: task.target.targetId,
    })),
  }
}

export async function toOperationPlanView(plan: OperationPlan): Promise<OperationPlanView> {
  assertOperationPlanTaskResourceScopes(plan)
  return projectOperationPlanView(plan)
}

export async function persistOperationPlanView(params: {
  plan: OperationPlan
  executionContractRevision: string
  normalizedInput: unknown
  apiRequestId?: string | null
  apiRequestContext?: unknown
}): Promise<OperationPlanView> {
  const snapshot = await persistOperationPlanSnapshot({
    plan: params.plan,
    executionContractRevision: params.executionContractRevision,
    normalizedInput: params.normalizedInput,
    apiRequestId: params.apiRequestId,
    apiRequestContext: params.apiRequestContext,
  })
  return attachPersistedPlanIdentity(
    projectOperationPlanView(snapshot.plan),
    snapshot,
  )
}

export async function submitPlannedOperationTask(params: {
  ctx: ProjectAgentOperationContext
  task: PlannedTask
  operationId: string
}): Promise<SubmitTaskResult> {
  const results = await submitPlannedOperationTasks({
    ctx: params.ctx,
    operationId: params.operationId,
  })
  if (results.size !== 1) {
    throw new Error(`OPERATION_PLAN_BATCH_SUBMISSION_REQUIRED:${params.operationId}:${String(results.size)}`)
  }
  const result = results.get(params.task.id)
  if (!result) {
    throw new Error(`OPERATION_PLAN_TASK_RESULT_MISSING:${params.operationId}:${params.task.id}`)
  }
  return result
}

export async function submitPlannedOperationTasks(params: {
  ctx: ProjectAgentOperationContext
  operationId: string
}): Promise<Map<string, SubmitTaskResult>> {
  const authorization = params.ctx.executionAuthorization
  if (!authorization) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_EXECUTION_AUTHORIZATION_REQUIRED',
      operationId: params.operationId,
    })
  }
  const results = await submitApprovedOperationPlanTasks({
    ...authorization,
    operationSource: params.ctx.source,
  })
  return results
}

export async function planOperation<Input>(params: {
  operation: ProjectAgentOperationDefinition<Input, unknown>
  ctx: ProjectAgentOperationContext
  input: Input
}): Promise<OperationPlan> {
  if (!params.operation.plan) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PLAN_UNAVAILABLE',
      message: `operation plan unavailable: ${params.operation.id}`,
    })
  }
  const plan = await params.operation.plan(params.ctx, params.input)
  return await freezeProjectVideoRatioIntoPlan(plan)
}

export async function planProjectAgentOperationFromApi(params: {
  request: NextRequest
  operationId: string
  projectId: string
  userId: string
  operationRequestId?: string | null
  context?: {
    locale?: string | null
    selectedScopeRef?: string | null
    selectedAssetId?: string | null
  }
  input: unknown
  source?: string
}): Promise<OperationPlanView> {
  const registry = createProjectAgentOperationRegistryForApi()
  const operation = registry[params.operationId]
  if (!operation) {
    throw new ApiError('NOT_FOUND', {
      message: `operation not found: ${params.operationId}`,
    })
  }
  assertOperationChannelAllowed(operation, 'api')
  if (!isPlannedOperation(operation)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_PLAN_UNAVAILABLE',
      message: `operation plan unavailable: ${params.operationId}`,
    })
  }
  const parsed = operation.inputSchema.safeParse(params.input)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'INVALID_PARAMS',
      issues: parsed.error.issues,
    })
  }
  const operationRequestId = params.operationRequestId?.trim() || null
  const apiRequestContext = {
    locale: params.context?.locale?.trim() || null,
    selectedScopeRef: params.context?.selectedScopeRef?.trim() || null,
    selectedAssetId: params.context?.selectedAssetId?.trim() || null,
  }
  if (operationRequestId) {
    const replay = await loadOperationPlanSnapshotByApiRequest({
      userId: params.userId,
      projectId: params.projectId,
      operationId: operation.id,
      apiRequestId: operationRequestId,
      executionContractRevision: operation.planContractRevision,
      normalizedInput: parsed.data,
      apiRequestContext,
    })
    if (replay) {
      return {
        ...attachPersistedPlanIdentity(
          projectOperationPlanView(replay.plan),
          replay,
        ),
        operationRequestId,
      }
    }
  }
  const plan = await planOperation({
    operation,
    ctx: {
      request: params.request,
      requestId: operationRequestId,
      userId: params.userId,
      projectId: params.projectId,
      context: {
        ...(apiRequestContext.locale ? { locale: apiRequestContext.locale } : {}),
        ...(apiRequestContext.selectedScopeRef
          ? { selectedScopeRef: apiRequestContext.selectedScopeRef }
          : {}),
        ...(apiRequestContext.selectedAssetId
          ? { selectedAssetId: apiRequestContext.selectedAssetId }
          : {}),
      },
      source: params.source || 'project-ui',
      writer: null,
      toolCallId: null,
    },
    input: parsed.data,
  })
  const view = await persistOperationPlanView({
    plan,
    executionContractRevision: operation.planContractRevision,
    normalizedInput: parsed.data,
    apiRequestId: operationRequestId,
    apiRequestContext,
  })
  return operationRequestId
    ? { ...view, operationRequestId }
    : view
}
