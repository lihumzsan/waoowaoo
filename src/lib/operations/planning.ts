import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo, getBillingMode } from '@/lib/billing'
import type { BillingMode, TaskBillingInfo, TaskType } from '@/lib/task/types'
import { getTaskDefinition } from '@/lib/task/definition'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import type { Locale } from '@/i18n/routing'
import { shouldExposeBillingCredits } from '@/lib/billing/task-billing-view'
import {
  requiresBillableMediaApproval,
  type BillableMediaApiType,
} from '@/lib/billing/media-approval-policy'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationId,
} from './types'
import { createProjectAgentOperationRegistryForApi } from './registry'
import { assertOperationChannelAllowed } from './channel-policy'
import { submitApprovedOperationPlanTasks } from '@/lib/task/approved-plan-submitter'
import type { SubmitTaskResult } from '@/lib/task/submitter'
import {
  attachPersistedPlanIdentity,
  persistOperationPlanSnapshot,
} from './operation-plan-snapshot'

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
  billingInfo: TaskBillingInfo
  episodeId?: string | null
  dedupeKey?: string | null
  priority?: number
  locale: Locale
}

export interface PlannedTaskDependency {
  taskId: string
  taskType: TaskType
  target: PlannedTaskTarget
  episodeId: string | null
}

export interface OperationPlan {
  kind: OperationPlanKind
  operationId: ProjectAgentOperationId
  projectId: string
  userId: string
  tasks: PlannedTask[]
  taskDependencies?: PlannedTaskDependency[]
  reservedIdentityIds?: string[]
  summary?: string | null
  metadata?: Record<string, unknown>
}

export interface BillingQuoteItemView {
  id: string
  taskType: TaskType
  targetType: string
  targetId: string
  apiType: 'image' | 'video' | 'music'
  model: string
  quantity: number
  unit: 'image' | 'video' | 'music' | 'second' | 'call'
  maxFrozenCost?: number
}

export interface BillingQuoteView {
  showCredits: boolean
  billingMode: BillingMode
  billable: boolean
  taskCount: number
  mediaTaskCount: number
  totalMaxFrozenCost?: number
  currency?: 'credits'
  items: BillingQuoteItemView[]
}

export interface OperationPlanView {
  planSnapshotId?: string
  inputHash?: string
  planHash?: string
  quoteHash?: string
  operationId: ProjectAgentOperationId
  kind: OperationPlanKind
  taskCount: number
  quote: BillingQuoteView
  tasks: Array<{
    id: string
    taskType: TaskType
    targetType: string
    targetId: string
  }>
}

/**
 * Builds the one quote shown for one model-step approval batch. Member plan
 * identities deliberately stay out of this display-only view: every member
 * keeps its own immutable snapshot and approval grant.
 */
export function mergeOperationPlanViewsForApproval(
  operationId: ProjectAgentOperationId,
  plans: readonly OperationPlanView[],
): OperationPlanView | null {
  if (plans.length === 0) return null
  const [first, ...rest] = plans
  if (!first) return null
  for (const plan of rest) {
    if (
      plan.quote.billingMode !== first.quote.billingMode
      || plan.quote.showCredits !== first.quote.showCredits
      || plan.quote.currency !== first.quote.currency
    ) {
      throw new Error('OPERATION_APPROVAL_GROUP_QUOTE_CONTRACT_MISMATCH')
    }
  }
  const tasks = plans.flatMap((plan) => plan.tasks)
  const taskIds = new Set(tasks.map((task) => task.id))
  if (taskIds.size !== tasks.length) {
    throw new Error('OPERATION_APPROVAL_GROUP_TASK_ID_DUPLICATE')
  }
  const quoteItems = plans.flatMap((plan) => plan.quote.items)
  const quoteItemIds = new Set(quoteItems.map((item) => item.id))
  if (quoteItemIds.size !== quoteItems.length) {
    throw new Error('OPERATION_APPROVAL_GROUP_QUOTE_ITEM_ID_DUPLICATE')
  }
  const totalMaxFrozenCost = first.quote.showCredits
    ? toPositiveMoney(plans.reduce((total, plan) => total + (plan.quote.totalMaxFrozenCost ?? 0), 0))
    : undefined
  return {
    operationId,
    kind: 'task_submission',
    taskCount: tasks.length,
    tasks,
    quote: {
      showCredits: first.quote.showCredits,
      billingMode: first.quote.billingMode,
      billable: plans.some((plan) => plan.quote.billable),
      taskCount: plans.reduce((total, plan) => total + plan.quote.taskCount, 0),
      mediaTaskCount: plans.reduce((total, plan) => total + plan.quote.mediaTaskCount, 0),
      items: quoteItems,
      ...(first.quote.showCredits
        ? {
            totalMaxFrozenCost,
            currency: first.quote.currency,
          }
        : {}),
    },
  }
}

