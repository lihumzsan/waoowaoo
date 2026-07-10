import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo, getBillingMode } from '@/lib/billing'
import type { BillingMode, TaskBillingInfo, TaskType } from '@/lib/task/types'
import type { Locale } from '@/i18n/routing'
import { shouldExposeBillingCredits } from '@/lib/billing/task-billing-view'
import {
  requiresBillableMediaApproval,
  type BillableMediaApiType,
} from '@/lib/billing/media-approval-policy'
import { cancelTask } from '@/lib/task/service'
import { removeTaskJob } from '@/lib/task/queues'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationId,
} from './types'
import { createProjectAgentOperationRegistryForApi } from './registry'
import { submitOperationTask } from './submit-operation-task'

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

export interface OperationPlan {
  kind: OperationPlanKind
  operationId: ProjectAgentOperationId
  projectId: string
  userId: string
  tasks: PlannedTask[]
  approvalQuoteTasks?: PlannedTask[]
  summary?: string | null
  metadata?: Record<string, unknown>
}

export interface BillingQuoteItemView {
  id: string
  taskType: TaskType
  targetType: string
  targetId: string
  apiType: 'image' | 'video' | 'music' | 'sound_effect'
  model: string
  quantity: number
  unit: 'image' | 'video' | 'music' | 'sound_effect' | 'second' | 'call'
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

function shouldExposeCredits(): boolean {
  return shouldExposeBillingCredits()
}

type BillableTaskBillingInfo = Extract<TaskBillingInfo, { billable: true }>
type QuoteVisibleMediaApiType = Extract<BillableTaskBillingInfo['apiType'], BillableMediaApiType>
type ConfirmedCostMediaApiType = Extract<BillableTaskBillingInfo['apiType'], 'image' | 'video' | 'sound_effect'>

function operationPlanBillingTasks(plan: OperationPlan): readonly PlannedTask[] {
  return [...plan.tasks, ...(plan.approvalQuoteTasks ?? [])]
}

function isQuoteVisibleMediaBillingInfo(
  info: TaskBillingInfo | null | undefined,
): info is BillableTaskBillingInfo & { apiType: QuoteVisibleMediaApiType } {
  return requiresBillableMediaApproval(info)
}

function isConfirmedCostMediaBillingInfo(
  info: TaskBillingInfo | null | undefined,
): info is BillableTaskBillingInfo & { apiType: ConfirmedCostMediaApiType } {
  return info?.billable === true && (
    info.apiType === 'image'
    || info.apiType === 'video'
    || info.apiType === 'sound_effect'
  )
}

function toPositiveMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 1000000) / 1000000
}

export async function quoteOperationPlan(plan: OperationPlan): Promise<BillingQuoteView> {
  const showCredits = shouldExposeCredits()
  const billingMode = await getBillingMode()
  const mediaTasks = operationPlanBillingTasks(plan)
    .filter((task) => isQuoteVisibleMediaBillingInfo(task.billingInfo))
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

function confirmedCostMediaTotal(plan: OperationPlan): number {
  return toPositiveMoney(operationPlanBillingTasks(plan).reduce((total, task) => {
    if (!isConfirmedCostMediaBillingInfo(task.billingInfo)) return total
    return total + task.billingInfo.maxFrozenCost
  }, 0))
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

export async function compensateSubmittedTasks(taskIds: readonly string[], reason = 'Operation batch submit failed before completion'): Promise<void> {
  const failed: string[] = []
  for (const taskId of taskIds) {
    try {
      await cancelTask(taskId, reason)
      await removeTaskJob(taskId).catch(() => false)
    } catch {
      failed.push(taskId)
    }
  }
  if (failed.length > 0) {
    throw new Error(`PROJECT_AGENT_BATCH_TASK_COMPENSATION_FAILED:${failed.join(',')}`)
  }
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

export async function assertOperationPlanConfirmedCost(params: {
  plan: OperationPlan
  confirmedMaxCost?: number | null
}): Promise<void> {
  if (!shouldExposeCredits()) return
  const actual = confirmedCostMediaTotal(params.plan)
  if (actual <= 0) return
  const confirmedMaxCost = params.confirmedMaxCost
  if (typeof confirmedMaxCost !== 'number' || !Number.isFinite(confirmedMaxCost)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_CONFIRMED_MAX_COST_REQUIRED',
      message: 'confirmedMaxCost is required for billable fixed-price media operations',
    })
  }
  if (actual > confirmedMaxCost) {
    throw new ApiError('CONFLICT', {
      code: 'OPERATION_QUOTE_EXCEEDED_CONFIRMED_MAX_COST',
      message: 'planned media generation cost exceeds the confirmed maximum cost',
      actual,
      confirmedMaxCost,
    })
  }
}

export async function submitPlannedOperationTask(params: {
  ctx: ProjectAgentOperationContext
  task: PlannedTask
  operationId: string
  confirmed: boolean
}) {
  return await submitOperationTask({
    request: params.ctx.request,
    userId: params.ctx.userId,
    locale: params.task.locale,
    projectId: params.ctx.projectId,
    episodeId: params.task.episodeId ?? null,
    type: params.task.taskType,
    targetType: params.task.target.targetType,
    targetId: params.task.target.targetId,
    payload: params.task.payload,
    dedupeKey: params.task.dedupeKey ?? null,
    priority: params.task.priority ?? 0,
    billingInfo: params.task.billingInfo,
    billingInfoSource: 'planned',
    operationId: params.operationId,
    source: params.ctx.source,
    confirmed: params.confirmed,
    decoratePayload: false,
  })
}

export function readConfirmedMaxCost(input: unknown): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = (input as { confirmedMaxCost?: unknown }).confirmedMaxCost
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function resolveConfirmedMaxCostForExecution(params: {
  ctx: ProjectAgentOperationContext
  input: unknown
  plan: OperationPlan
}): Promise<number | null> {
  const explicit = readConfirmedMaxCost(params.input)
  if (explicit !== null) return explicit
  if (params.ctx.source === 'assistant-panel') {
    const quote = await quoteOperationPlan(params.plan)
    return quote.totalMaxFrozenCost ?? null
  }
  return null
}

export async function commitOperationPlan<Input, Output>(params: {
  operation: ProjectAgentOperationDefinition<Input, Output>
  ctx: ProjectAgentOperationContext
  input: Input
  plan: OperationPlan
  confirmedMaxCost?: number | null
}): Promise<Output> {
  if (!params.operation.commit) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_COMMIT_UNAVAILABLE',
      message: `operation commit unavailable: ${params.operation.id}`,
    })
  }
  await assertOperationPlanConfirmedCost({
    plan: params.plan,
    confirmedMaxCost: params.confirmedMaxCost ?? readConfirmedMaxCost(params.input),
  })
  return await params.operation.commit(params.ctx, params.input, params.plan)
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
    selectedPanelId?: string | null
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
        ...(params.context?.selectedPanelId ? { selectedPanelId: params.context.selectedPanelId } : {}),
        ...(params.context?.selectedAssetId ? { selectedAssetId: params.context.selectedAssetId } : {}),
      },
      source: params.source || 'project-ui',
      writer: null,
      toolCallId: null,
    },
    input: parsed.data,
  })
  return await toOperationPlanView(plan)
}
