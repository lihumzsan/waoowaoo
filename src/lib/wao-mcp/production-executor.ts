import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import { formatBillingActionCost } from '@/lib/billing/action-quote-preview'
import {
  buildAgentToolEffectInputHash,
  executeAgentToolEffectTransaction,
} from '@/lib/agent-turn/tool-effect'
import {
  buildDirectOperationInvocationIdentity,
  executeApprovedTaskOperationViaTemporal,
  executeDirectTaskOperationViaTemporal,
} from '@/lib/operations/durable-dispatch'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { prepareProjectAgentOperationInput } from '@/lib/operations/invocation'
import { parseOperationMutationReceipt } from '@/lib/operations/mutation-receipt'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  issueApprovalGrantGroup,
  type PlannedOperationInvocation,
} from '@/lib/operations/planned-operation-invocation'
import { loadOperationPlanSnapshotByApiRequest } from '@/lib/operations/operation-plan-snapshot'
import {
  persistOperationPlanView,
  planOperation,
  type OperationPlanView,
} from '@/lib/operations/planning'
import {
  isBillablePlannedOperation,
  type JsonObject,
  type OperationMutationReceipt,
  type ProjectAgentOperationContext,
  type ProjectAgentOperationDefinition,
  type ProjectAgentOperationRegistry,
} from '@/lib/operations/types'
import { readAssistantBillingConfirmationRequired } from '@/lib/project-agent/billing-confirmation'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import {
  normalizeProjectAgentLocale,
  type ProjectAgentLocale,
} from '@/lib/project-agent/locale'
import { publishOperationMutationReceipt } from '@/lib/workspace-resource/resource-change-publisher'
import type {
  WaoMcpOperationExecutor,
  WaoMcpOperationExecutorResult,
  WaoMcpElicitationRequest,
  WaoMcpElicitationResult,
  WaoMcpTrustedCallContext,
} from './contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toJsonObject(value: unknown): JsonObject {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('WAO_MCP_EXECUTOR_RESULT_NOT_JSON')
  }
  const parsed: unknown = JSON.parse(serialized)
  if (!isRecord(parsed)) {
    throw new Error('WAO_MCP_EXECUTOR_RESULT_NOT_OBJECT')
  }
  return parsed as JsonObject
}

function requireIdentityPart(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WAO_MCP_STABLE_IDENTITY_REQUIRED',
      identity: label,
    })
  }
  return normalized
}

function normalizeTrustedContext(
  context: WaoMcpTrustedCallContext,
  signal: AbortSignal,
): {
  turnId: string
  callId: string
  executionOwnerId: string
  userId: string
  projectId: string
  operationContext: ProjectAgentOperationContext
} {
  const turnId = requireIdentityPart(context.turnId, 'turnId')
  const callId = requireIdentityPart(context.callId, 'callId')
  const userId = requireIdentityPart(context.userId, 'userId')
  const projectId = requireIdentityPart(context.projectId, 'projectId')
  const source = requireIdentityPart(context.source, 'source')
  requireIdentityPart(context.threadId, 'threadId')
  return {
    turnId,
    callId,
    executionOwnerId: requireIdentityPart(
      context.executionOwnerId,
      'executionOwnerId',
    ),
    userId,
    projectId,
    operationContext: {
      request: null,
      requestId: requireIdentityPart(context.requestId, 'requestId'),
      signal,
      userId,
      projectId,
      context: {
        ...(context.locale?.trim() ? { locale: context.locale.trim() } : {}),
        episodeId: context.episodeId?.trim() || null,
        turnId,
        userTurnText: context.userTurnText ?? null,
        userTurnMediaResourceIds: context.userTurnMediaResourceIds ?? [],
        selectedScopeRef: context.selectedScopeRef?.trim() || null,
        selectedAssetId: context.selectedAssetId?.trim() || null,
      },
      invocationChannel: 'tool',
      source,
      writer: null,
      toolCallId: callId,
      activityId: null,
    },
  }
}

interface StoredEffectResult {
  readonly data: unknown
  readonly mutationReceipt: OperationMutationReceipt | null
}

function parseStoredEffectResult(value: unknown): StoredEffectResult {
  if (!isRecord(value) || !('data' in value)) {
    throw new Error('WAO_MCP_TOOL_EFFECT_RESULT_INVALID')
  }
  return {
    data: value.data,
    mutationReceipt: parseOperationMutationReceipt(
      Object.prototype.hasOwnProperty.call(value, 'mutationReceipt')
        ? value.mutationReceipt
        : null,
    ),
  }
}

function failedResult(params: {
  operation: ProjectAgentOperationDefinition
  error: unknown
}): WaoMcpOperationExecutorResult {
  const error = normalizeOperationExecutionToolError({
    error: params.error,
    operation: params.operation,
    operationId: params.operation.id,
  })
  return {
    structuredContent: toJsonObject({ ok: false, error }),
    text: error.message,
    isError: true,
  }
}