function shouldExposeCredits(): boolean {
  return shouldExposeBillingCredits()
}

type BillableTaskBillingInfo = Extract<TaskBillingInfo, { billable: true }>
type QuoteVisibleMediaApiType = Extract<BillableTaskBillingInfo['apiType'], BillableMediaApiType>

function isQuoteVisibleMediaBillingInfo(
  info: TaskBillingInfo | null | undefined,
): info is BillableTaskBillingInfo & { apiType: QuoteVisibleMediaApiType } {
  return requiresBillableMediaApproval(info)
}

function toPositiveMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 1000000) / 1000000
}

export async function quoteOperationPlan(plan: OperationPlan): Promise<BillingQuoteView> {
  assertOperationPlanTaskResourceScopes(plan)
  const showCredits = shouldExposeCredits()
  const billingMode = await getBillingMode()
  const mediaTasks = plan.tasks.filter((task) => isQuoteVisibleMediaBillingInfo(task.billingInfo))
  const totalMaxFrozenCost = toPositiveMoney(mediaTasks.reduce((total, task) => {
    const info = task.billingInfo as Extract<TaskBillingInfo, { billable: true }>
    return total + info.maxFrozenCost
  }, 0))

  return {
    showCredits,
    billingMode,
    billable: mediaTasks.length > 0,
    taskCount: plan.tasks.length,
    mediaTaskCount: mediaTasks.length,
    ...(showCredits ? {
      totalMaxFrozenCost,
      currency: 'credits' as const,
    } : {}),
    items: mediaTasks.map((task) => {
      const info = task.billingInfo as BillableTaskBillingInfo & { apiType: QuoteVisibleMediaApiType }
      return {
        id: task.id,
        taskType: task.taskType,
        targetType: task.target.targetType,
        targetId: task.target.targetId,
        apiType: info.apiType,
        model: info.model,
        quantity: info.quantity,
        unit: info.unit === 'second' || info.unit === 'call' || info.unit === 'video' || info.unit === 'image'
          ? info.unit
          : info.apiType,
        ...(showCredits ? { maxFrozenCost: info.maxFrozenCost } : {}),
      }
    }),
  }
}

export function assertOperationPlanTaskResourceScopes(plan: OperationPlan): void {
  for (const task of plan.tasks) {
    resolveWorkspaceResourceRefs({
      impact: getTaskDefinition(task.taskType).terminalResourceImpact,
      projectId: plan.projectId,
      episodeId: task.episodeId ?? null,
    })
  }
}

export function createPlannedTask(params: {
  id: string
  taskType: TaskType
  targetType: string
  targetId: string
  payload: Record<string, unknown>
  billingInfo: TaskBillingInfo
  locale: PlannedTask['locale']
  episodeId?: string | null
  dedupeKey?: string | null
  priority?: number
}): PlannedTask {
  return {
    id: params.id,
    taskType: params.taskType,
    target: {
      targetType: params.targetType,
      targetId: params.targetId,
    },
    payload: params.payload,
    billingInfo: params.billingInfo,
    locale: params.locale,
    episodeId: params.episodeId ?? null,
    dedupeKey: params.dedupeKey ?? null,
    priority: params.priority,
  }
}

