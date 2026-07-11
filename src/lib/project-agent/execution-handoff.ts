import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '@prisma/client'
import type { UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  buildProjectAssistantScopeRef,
} from './persistence'
import {
  assertProjectAgentChoiceOfferCurrent,
  buildProjectAgentChoiceOffer,
  type ProjectAgentChoiceReviewedResource,
} from './choice-offer'
import type {
  ProjectAgentChoiceCardDefinition,
  ProjectAgentChoiceCardPartData,
  ProjectAssistantId,
} from './types'
import {
  assertProjectAgentOperationExecutionFenceInTransaction,
  assertProjectAgentOperationExecutionFenceSignal,
  recordProjectAgentChoiceHandoffReceipt,
  recordProjectAgentSuspensionReceipt,
  type ProjectAgentOperationExecutionFence,
} from './operation-execution-fence'
import { appendProjectAgentInterruptionReplacementInTransaction } from './interruptions'
import type {
  ProjectAgentApprovalSuspensionReceipt,
  ProjectAgentChoiceSuspensionReceipt,
} from './suspension'
import { appendProjectAgentEventsInTransaction } from './event'
import { createProjectAgentRunFence, type ProjectAgentRunFence } from './run-fence'
import type {
  ProjectAgentTaskFollowUpSettlementOutcome,
  ProjectAgentWaitFollowUpMode,
} from './waits'
import { localizeProjectAgentOperationTitle } from './copy'
import { normalizeProjectAgentLocale } from './locale'

export type ProjectAgentExecutionHandoffKind = 'choice' | 'approval' | 'task'
export type ProjectAgentExecutionHandoffStatus = 'prepared' | 'settled'

export type ProjectAgentContinuationTerminalOutcome = Exclude<
  ProjectAgentTaskFollowUpSettlementOutcome,
  'awaiting_task' | 'awaiting_choice' | 'awaiting_approval'
>

export interface ProjectAgentContinuationCheckpoint {
  commandId: string
  waitId: string
  runId: string
  outcome: ProjectAgentTaskFollowUpSettlementOutcome
  messageId: string
}

export interface ProjectAgentChoiceHandoffReceipt {
  kind: 'choice'
  handoffId: string
  executionSegmentId: string
  runId: string
  operationId: string
  toolCallId: string
}

export interface ProjectAgentPreparedChoiceHandoff extends ProjectAgentChoiceHandoffReceipt {
  card: ProjectAgentChoiceCardDefinition
  reviewedResource: ProjectAgentChoiceReviewedResource
}

export interface ProjectAgentApprovalHandoffReceipt {
  kind: 'approval'
  handoffId: string
  executionSegmentId: string
  runId: string
  operationId: string
  approvalId: string
  toolCallId: string | null
}

export interface ProjectAgentTaskHandoffReceipt {
  kind: 'task'
  handoffId: string
  executionSegmentId: string
  runId: string
  operationId: string
  waitId: string
  taskIds: readonly string[]
  followUpMode: ProjectAgentWaitFollowUpMode
}

interface ChoiceHandoffPayload {
  card: ProjectAgentChoiceCardDefinition
  reviewedResource: ProjectAgentChoiceReviewedResource
}

interface ApprovalHandoffPayload {
  approvalId: string
  toolCallId: string | null
  runState: string
  payload: Prisma.JsonValue
}

interface TaskHandoffPayload {
  waitId: string
  taskIds: string[]
  followUpMode: ProjectAgentWaitFollowUpMode
}

export interface ProjectAgentExecutionSegmentContinuation {
  waitId: string
  commandId: string
  claimOwner: string
  executionActivityId: string
}

function requireIdentity(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function normalizeStatus(value: string): ProjectAgentExecutionHandoffStatus {
  if (value === 'prepared' || value === 'settled') return value
  throw new Error(`PROJECT_AGENT_EXECUTION_HANDOFF_STATUS_INVALID:${value}`)
}

function parseChoicePayload(value: Prisma.JsonValue): ChoiceHandoffPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROJECT_AGENT_CHOICE_HANDOFF_PAYLOAD_INVALID')
  }
  const record = value as Record<string, unknown>
  const card = record.card
  const reviewedResource = record.reviewedResource
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error('PROJECT_AGENT_CHOICE_HANDOFF_CARD_INVALID')
  }
  if (!reviewedResource || typeof reviewedResource !== 'object' || Array.isArray(reviewedResource)) {
    throw new Error('PROJECT_AGENT_CHOICE_HANDOFF_RESOURCE_INVALID')
  }
  return {
    card: card as ProjectAgentChoiceCardDefinition,
    reviewedResource: reviewedResource as ProjectAgentChoiceReviewedResource,
  }
}

function parseApprovalPayload(value: Prisma.JsonValue): ApprovalHandoffPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROJECT_AGENT_APPROVAL_HANDOFF_PAYLOAD_INVALID')
  }
  const record = value as Record<string, unknown>
  const approvalId = typeof record.approvalId === 'string' ? record.approvalId.trim() : ''
  const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId.trim() || null : null
  const runState = typeof record.runState === 'string' ? record.runState : ''
  if (!approvalId || !runState || !('payload' in record)) {
    throw new Error('PROJECT_AGENT_APPROVAL_HANDOFF_PAYLOAD_INVALID')
  }
  return {
    approvalId,
    toolCallId,
    runState,
    payload: record.payload as Prisma.JsonValue,
  }
}