type ExecutorCopyKey =
  | 'approvalBillable'
  | 'approvalDestructive'
  | 'approvedSubmitted'
  | 'submitted'
  | 'completed'
  | 'notAvailable'

const EXECUTOR_COPY: Record<
  ProjectAgentLocale,
  Record<ExecutorCopyKey, string>
> = {
  zh: {
    approvalBillable: '此操作需要先确认不可变生产计划。',
    approvalDestructive: '此操作需要确认后才能执行。',
    approvedSubmitted: '已提交获批的 Wao 操作。',
    submitted: '已提交 Wao 操作。',
    completed: 'Wao 操作已完成。',
    notAvailable: '此操作不能通过 Wao MCP 使用。',
  },
  en: {
    approvalBillable: 'This operation requires an approved immutable plan.',
    approvalDestructive: 'This operation requires approval before execution.',
    approvedSubmitted: 'The approved Wao operation was submitted.',
    submitted: 'The Wao operation was submitted.',
    completed: 'The Wao operation completed.',
    notAvailable: 'This operation is not available through Wao MCP.',
  },
}

function executorCopy(
  locale: string | null | undefined,
  key: ExecutorCopyKey,
): string {
  return EXECUTOR_COPY[normalizeProjectAgentLocale(locale)][key]
}

function approvalRequiredResult(
  operation: ProjectAgentOperationDefinition,
  locale: string | null | undefined,
): WaoMcpOperationExecutorResult {
  const billable = operation.confirmation.kind === 'billable_media'
  return {
    structuredContent: {
      ok: false,
      confirmationRequired: true,
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'PROJECT_AGENT_OPERATION_APPROVAL_REQUIRED',
        operationId: operation.id,
      },
    },
    text: executorCopy(
      locale,
      billable ? 'approvalBillable' : 'approvalDestructive',
    ),
    isError: true,
  }
}

function buildApprovalRequestId(params: {
  readonly turnId: string
  readonly callId: string
  readonly operationId: string
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      'wao-mcp-approval-v1',
      params.turnId,
      params.callId,
      params.operationId,
    ]), 'utf8')
    .digest('hex')
  return `wao-mcp:${digest}`
}

function projectPersistedPlanView(
  snapshot: NonNullable<
    Awaited<ReturnType<typeof loadOperationPlanSnapshotByApiRequest>>
  >,
): OperationPlanView {
  return {
    operationId: snapshot.operationId,
    kind: snapshot.plan.kind,
    taskCount: snapshot.plan.tasks.length,
    quote: snapshot.quote,
    tasks: snapshot.plan.tasks.map((task) => ({
      id: task.id,
      taskType: task.taskType,
      targetType: task.target.targetType,
      targetId: task.target.targetId,
    })),
    planSnapshotId: snapshot.id,
    inputHash: snapshot.inputHash,
    planHash: snapshot.planHash,
    quoteHash: snapshot.quoteHash,
  }
}

function approvalElicitation(params: {
  readonly operationId: string
  readonly locale: string | null | undefined
  readonly plan: OperationPlanView | null
  readonly kind: 'billable' | 'destructive'
}): WaoMcpElicitationRequest {
  const locale = normalizeProjectAgentLocale(params.locale)
  const operationTitle = localizeProjectAgentOperationTitle(params.operationId, locale)
  const planSummary = params.plan
    ? (() => {
        const quote = params.plan.quote
        const cost = quote.showCredits
          && typeof quote.totalMaxFrozenCost === 'number'
          ? formatBillingActionCost(quote.totalMaxFrozenCost)
          : null
        if (locale === 'en') {
          return cost
            ? `${String(params.plan.taskCount)} tasks (${String(quote.mediaTaskCount)} media), maximum ${cost} credits`
            : `${String(params.plan.taskCount)} tasks (${String(quote.mediaTaskCount)} media)`
        }
        return cost
          ? `${String(params.plan.taskCount)} 个任务（${String(quote.mediaTaskCount)} 个媒体任务），最高 ${cost} 积分`
          : `${String(params.plan.taskCount)} 个任务（${String(quote.mediaTaskCount)} 个媒体任务）`
      })()
    : null
  const message = locale === 'en'
    ? [
        `${operationTitle} requires your approval.`,
        planSummary ? `Plan: ${planSummary}` : null,
        params.kind === 'billable'
          ? 'Approving authorizes the displayed immutable production plan and its quoted ceiling.'
          : 'Approving authorizes this destructive operation.',
      ].filter((value): value is string => Boolean(value)).join('\n')
    : [
        `${operationTitle}需要你的确认。`,
        planSummary ? `计划：${planSummary}` : null,
        params.kind === 'billable'
          ? '确认后将授权执行上述不可变生产计划及其报价上限。'
          : '确认后将授权执行此删除操作。',
      ].filter((value): value is string => Boolean(value)).join('\n')
  return {
    mode: 'form',
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: locale === 'en' ? 'Approve this operation' : '确认执行此操作',
        },
      },
      required: ['confirmed'],
    },
  }
}