export function requirePlannedTaskBillingInfo(params: {
  taskType: TaskType
  payload: Record<string, unknown>
  allowedApiTypes?: readonly BillableTaskBillingInfo['apiType'][]
}): TaskBillingInfo {
  const billingInfo = buildDefaultTaskBillingInfo(params.taskType, params.payload)
  if (!billingInfo || billingInfo.billable !== true) {
    throw new Error(`PROJECT_AGENT_PLANNED_TASK_BILLING_INFO_REQUIRED:${params.taskType}`)
  }
  if (params.allowedApiTypes && !params.allowedApiTypes.includes(billingInfo.apiType)) {
    throw new Error(`PROJECT_AGENT_PLANNED_TASK_BILLING_API_TYPE_INVALID:${params.taskType}:${billingInfo.apiType}`)
  }
  return billingInfo
}

export async function toOperationPlanView(plan: OperationPlan): Promise<OperationPlanView> {
  const quote = await quoteOperationPlan(plan)
  return {
    operationId: plan.operationId,
    kind: plan.kind,
    taskCount: plan.tasks.length,
    quote,
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      taskType: task.taskType,
      targetType: task.target.targetType,
      targetId: task.target.targetId,
    })),
  }
}

export async function persistOperationPlanView(params: {
  plan: OperationPlan
  normalizedInput: unknown
  episodeId?: string | null
}): Promise<OperationPlanView> {
  const quote = await quoteOperationPlan(params.plan)
  const taskEpisodeIds = Array.from(new Set(
    params.plan.tasks
      .map((task) => task.episodeId ?? null)
      .filter((episodeId): episodeId is string => Boolean(episodeId)),
  ))
  if (taskEpisodeIds.length > 1) {
    throw new Error(`OPERATION_PLAN_EPISODE_SCOPE_AMBIGUOUS:${params.plan.operationId}`)
  }
  const plannedEpisodeId = taskEpisodeIds[0] ?? null
  const requestedEpisodeId = params.episodeId ?? null
  if (plannedEpisodeId && requestedEpisodeId && plannedEpisodeId !== requestedEpisodeId) {
    throw new Error(`OPERATION_PLAN_EPISODE_SCOPE_MISMATCH:${params.plan.operationId}`)
  }
  const snapshot = await persistOperationPlanSnapshot({
    plan: params.plan,
    normalizedInput: params.normalizedInput,
    quote,
    episodeId: plannedEpisodeId ?? requestedEpisodeId,
  })
  return attachPersistedPlanIdentity(await toOperationPlanView(params.plan), snapshot)
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
  return await params.operation.plan(params.ctx, params.input)
}

export async function planProjectAgentOperationFromApi(params: {
  request: NextRequest
  operationId: string
  projectId: string
  userId: string
  context?: {
    locale?: string | null
    episodeId?: string | null
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
  const parsed = operation.inputSchema.safeParse(params.input)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'INVALID_PARAMS',
      issues: parsed.error.issues,
    })
  }
  const plan = await planOperation({
    operation,
    ctx: {
      request: params.request,
      userId: params.userId,
      projectId: params.projectId,
      context: {
        ...(params.context?.locale ? { locale: params.context.locale } : {}),
        ...(params.context?.episodeId ? { episodeId: params.context.episodeId } : {}),
        ...(params.context?.selectedScopeRef ? { selectedScopeRef: params.context.selectedScopeRef } : {}),
        ...(params.context?.selectedAssetId ? { selectedAssetId: params.context.selectedAssetId } : {}),
      },
      source: params.source || 'project-ui',
      writer: null,
      toolCallId: null,
    },
    input: parsed.data,
  })
  return await persistOperationPlanView({
    plan,
    normalizedInput: parsed.data,
    episodeId: params.context?.episodeId ?? null,
  })
}