function parseTaskPayload(value: Prisma.JsonValue): TaskHandoffPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROJECT_AGENT_TASK_HANDOFF_PAYLOAD_INVALID')
  }
  const record = value as Record<string, unknown>
  const waitId = typeof record.waitId === 'string' ? record.waitId.trim() : ''
  const taskIds = Array.isArray(record.taskIds)
    ? record.taskIds.filter((taskId): taskId is string => typeof taskId === 'string' && taskId.trim().length > 0)
    : []
  const followUpMode = record.followUpMode
  if (!waitId || taskIds.length === 0 || (followUpMode !== 'resume_agent' && followUpMode !== 'complete')) {
    throw new Error('PROJECT_AGENT_TASK_HANDOFF_PAYLOAD_INVALID')
  }
  return {
    waitId,
    taskIds: Array.from(new Set(taskIds)).sort(),
    followUpMode,
  }
}

function assertChoiceHandoffIdentity(params: {
  handoff: {
    executionSegmentId: string
    runId: string
    projectId: string
    userId: string
    assistantId: string
    scopeRef: string
    kind: string
    operationId: string
    status: string
    payload: Prisma.JsonValue
  }
  input: {
    executionSegmentId: string
    runId: string
    projectId: string
    userId: string
    assistantId: string
    scopeRef: string
    operationId: string
    payload: ChoiceHandoffPayload
  }
}): void {
  const { handoff, input } = params
  if (
    handoff.executionSegmentId !== input.executionSegmentId
    || handoff.runId !== input.runId
    || handoff.projectId !== input.projectId
    || handoff.userId !== input.userId
    || handoff.assistantId !== input.assistantId
    || handoff.scopeRef !== input.scopeRef
    || handoff.kind !== 'choice'
    || handoff.operationId !== input.operationId
    || !isDeepStrictEqual(parseChoicePayload(handoff.payload), input.payload)
  ) {
    throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_IDENTITY_CONFLICT:${input.executionSegmentId}`)
  }
}

/**
 * Stores the exact Choice handoff before the Agents SDK is allowed to stop the
 * model loop. This is not yet a user-visible Interaction or a Run transition:
 * the execution-segment settlement commits those together with the assistant
 * message. The prepared intent makes that later commit recoverable after a
 * process loss without re-running the model/tool segment.
 */
export async function prepareProjectAgentChoiceExecutionHandoff(input: {
  executionFence: ProjectAgentOperationExecutionFence
  executionSegmentId: string
  projectId: string
  userId: string
  episodeId?: string | null
  locale?: string | null
  assistantId?: ProjectAssistantId
  operationId: string
  toolCallId: string
  card: ProjectAgentChoiceCardDefinition
  reviewedResource: ProjectAgentChoiceReviewedResource
}): Promise<ProjectAgentPreparedChoiceHandoff> {
  const executionSegmentId = requireIdentity(
    input.executionSegmentId,
    'PROJECT_AGENT_EXECUTION_HANDOFF_SEGMENT_ID_REQUIRED',
  )
  const runId = requireIdentity(input.executionFence.runFence.runId, 'PROJECT_AGENT_EXECUTION_HANDOFF_RUN_ID_REQUIRED')
  const operationId = requireIdentity(input.operationId, 'PROJECT_AGENT_EXECUTION_HANDOFF_OPERATION_ID_REQUIRED')
  const toolCallId = requireIdentity(input.toolCallId, 'PROJECT_AGENT_EXECUTION_HANDOFF_TOOL_CALL_ID_REQUIRED')
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  const payload: ChoiceHandoffPayload = {
    card: input.card,
    reviewedResource: input.reviewedResource,
  }
  let handoffId = ''

  await prisma.$transaction(async (tx) => {
    await assertProjectAgentOperationExecutionFenceInTransaction(tx, input.executionFence)
    await assertProjectAgentChoiceOfferCurrent({
      tx,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      offer: {
        schemaVersion: 1,
        card: {
          ...input.card,
          runId,
          interruptionId: `prepared:${executionSegmentId}`,
        },
        reviewedResource: input.reviewedResource,
      },
    })
    const existing = await tx.projectAgentExecutionHandoff.findUnique({
      where: { executionSegmentId },
    })
    if (existing) {
      assertChoiceHandoffIdentity({
        handoff: existing,
        input: {
          executionSegmentId,
          runId,
          projectId: input.projectId,
          userId: input.userId,
          assistantId,
          scopeRef,
          operationId,
          payload,
        },
      })
      if (normalizeStatus(existing.status) !== 'prepared') {
        throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_ALREADY_SETTLED:${executionSegmentId}`)
      }
      handoffId = existing.id
    } else {
      handoffId = randomUUID()
      await tx.projectAgentExecutionHandoff.create({
        data: {
          id: handoffId,
          executionSegmentId,
          runId,
          projectId: input.projectId,
          userId: input.userId,
          assistantId,
          scopeRef,
          episodeId: input.episodeId ?? null,
          locale: input.locale?.trim() || 'en',
          kind: 'choice',
          status: 'prepared',
          operationId,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      })
    }
    assertProjectAgentOperationExecutionFenceSignal(input.executionFence)
  })

  const receipt: ProjectAgentPreparedChoiceHandoff = {
    kind: 'choice',
    handoffId,
    executionSegmentId,
    runId,
    operationId,
    toolCallId,
    card: input.card,
    reviewedResource: input.reviewedResource,
  }
  recordProjectAgentChoiceHandoffReceipt(receipt)
  return receipt
}

/**
 * Persists an Approval intent before it becomes a visible Interaction. The
 * Agents SDK owns discovering the interruption; this service owns making its
 * result durable and recoverable across the final message/card handoff.
 */