function elicitationApproved(result: WaoMcpElicitationResult): boolean {
  return result.action === 'accept' && result.content?.confirmed === true
}

async function authorizeBillableOperation(params: {
  readonly operation: ProjectAgentOperationDefinition
  readonly input: Readonly<Record<string, unknown>>
  readonly trusted: ReturnType<typeof normalizeTrustedContext>
  readonly context: WaoMcpTrustedCallContext
  readonly elicit: (request: WaoMcpElicitationRequest) => Promise<WaoMcpElicitationResult>
}): Promise<PlannedOperationInvocation | null> {
  const prepared = prepareProjectAgentOperationInput({
    channel: 'tool',
    operation: params.operation,
    context: params.trusted.operationContext.context,
    input: params.input,
  })
  if (prepared.invocation) {
    throw new Error(`WAO_MCP_APPROVAL_PROVENANCE_AMBIGUOUS:${params.operation.id}`)
  }
  if (!params.operation.plan || !params.operation.planContractRevision) {
    throw new Error(`WAO_MCP_OPERATION_PLAN_CONTRACT_MISSING:${params.operation.id}`)
  }
  const planContractRevision = params.operation.planContractRevision
  const approvalRequestId = buildApprovalRequestId({
    turnId: params.trusted.turnId,
    callId: params.trusted.callId,
    operationId: params.operation.id,
  })
  const apiRequestContext = {
    turnId: params.trusted.turnId,
    callId: params.trusted.callId,
    locale: params.context.locale ?? null,
  }
  const replay = await loadOperationPlanSnapshotByApiRequest({
    userId: params.trusted.userId,
    projectId: params.trusted.projectId,
    operationId: params.operation.id,
    apiRequestId: approvalRequestId,
    executionContractRevision: planContractRevision,
    normalizedInput: prepared.input,
    apiRequestContext,
  })
  const view = replay
    ? projectPersistedPlanView(replay)
    : await (async (): Promise<OperationPlanView> => {
        const plan = await planOperation({
          operation: params.operation,
          ctx: params.trusted.operationContext,
          input: prepared.input,
        })
        return await persistOperationPlanView({
          plan,
          executionContractRevision: planContractRevision,
          normalizedInput: prepared.input,
          episodeId: params.context.episodeId ?? null,
          apiRequestId: approvalRequestId,
          apiRequestContext,
        })
      })()
  if (!view.planSnapshotId) {
    throw new Error(`WAO_MCP_OPERATION_PLAN_ID_MISSING:${params.operation.id}`)
  }
  const confirmationRequired = await readAssistantBillingConfirmationRequired(
    params.trusted.userId,
  )
  if (confirmationRequired) {
    const decision = await params.elicit(approvalElicitation({
      operationId: params.operation.id,
      locale: params.context.locale,
      plan: view,
      kind: 'billable',
    }))
    if (!elicitationApproved(decision)) return null
  }
  const [grant] = await issueApprovalGrantGroup({
    userId: params.trusted.userId,
    requests: [{
      planSnapshotId: view.planSnapshotId,
      requestId: approvalRequestId,
    }],
  })
  if (!grant || grant.operationId !== params.operation.id) {
    throw new Error(`WAO_MCP_APPROVAL_GRANT_DIVERGED:${params.operation.id}`)
  }
  return {
    approvalGrantId: grant.approvalGrantId,
    requestId: grant.requestId,
  }
}