export async function prepareProjectAgentApprovalExecutionHandoff(input: {
  executionFence: ProjectAgentOperationExecutionFence
  executionSegmentId: string
  projectId: string
  userId: string
  episodeId?: string | null
  locale?: string | null
  assistantId?: ProjectAssistantId
  operationId: string
  approvalId: string
  toolCallId: string | null
  runState: string
  payload?: Prisma.InputJsonValue
}): Promise<ProjectAgentApprovalHandoffReceipt> {
  const executionSegmentId = requireIdentity(
    input.executionSegmentId,
    'PROJECT_AGENT_APPROVAL_HANDOFF_SEGMENT_ID_REQUIRED',
  )
  const runId = requireIdentity(input.executionFence.runFence.runId, 'PROJECT_AGENT_APPROVAL_HANDOFF_RUN_ID_REQUIRED')
  const operationId = requireIdentity(input.operationId, 'PROJECT_AGENT_APPROVAL_HANDOFF_OPERATION_ID_REQUIRED')
  const approvalId = requireIdentity(input.approvalId, 'PROJECT_AGENT_APPROVAL_HANDOFF_APPROVAL_ID_REQUIRED')
  const runState = requireIdentity(input.runState, 'PROJECT_AGENT_APPROVAL_HANDOFF_RUN_STATE_REQUIRED')
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  const payload: ApprovalHandoffPayload = {
    approvalId,
    toolCallId: input.toolCallId?.trim() || null,
    runState,
    payload: (input.payload ?? {}) as Prisma.JsonValue,
  }
  let handoffId = ''
  await prisma.$transaction(async (tx) => {
    await assertProjectAgentOperationExecutionFenceInTransaction(tx, input.executionFence)
    const existing = await tx.projectAgentExecutionHandoff.findUnique({
      where: { executionSegmentId },
    })
    if (existing) {
      if (
        existing.runId !== runId
        || existing.projectId !== input.projectId
        || existing.userId !== input.userId
        || existing.assistantId !== assistantId
        || existing.scopeRef !== scopeRef
        || existing.kind !== 'approval'
        || existing.operationId !== operationId
        || normalizeStatus(existing.status) !== 'prepared'
        || !isDeepStrictEqual(parseApprovalPayload(existing.payload), payload)
      ) throw new Error(`PROJECT_AGENT_APPROVAL_HANDOFF_IDENTITY_CONFLICT:${executionSegmentId}`)
      handoffId = existing.id
    } else {
      handoffId = randomUUID()
      await tx.projectAgentExecutionHandoff.create({
        data: {
          id: handoffId,
          executionSegmentId,
          runId,
          projectId: input.projectId,
          userId: input.userId,
          assistantId,
          scopeRef,
          episodeId: input.episodeId ?? null,
          locale: input.locale?.trim() || 'en',
          kind: 'approval',
          status: 'prepared',
          operationId,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      })
    }
    assertProjectAgentOperationExecutionFenceSignal(input.executionFence)
  })
  return {
    kind: 'approval',
    handoffId,
    executionSegmentId,
    runId,
    operationId,
    approvalId,
    toolCallId: payload.toolCallId,
  }
}

/**
 * Task persistence owns the Task/Wait transaction. It records the matching
 * execution handoff in that same transaction so the later assistant-message
 * settlement never has to infer a Wait from stream output or task timing.
 */
export async function prepareProjectAgentTaskExecutionHandoffInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    executionSegmentId: string
    runId: string
    projectId: string
    userId: string
    episodeId?: string | null
    locale?: string | null
    assistantId?: ProjectAssistantId
    operationId: string
    waitId: string
    taskIds: readonly string[]
    followUpMode: ProjectAgentWaitFollowUpMode
  },
): Promise<ProjectAgentTaskHandoffReceipt> {
  const executionSegmentId = requireIdentity(
    input.executionSegmentId,
    'PROJECT_AGENT_TASK_HANDOFF_SEGMENT_ID_REQUIRED',
  )
  const runId = requireIdentity(input.runId, 'PROJECT_AGENT_TASK_HANDOFF_RUN_ID_REQUIRED')
  const operationId = requireIdentity(input.operationId, 'PROJECT_AGENT_TASK_HANDOFF_OPERATION_ID_REQUIRED')
  const waitId = requireIdentity(input.waitId, 'PROJECT_AGENT_TASK_HANDOFF_WAIT_ID_REQUIRED')
  const taskIds = Array.from(new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
  if (taskIds.length === 0) throw new Error(`PROJECT_AGENT_TASK_HANDOFF_TASKS_EMPTY:${operationId}`)
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  const payload: TaskHandoffPayload = { waitId, taskIds, followUpMode: input.followUpMode }
  const existing = await tx.projectAgentExecutionHandoff.findUnique({
    where: { executionSegmentId },
  })
  let handoffId: string
  if (existing) {
    const existingPayload = parseTaskPayload(existing.payload)
    if (
      existing.runId !== runId
      || existing.projectId !== input.projectId
      || existing.userId !== input.userId
      || existing.assistantId !== assistantId
      || existing.scopeRef !== scopeRef
      || existing.kind !== 'task'
      || existing.operationId !== operationId
      || normalizeStatus(existing.status) !== 'prepared'
      || !isDeepStrictEqual(existingPayload, payload)
    ) {
      throw new Error(`PROJECT_AGENT_TASK_HANDOFF_IDENTITY_CONFLICT:${executionSegmentId}`)
    }
    handoffId = existing.id
  } else {
    handoffId = randomUUID()
    await tx.projectAgentExecutionHandoff.create({
      data: {
        id: handoffId,
        executionSegmentId,
        runId,
        projectId: input.projectId,
        userId: input.userId,
        assistantId,
        scopeRef,
        episodeId: input.episodeId ?? null,
        locale: input.locale?.trim() || 'en',
        kind: 'task',
        status: 'prepared',
        operationId,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    })
  }
  return {
    kind: 'task',
    handoffId,
    executionSegmentId,
    runId,
    operationId,
    waitId,
    taskIds,
    followUpMode: input.followUpMode,
  }
}

export async function appendProjectAgentExecutionSegmentMessageHandoffInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    runFence: ProjectAgentRunFence
    runId: string
    projectId: string
    userId: string
    episodeId?: string | null
    assistantId: ProjectAssistantId
    scopeRef: string
    message: UIMessage
    outcome: 'awaiting_choice' | 'awaiting_approval' | 'awaiting_task'
    sourceOperationId: string
    continuation?: ProjectAgentExecutionSegmentContinuation | null
  },
): Promise<void> {
  await appendProjectAssistantThreadMessagesInTransaction(tx, {
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId,
    messages: [input.message],
  })
  if (!input.continuation) return
  const checkpoint = await tx.projectAgentContinuationCheckpoint.findUnique({
    where: { commandId: input.continuation.commandId },
  })
  if (
    !checkpoint
    || checkpoint.runId !== input.runId
    || checkpoint.waitId !== input.continuation.waitId
    || checkpoint.status !== 'running'
  ) {
    throw new Error(`PROJECT_AGENT_EXECUTION_HANDOFF_CHECKPOINT_INVALID:${input.continuation.commandId}`)
  }
  const checkpointUpdated = await tx.projectAgentContinuationCheckpoint.updateMany({
    where: {
      commandId: input.continuation.commandId,
      runId: input.runId,
      waitId: input.continuation.waitId,
      status: 'running',
    },
    data: {
      status: 'settled',
      outcome: input.outcome,
      messageId: input.message.id,
      messageJson: JSON.parse(JSON.stringify(input.message)) as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  })
  if (checkpointUpdated.count !== 1) {
    throw new Error(`PROJECT_AGENT_EXECUTION_HANDOFF_CHECKPOINT_RACED:${input.continuation.commandId}`)
  }
  await appendProjectAgentEventsInTransaction(tx, {
    scope: {
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId: input.assistantId,
      scopeRef: input.scopeRef,
    },
    events: [{
      runFence: input.runFence,
      idempotencyKey: `activity-completed:${input.continuation.executionActivityId}:continuation`,
      event: {
        kind: 'activity.completed',
        runId: input.runId,
        activityId: input.continuation.executionActivityId,
      },
    }, {
      runFence: input.runFence,
      idempotencyKey: `wait-followed:${input.continuation.waitId}:${input.continuation.commandId}`,
      event: {
        kind: 'wait.followed',
        runId: input.runId,
        activityId: input.continuation.executionActivityId,
        waitId: input.continuation.waitId,
        claimId: input.continuation.claimOwner,
        commandId: input.continuation.commandId,
        sourceOperationId: input.sourceOperationId,
      },
    }],
  })
}

function normalizeProjectAgentContinuationOutcome(
  value: string,
): ProjectAgentTaskFollowUpSettlementOutcome {
  switch (value) {
    case 'completed':
    case 'failed':
    case 'outcome_unknown':
    case 'delivery_exhausted':
    case 'awaiting_task':
    case 'awaiting_choice':
    case 'awaiting_approval':
      return value
    default:
      throw new Error(`PROJECT_AGENT_CONTINUATION_OUTCOME_INVALID:${value}`)
  }
}

function serializeContinuationMessage(message: UIMessage): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(message)) as Prisma.InputJsonValue
}

async function lockClaimedProjectAgentContinuationWait(
  tx: Prisma.TransactionClient,
  input: {
    runId: string
    waitId: string
    commandId: string
    claimOwner: string
    projectId: string
    userId: string
  },
) {
  const lockedWait = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM project_agent_waits
    WHERE id = ${input.waitId}
    FOR UPDATE
  `)
  if (lockedWait.length !== 1) {
    throw new Error(`PROJECT_AGENT_CONTINUATION_SETTLEMENT_STALE:${input.waitId}`)
  }
  const wait = await tx.projectAgentWait.findUnique({ where: { id: input.waitId } })
  if (
    !wait
    || wait.runId !== input.runId
    || wait.projectId !== input.projectId
    || wait.userId !== input.userId
    || wait.status !== 'claimed'
    || wait.followUpCommandId !== input.commandId
    || wait.claimId !== input.claimOwner
    || !wait.claimExpiresAt
    || wait.claimExpiresAt.getTime() <= Date.now()
  ) {
    throw new Error(`PROJECT_AGENT_CONTINUATION_SETTLEMENT_STALE:${input.waitId}`)
  }
  return wait
}

async function appendProjectAgentContinuationTerminalEventsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    runId: string
    wait: {
      id: string
      projectId: string
      userId: string
      episodeId: string | null
      assistantId: string
      scopeRef: string
      operationId: string
    }
    commandId: string
    claimOwner: string
    outcome: ProjectAgentContinuationTerminalOutcome
  },
): Promise<void> {
  const run = await tx.projectAgentRun.findUnique({
    where: { id: input.runId },
    select: { id: true, runVersion: true, eventSeq: true },
  })
  if (!run) throw new Error(`PROJECT_AGENT_RUN_NOT_FOUND:${input.runId}`)
  const runFence = createProjectAgentRunFence(run)
  const activityEvent = input.outcome === 'failed'
    || input.outcome === 'outcome_unknown'
    || input.outcome === 'delivery_exhausted'
    ? {
        runFence,
        idempotencyKey: `activity-failed:${input.commandId}:continuation`,
        event: {
          kind: 'activity.failed' as const,
          runId: input.runId,
          activityId: input.commandId,
          errorCode: input.outcome === 'outcome_unknown'
            ? 'PROJECT_AGENT_CONTINUATION_OUTCOME_UNKNOWN'
            : input.outcome === 'delivery_exhausted'
              ? 'PROJECT_AGENT_CONTINUATION_DELIVERY_EXHAUSTED'
              : 'PROJECT_AGENT_TASK_FOLLOW_UP_FAILED',
          errorMessage: input.outcome === 'outcome_unknown'
            ? 'Project agent continuation outcome is unknown and must not be replayed automatically'
            : input.outcome === 'delivery_exhausted'
              ? 'Project agent continuation delivery exhausted before execution could complete'
              : 'Project agent continuation reached a tool error',
        },
      }
    : {
        runFence,
        idempotencyKey: `activity-completed:${input.commandId}:continuation`,
        event: {
          kind: 'activity.completed' as const,
          runId: input.runId,
          activityId: input.commandId,
        },
      }
  const terminalRunEvent = input.outcome === 'completed'
    ? {
        runFence,
        idempotencyKey: `run-completed:${input.runId}:continuation:${input.commandId}`,
        event: {
          kind: 'run.completed' as const,
          runId: input.runId,
          stopReason: 'completed',
        },
      }
    : input.outcome === 'failed'
      ? {
          runFence,
          idempotencyKey: `run-failed:${input.runId}:continuation:${input.commandId}`,
          event: {
            kind: 'run.failed' as const,
            runId: input.runId,
            stopReason: 'tool_error',
            errorCode: 'PROJECT_AGENT_TOOL_ERROR',
            errorMessage: 'Project agent continuation reached a tool error',
          },
        }
      : input.outcome === 'outcome_unknown'
        ? {
            runFence,
            idempotencyKey: `run-failed:${input.runId}:continuation-outcome-unknown:${input.commandId}`,
            event: {
              kind: 'run.failed' as const,
              runId: input.runId,
              stopReason: 'continuation_outcome_unknown',
              errorCode: 'PROJECT_AGENT_CONTINUATION_OUTCOME_UNKNOWN',
              errorMessage: 'Project agent continuation outcome is unknown and must not be replayed automatically',
            },
          }
        : {
            runFence,
            idempotencyKey: `run-failed:${input.runId}:continuation-delivery-exhausted:${input.commandId}`,
            event: {
              kind: 'run.failed' as const,
              runId: input.runId,
              stopReason: 'continuation_delivery_exhausted',
              errorCode: 'PROJECT_AGENT_CONTINUATION_DELIVERY_EXHAUSTED',
              errorMessage: 'Project agent continuation delivery exhausted before execution could complete',
            },
          }
  await appendProjectAgentEventsInTransaction(tx, {
    scope: {
      projectId: input.wait.projectId,
      userId: input.wait.userId,
      episodeId: input.wait.episodeId,
      assistantId: input.wait.assistantId as ProjectAssistantId,
      scopeRef: input.wait.scopeRef,
    },
    events: [activityEvent, {
      runFence,
      idempotencyKey: `wait-followed:${input.wait.id}:${input.commandId}`,
      event: {
        kind: 'wait.followed' as const,
        runId: input.runId,
        activityId: input.commandId,
        waitId: input.wait.id,
        claimId: input.claimOwner,
        commandId: input.commandId,
        sourceOperationId: input.wait.operationId,
      },
    }, terminalRunEvent],
  })
}

/**
 * The sole terminal continuation settlement authority. It atomically persists
 * the assistant message, closes the checkpoint, follows the Wait, completes
 * or fails the continuation Activity, and advances the Run terminal state.
 */
export async function settleProjectAgentContinuationTerminalHandoff(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
  outcome: ProjectAgentContinuationTerminalOutcome
  message: UIMessage
}): Promise<ProjectAgentContinuationCheckpoint> {
  if (!input.message.id.trim()) throw new Error('PROJECT_AGENT_CONTINUATION_MESSAGE_ID_REQUIRED')
  const messageJson = serializeContinuationMessage(input.message)
  return await prisma.$transaction(async (tx) => {
    const wait = await lockClaimedProjectAgentContinuationWait(tx, input)
    const checkpoint = await tx.projectAgentContinuationCheckpoint.findUnique({
      where: { commandId: input.commandId },
    })
    if (!checkpoint || checkpoint.waitId !== input.waitId || checkpoint.runId !== input.runId) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_IDENTITY_MISMATCH:${input.commandId}`)
    }
    if (checkpoint.status === 'settled') {
      if (
        checkpoint.outcome !== input.outcome
        || checkpoint.messageId !== input.message.id
        || !isDeepStrictEqual(checkpoint.messageJson, messageJson)
      ) throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_CONFLICT:${input.commandId}`)
    } else if (checkpoint.status === 'running') {
      await appendProjectAssistantThreadMessagesInTransaction(tx, {
        projectId: wait.projectId,
        userId: wait.userId,
        episodeId: wait.episodeId,
        assistantId: wait.assistantId as ProjectAssistantId,
        messages: [input.message],
      })
      const updated = await tx.projectAgentContinuationCheckpoint.updateMany({
        where: {
          commandId: input.commandId,
          waitId: input.waitId,
          runId: input.runId,
          status: 'running',
        },
        data: {
          status: 'settled',
          outcome: input.outcome,
          messageId: input.message.id,
          messageJson,
          completedAt: new Date(),
        },
      })
      if (updated.count !== 1) {
        throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_CAS_FAILED:${input.commandId}`)
      }
    } else {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STATE_INVALID:${input.commandId}`)
    }
    await appendProjectAgentContinuationTerminalEventsInTransaction(tx, {
      runId: input.runId,
      wait,
      commandId: input.commandId,
      claimOwner: input.claimOwner,
      outcome: input.outcome,
    })
    return {
      commandId: input.commandId,
      waitId: input.waitId,
      runId: input.runId,
      outcome: input.outcome,
      messageId: input.message.id,
    }
  })
}

/** Replays an already durable terminal checkpoint without invoking the model. */
export async function finalizeProjectAgentContinuationHandoff(input: {
  runId: string
  waitId: string
  commandId: string
  claimOwner: string
  projectId: string
  userId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const wait = await lockClaimedProjectAgentContinuationWait(tx, input)
    const checkpoint = await tx.projectAgentContinuationCheckpoint.findUnique({
      where: { commandId: input.commandId },
    })
    if (
      !checkpoint
      || checkpoint.waitId !== input.waitId
      || checkpoint.runId !== input.runId
      || checkpoint.status !== 'settled'
      || checkpoint.outcome === null
      || checkpoint.messageId === null
      || checkpoint.messageJson === null
    ) {
      throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING:${input.commandId}`)
    }
    const outcome = normalizeProjectAgentContinuationOutcome(checkpoint.outcome)
    if (
      outcome === 'awaiting_task'
      || outcome === 'awaiting_choice'
      || outcome === 'awaiting_approval'
    ) {
      return
    }
    await appendProjectAgentContinuationTerminalEventsInTransaction(tx, {
      runId: input.runId,
      wait,
      commandId: input.commandId,
      claimOwner: input.claimOwner,
      outcome,
    })
  })
}