async function executeOperation(params: {
  registry: ProjectAgentOperationRegistry
  operation: ProjectAgentOperationDefinition
  input: Readonly<Record<string, unknown>>
  context: WaoMcpTrustedCallContext
  signal: AbortSignal
  elicit: (request: WaoMcpElicitationRequest) => Promise<WaoMcpElicitationResult>
}): Promise<WaoMcpOperationExecutorResult> {
  params.signal.throwIfAborted()
  const trusted = normalizeTrustedContext(params.context, params.signal)

  if (isBillablePlannedOperation(params.operation)) {
    const invocation = params.context.approvedInvocation ?? await authorizeBillableOperation({
      operation: params.operation,
      input: params.input,
      trusted,
      context: params.context,
      elicit: params.elicit,
    })
    if (!invocation) {
      return approvalRequiredResult(params.operation, params.context.locale)
    }
    const result = await executeApprovedTaskOperationViaTemporal({
      registry: params.registry,
      operationId: params.operation.id,
      userId: trusted.userId,
      projectId: trusted.projectId,
      source: trusted.operationContext.source,
      invocation,
      context: trusted.operationContext.context,
      origin: {
        kind: 'agent_turn',
        turnId: trusted.turnId,
        callId: trusted.callId,
      },
    })
    return {
      structuredContent: toJsonObject({ ok: true, data: result.data }),
      text: executorCopy(params.context.locale, 'approvedSubmitted'),
    }
  }

  if (
    params.operation.confirmation.kind === 'destructive'
    && params.operation.confirmation.required
    && params.context.destructiveApproved !== true
  ) {
    const decision = await params.elicit(approvalElicitation({
      operationId: params.operation.id,
      locale: params.context.locale,
      plan: null,
      kind: 'destructive',
    }))
    if (!elicitationApproved(decision)) {
      return approvalRequiredResult(params.operation, params.context.locale)
    }
  }

  if (
    params.operation.assistantWriteAuthority?.kind
      === 'temporal_operation_execution'
  ) {
    const identity = buildDirectOperationInvocationIdentity({
      channel: 'tool',
      projectId: trusted.projectId,
      operationId: params.operation.id,
      stableSourceId: JSON.stringify([trusted.turnId, trusted.callId]),
    })
    const result = await executeDirectTaskOperationViaTemporal({
      registry: params.registry,
      channel: 'tool',
      operationId: params.operation.id,
      userId: trusted.userId,
      projectId: trusted.projectId,
      source: trusted.operationContext.source,
      context: trusted.operationContext.context,
      input: params.input,
      ...identity,
      origin: {
        kind: 'agent_turn',
        turnId: trusted.turnId,
        callId: trusted.callId,
      },
    })
    return {
      structuredContent: toJsonObject({ ok: true, data: result.data }),
      text: executorCopy(params.context.locale, 'submitted'),
    }
  }

  if (params.operation.effects.writes) {
    const contractRevision = params.operation.toolContractRevision
    if (!contractRevision) {
      throw new Error(
        `WAO_MCP_TOOL_EFFECT_CONTRACT_REVISION_MISSING:${params.operation.id}`,
      )
    }
    const stored = parseStoredEffectResult(
      await executeAgentToolEffectTransaction({
        turnId: trusted.turnId,
        executionOwnerId: trusted.executionOwnerId,
        callId: trusted.callId,
        operationId: params.operation.id,
        contractRevision,
        inputHash: buildAgentToolEffectInputHash({
          operationId: params.operation.id,
          contractRevision,
          input: params.input,
        }),
        execute: async (transaction) => {
          const result = await invokeProjectAgentOperation({
            registry: params.registry,
            channel: 'tool',
            operationId: params.operation.id,
            context: trusted.operationContext,
            input: params.input,
            transaction,
            invocationMode: 'agent_tool_effect',
          })
          if (result.kind !== 'executed') {
            throw new Error(
              `WAO_MCP_TOOL_EFFECT_RESULT_KIND_INVALID:${params.operation.id}`,
            )
          }
          return {
            data: result.data,
            mutationReceipt: result.mutationReceipt,
          } satisfies StoredEffectResult
        },
      }),
    )
    await publishOperationMutationReceipt({
      projectId: trusted.projectId,
      userId: trusted.userId,
      receipt: stored.mutationReceipt,
    })
    return {
      structuredContent: toJsonObject({ ok: true, data: stored.data }),
      text: executorCopy(params.context.locale, 'completed'),
    }
  }

  const result = await invokeProjectAgentOperation({
    registry: params.registry,
    channel: 'tool',
    operationId: params.operation.id,
    context: trusted.operationContext,
    input: params.input,
  })
  return {
    structuredContent: toJsonObject({ ok: true, data: result.data }),
    text: executorCopy(params.context.locale, 'completed'),
  }
}

export function createProductionWaoMcpOperationExecutor(params?: {
  readonly registry?: ProjectAgentOperationRegistry
}): WaoMcpOperationExecutor {
  const registry = params?.registry ?? createProjectAgentOperationRegistry()

  return {
    async execute(call): Promise<WaoMcpOperationExecutorResult> {
      const operation = registry[call.operationId]
      if (!operation?.channels.mcp) {
        return {
          structuredContent: {
            ok: false,
            error: {
              code: 'OPERATION_NOT_ALLOWED',
              message: 'This operation is not available through Wao MCP.',
              operationId: call.operationId,
            },
          },
          text: executorCopy(call.context.locale, 'notAvailable'),
          isError: true,
        }
      }

      try {
        return await executeOperation({
          registry,
          operation,
          input: call.input,
          context: call.context,
          signal: call.signal,
          elicit: call.elicit,
        })
      } catch (error) {
        call.signal.throwIfAborted()
        return failedResult({ operation, error })
      }
    },
  }
}