export async function loadProjectAgentContinuationCheckpoint(input: {
  waitId: string
  runId: string
  commandId: string
}): Promise<ProjectAgentContinuationCheckpoint | null> {
  const checkpoint = await prisma.projectAgentContinuationCheckpoint.findUnique({
    where: { commandId: input.commandId },
  })
  if (!checkpoint) return null
  if (checkpoint.waitId !== input.waitId || checkpoint.runId !== input.runId) {
    throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_IDENTITY_MISMATCH:${input.commandId}`)
  }
  if (checkpoint.status === 'running') return null
  if (
    checkpoint.status !== 'settled'
    || checkpoint.outcome === null
    || checkpoint.messageId === null
    || checkpoint.messageJson === null
  ) throw new Error(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_STATE_INVALID:${input.commandId}`)
  return {
    commandId: checkpoint.commandId,
    waitId: checkpoint.waitId,
    runId: checkpoint.runId,
    outcome: normalizeProjectAgentContinuationOutcome(checkpoint.outcome),
    messageId: checkpoint.messageId,
  }
}

/**
 * Makes a previously prepared Choice handoff visible. The Interaction, its
 * waiting Activity and the Run transition are still one reducer transaction;
 * preparation is deliberately invisible so a pre-settlement crash never
 * leaves a card without a recoverable source intent.
 */
export async function settleProjectAgentPreparedChoiceHandoff(input: {
  executionFence: ProjectAgentOperationExecutionFence
  handoff: ProjectAgentChoiceHandoffReceipt
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  message: UIMessage
  continuation?: ProjectAgentExecutionSegmentContinuation | null
}): Promise<ProjectAgentChoiceSuspensionReceipt> {
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  if (input.handoff.runId !== input.executionFence.runFence.runId) {
    throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_FENCE_MISMATCH:${input.handoff.handoffId}`)
  }
  let receipt: ProjectAgentChoiceSuspensionReceipt | null = null

  await prisma.$transaction(async (tx) => {
    await assertProjectAgentOperationExecutionFenceInTransaction(tx, input.executionFence)
    const handoff = await tx.projectAgentExecutionHandoff.findUnique({
      where: { id: input.handoff.handoffId },
    })
    if (!handoff) throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_NOT_FOUND:${input.handoff.handoffId}`)
    const payload = parseChoicePayload(handoff.payload)
    assertChoiceHandoffIdentity({
      handoff,
      input: {
        executionSegmentId: input.handoff.executionSegmentId,
        runId: input.handoff.runId,
        projectId: input.projectId,
        userId: input.userId,
        assistantId,
        scopeRef,
        operationId: input.handoff.operationId,
        payload,
      },
    })
    if (normalizeStatus(handoff.status) !== 'prepared') {
      throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_ALREADY_SETTLED:${handoff.executionSegmentId}`)
    }
    if (payload.card.toolCallId !== input.handoff.toolCallId) {
      throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_TOOL_CALL_MISMATCH:${handoff.id}`)
    }
    const activityId = randomUUID()
    const interruptionId = randomUUID()
    const offer = buildProjectAgentChoiceOffer({
      runId: input.handoff.runId,
      interruptionId,
      card: payload.card,
      reviewedResource: payload.reviewedResource,
    })
    await assertProjectAgentChoiceOfferCurrent({
      tx,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      offer,
    })
    await appendProjectAgentInterruptionReplacementInTransaction(tx, {
      scope: {
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      runId: input.handoff.runId,
      runFence: input.executionFence.runFence,
      nextActivityId: activityId,
      raisedEvent: {
        runFence: input.executionFence.runFence,
        idempotencyKey: `interruption-raised:${interruptionId}`,
        event: {
          kind: 'interruption.raised',
          runId: input.handoff.runId,
          activityId,
          interruptionId,
          interruptionKind: 'choice',
          operationId: input.handoff.operationId,
          approvalId: `choice:${randomUUID()}`,
          toolCallId: input.handoff.toolCallId,
          choiceType: offer.card.choiceType,
          payload: offer as unknown as Prisma.InputJsonValue,
          runState: null,
        },
      },
    })
    await appendProjectAgentExecutionSegmentMessageHandoffInTransaction(tx, {
      runFence: input.executionFence.runFence,
      runId: input.handoff.runId,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      scopeRef,
      message: input.message,
      outcome: 'awaiting_choice',
      sourceOperationId: handoff.operationId,
      continuation: input.continuation ?? null,
    })
    assertProjectAgentOperationExecutionFenceSignal(input.executionFence)
    const settled = await tx.projectAgentExecutionHandoff.updateMany({
      where: { id: handoff.id, status: 'prepared' },
      data: { status: 'settled', settledAt: new Date() },
    })
    if (settled.count !== 1) {
      throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_SETTLEMENT_RACED:${handoff.id}`)
    }
    receipt = {
      kind: 'choice',
      runId: input.handoff.runId,
      operationId: input.handoff.operationId,
      activityId,
      interruptionId,
      cardId: offer.card.cardId,
      toolCallId: offer.card.toolCallId,
      choiceType: offer.card.choiceType,
      card: offer.card as ProjectAgentChoiceCardPartData,
    }
  })
  if (!receipt) throw new Error(`PROJECT_AGENT_CHOICE_HANDOFF_SETTLEMENT_MISSING:${input.handoff.handoffId}`)
  recordProjectAgentSuspensionReceipt(receipt)
  return receipt
}

/** Commits a prepared Approval together with its assistant message. */
export async function settleProjectAgentPreparedApprovalHandoff(input: {
  executionFence: ProjectAgentOperationExecutionFence
  handoff: ProjectAgentApprovalHandoffReceipt
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  message: UIMessage
  continuation?: ProjectAgentExecutionSegmentContinuation | null
}): Promise<ProjectAgentApprovalSuspensionReceipt> {
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  if (input.handoff.runId !== input.executionFence.runFence.runId) {
    throw new Error(`PROJECT_AGENT_APPROVAL_HANDOFF_FENCE_MISMATCH:${input.handoff.handoffId}`)
  }
  let receipt: ProjectAgentApprovalSuspensionReceipt | null = null
  await prisma.$transaction(async (tx) => {
    await assertProjectAgentOperationExecutionFenceInTransaction(tx, input.executionFence)
    const handoff = await tx.projectAgentExecutionHandoff.findUnique({
      where: { id: input.handoff.handoffId },
    })
    if (!handoff) throw new Error(`PROJECT_AGENT_APPROVAL_HANDOFF_NOT_FOUND:${input.handoff.handoffId}`)
    const payload = parseApprovalPayload(handoff.payload)
    if (
      handoff.executionSegmentId !== input.handoff.executionSegmentId
      || handoff.runId !== input.handoff.runId
      || handoff.projectId !== input.projectId
      || handoff.userId !== input.userId
      || handoff.assistantId !== assistantId
      || handoff.scopeRef !== scopeRef
      || handoff.kind !== 'approval'
      || handoff.operationId !== input.handoff.operationId
      || normalizeStatus(handoff.status) !== 'prepared'
      || payload.approvalId !== input.handoff.approvalId
      || payload.toolCallId !== input.handoff.toolCallId
    ) throw new Error(`PROJECT_AGENT_APPROVAL_HANDOFF_IDENTITY_CONFLICT:${input.handoff.executionSegmentId}`)
    const activityId = randomUUID()
    const interruptionId = randomUUID()
    await appendProjectAgentInterruptionReplacementInTransaction(tx, {
      scope: {
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId ?? null,
        assistantId,
        scopeRef,
      },
      runId: handoff.runId,
      runFence: input.executionFence.runFence,
      nextActivityId: activityId,
      raisedEvent: {
        runFence: input.executionFence.runFence,
        idempotencyKey: `interruption-raised:${interruptionId}`,
        event: {
          kind: 'interruption.raised',
          runId: handoff.runId,
          activityId,
          interruptionId,
          interruptionKind: 'approval',
          operationId: handoff.operationId,
          approvalId: payload.approvalId,
          toolCallId: payload.toolCallId,
          payload: payload.payload as unknown as Prisma.InputJsonValue,
          runState: payload.runState,
        },
      },
    })
    await appendProjectAgentExecutionSegmentMessageHandoffInTransaction(tx, {
      runFence: input.executionFence.runFence,
      runId: handoff.runId,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      scopeRef,
      message: input.message,
      outcome: 'awaiting_approval',
      sourceOperationId: handoff.operationId,
      continuation: input.continuation ?? null,
    })
    assertProjectAgentOperationExecutionFenceSignal(input.executionFence)
    const settled = await tx.projectAgentExecutionHandoff.updateMany({
      where: { id: handoff.id, status: 'prepared' },
      data: { status: 'settled', settledAt: new Date() },
    })
    if (settled.count !== 1) {
      throw new Error(`PROJECT_AGENT_APPROVAL_HANDOFF_SETTLEMENT_RACED:${handoff.id}`)
    }
    receipt = {
      kind: 'approval',
      runId: handoff.runId,
      operationId: handoff.operationId,
      activityId,
      interruptionId,
      approvalId: payload.approvalId,
      toolCallId: payload.toolCallId,
    }
  })
  if (!receipt) throw new Error(`PROJECT_AGENT_APPROVAL_HANDOFF_SETTLEMENT_MISSING:${input.handoff.handoffId}`)
  recordProjectAgentSuspensionReceipt(receipt)
  return receipt
}

export async function settleProjectAgentPreparedTaskHandoff(input: {
  executionFence: ProjectAgentOperationExecutionFence
  executionSegmentId: string
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  operationId: string
  taskIds: readonly string[]
  message: UIMessage
  continuation?: ProjectAgentExecutionSegmentContinuation | null
}): Promise<ProjectAgentTaskHandoffReceipt> {
  const executionSegmentId = requireIdentity(
    input.executionSegmentId,
    'PROJECT_AGENT_TASK_HANDOFF_SEGMENT_ID_REQUIRED',
  )
  const assistantId = input.assistantId ?? 'workspace-command'
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  const expectedTaskIds = Array.from(new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort()
  let receipt: ProjectAgentTaskHandoffReceipt | null = null
  await prisma.$transaction(async (tx) => {
    await assertProjectAgentOperationExecutionFenceInTransaction(tx, input.executionFence)
    const handoff = await tx.projectAgentExecutionHandoff.findUnique({
      where: { executionSegmentId },
    })
    if (!handoff) throw new Error(`PROJECT_AGENT_TASK_HANDOFF_NOT_FOUND:${executionSegmentId}`)
    const payload = parseTaskPayload(handoff.payload)
    if (
      handoff.runId !== input.executionFence.runFence.runId
      || handoff.projectId !== input.projectId
      || handoff.userId !== input.userId
      || handoff.assistantId !== assistantId
      || handoff.scopeRef !== scopeRef
      || handoff.kind !== 'task'
      || handoff.operationId !== input.operationId
      || normalizeStatus(handoff.status) !== 'prepared'
      || JSON.stringify(payload.taskIds) !== JSON.stringify(expectedTaskIds)
    ) {
      throw new Error(`PROJECT_AGENT_TASK_HANDOFF_IDENTITY_CONFLICT:${executionSegmentId}`)
    }
    await appendProjectAgentExecutionSegmentMessageHandoffInTransaction(tx, {
      runFence: input.executionFence.runFence,
      runId: handoff.runId,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      scopeRef,
      message: input.message,
      outcome: 'awaiting_task',
      sourceOperationId: input.operationId,
      continuation: input.continuation ?? null,
    })
    assertProjectAgentOperationExecutionFenceSignal(input.executionFence)
    const settled = await tx.projectAgentExecutionHandoff.updateMany({
      where: { id: handoff.id, status: 'prepared' },
      data: { status: 'settled', settledAt: new Date() },
    })
    if (settled.count !== 1) {
      throw new Error(`PROJECT_AGENT_TASK_HANDOFF_SETTLEMENT_RACED:${handoff.id}`)
    }
    receipt = {
      kind: 'task',
      handoffId: handoff.id,
      executionSegmentId,
      runId: handoff.runId,
      operationId: handoff.operationId,
      waitId: payload.waitId,
      taskIds: payload.taskIds,
      followUpMode: payload.followUpMode,
    }
  })
  if (!receipt) throw new Error(`PROJECT_AGENT_TASK_HANDOFF_SETTLEMENT_MISSING:${executionSegmentId}`)
  return receipt
}

export async function recoverProjectAgentPreparedExecutionHandoff(input: {
  executionFence: ProjectAgentOperationExecutionFence
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  executionSegmentId?: string | null
  continuation?: ProjectAgentExecutionSegmentContinuation | null
}): Promise<'choice' | 'approval' | 'task' | null> {
  const executionSegmentId = input.executionSegmentId?.trim() || null
  const handoff = executionSegmentId
    ? await prisma.projectAgentExecutionHandoff.findUnique({ where: { executionSegmentId } })
    : await prisma.projectAgentExecutionHandoff.findFirst({
        where: { runId: input.executionFence.runFence.runId, status: 'prepared' },
        orderBy: { createdAt: 'asc' },
      })
  if (!handoff || normalizeStatus(handoff.status) !== 'prepared') return null
  if (
    handoff.runId !== input.executionFence.runFence.runId
    || handoff.projectId !== input.projectId
    || handoff.userId !== input.userId
  ) {
    throw new Error(`PROJECT_AGENT_EXECUTION_HANDOFF_RECOVERY_IDENTITY_CONFLICT:${handoff.id}`)
  }
  if (handoff.kind === 'choice') {
    const payload = parseChoicePayload(handoff.payload)
    await settleProjectAgentPreparedChoiceHandoff({
      executionFence: input.executionFence,
      handoff: {
        kind: 'choice',
        handoffId: handoff.id,
        executionSegmentId: handoff.executionSegmentId,
        runId: handoff.runId,
        operationId: handoff.operationId,
        toolCallId: payload.card.toolCallId,
      },
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId: input.assistantId,
      message: {
        id: `workspace-agent-handoff-recovery:${handoff.id}`,
        role: 'assistant',
        parts: [{ type: 'text', text: payload.card.description ?? payload.card.title }],
      },
      continuation: input.continuation ?? null,
    })
    return 'choice'
  }
  if (handoff.kind === 'approval') {
    const payload = parseApprovalPayload(handoff.payload)
    await settleProjectAgentPreparedApprovalHandoff({
      executionFence: input.executionFence,
      handoff: {
        kind: 'approval',
        handoffId: handoff.id,
        executionSegmentId: handoff.executionSegmentId,
        runId: handoff.runId,
        operationId: handoff.operationId,
        approvalId: payload.approvalId,
        toolCallId: payload.toolCallId,
      },
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId: input.assistantId,
      message: {
        id: `workspace-agent-handoff-recovery:${handoff.id}`,
        role: 'assistant',
        parts: [{
          type: 'text',
          text: localizeProjectAgentOperationTitle(
            handoff.operationId,
            normalizeProjectAgentLocale(handoff.locale),
          ),
        }],
      },
      continuation: input.continuation ?? null,
    })
    return 'approval'
  }
  if (handoff.kind === 'task') {
    const payload = parseTaskPayload(handoff.payload)
    await settleProjectAgentPreparedTaskHandoff({
      executionFence: input.executionFence,
      executionSegmentId: handoff.executionSegmentId,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId: input.assistantId,
      operationId: handoff.operationId,
      taskIds: payload.taskIds,
      message: {
        id: `workspace-agent-handoff-recovery:${handoff.id}`,
        role: 'assistant',
        parts: [{
          type: 'text',
          text: localizeProjectAgentOperationTitle(
            handoff.operationId,
            normalizeProjectAgentLocale(handoff.locale),
          ),
        }],
      },
      continuation: input.continuation ?? null,
    })
    return 'task'
  }
  throw new Error(`PROJECT_AGENT_EXECUTION_HANDOFF_KIND_INVALID:${handoff.kind}`)
}
