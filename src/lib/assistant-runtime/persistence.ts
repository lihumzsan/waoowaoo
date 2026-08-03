import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma, type ProjectAgentTurn, type ProjectAssistantThread } from '@prisma/client'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import { recordAgentTurnUsageFactsInTransaction } from '@/lib/agent-turn/usage'
import { buildAgentTurnAssistantMessageId } from '@/lib/agent-turn/stream-publisher'
import { projectErrorForModel } from '@/lib/errors/projection'
import type {
  AssistantRuntimeInteractionView,
  AssistantRuntimeMessageReceipt,
  AssistantRuntimeScope,
  AssistantRuntimeSubmitCommand,
  AssistantRuntimeTerminalProjection,
  AssistantRuntimeTaskFollowUp,
  AssistantRuntimeThreadIdentity,
  AssistantRuntimeTurnIdentity,
} from './contracts'
import { AssistantRuntimeProjectBusyError } from './contracts'

const ACTIVE_TURN_STATUSES = ['queued', 'running', 'waiting_approval'] as const
const TERMINAL_TURN_STATUSES = ['completed', 'failed', 'interrupted', 'cancelled'] as const
const FOLLOW_UP_INPUT_MAX_BYTES = 512 * 1_024

type TransactionClient = Prisma.TransactionClient

type ThreadView = AssistantRuntimeThreadIdentity & {
  readonly runtimeRevision: string | null
  readonly messages: readonly UIMessage[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

type AdmissionView = {
  readonly replayed: boolean
  readonly thread: ThreadView
  readonly turn: AssistantRuntimeTurnIdentity
}

type SteerClaimView = {
  readonly outcome: 'claimed' | 'replayed'
  readonly threadId: string
  readonly turnId: string
  readonly runtimeTurnId: string
}

export type AssistantRuntimeMessageReplayDecision =
  | AssistantRuntimeMessageReceipt
  | { readonly outcome: 'resume_queued' | 'reconcile_unbound_start' }

function requireIdentity(value: string, code: string, maxLength = 191): string {
  if (!value || value !== value.trim() || value.length > maxLength) throw new Error(code)
  return value
}

function runtimeResponseRequestId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESPONSE_INVALID')
  }
  const id = (value as Record<string, unknown>).id
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESPONSE_INVALID')
  }
  return String(id)
}

function assertInteractionDoesNotRequestSecrets(
  interaction: AssistantRuntimeInteractionView,
): void {
  if (interaction.method !== 'item/tool/requestUserInput') return
  const payload = interaction.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const questions = payload.questions
  if (!Array.isArray(questions)) return
  if (questions.some((question) => (
    question !== null
    && typeof question === 'object'
    && !Array.isArray(question)
    && 'isSecret' in question
    && question.isSecret === true
  ))) {
    throw new Error('ASSISTANT_RUNTIME_SECRET_INPUT_UNSUPPORTED')
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('ASSISTANT_RUNTIME_JSON_INVALID')
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

async function parseMessages(value: unknown): Promise<UIMessage[]> {
  if (Array.isArray(value) && value.length === 0) return []
  const validation = await safeValidateUIMessages({ messages: value })
  if (!validation.success) throw new Error('ASSISTANT_RUNTIME_MESSAGES_INVALID')
  const ids = new Set<string>()
  for (const message of validation.data) {
    requireIdentity(message.id, 'ASSISTANT_RUNTIME_MESSAGE_ID_INVALID')
    if (ids.has(message.id)) throw new Error('ASSISTANT_RUNTIME_MESSAGE_ID_DUPLICATE')
    ids.add(message.id)
  }
  return validation.data
}

function serializeMessages(messages: readonly UIMessage[]): Prisma.InputJsonValue {
  return toJson(messages)
}

function appendMessages(existing: readonly UIMessage[], appended: readonly UIMessage[]): UIMessage[] {
  const next = [...existing]
  const byId = new Map(next.map((message) => [message.id, message] as const))
  for (const message of appended) {
    const prior = byId.get(message.id)
    if (prior) {
      if (!isDeepStrictEqual(prior, message)) {
        throw new Error(`ASSISTANT_RUNTIME_MESSAGE_ID_CONFLICT:${message.id}`)
      }
      continue
    }
    byId.set(message.id, message)
    next.push(message)
  }
  return next
}

function insertMessageAfter(
  existing: readonly UIMessage[],
  message: UIMessage,
  afterMessageId: string | null,
): UIMessage[] {
  const prior = existing.find((candidate) => candidate.id === message.id)
  if (prior) {
    if (!isDeepStrictEqual(prior, message)) {
      throw new Error(`ASSISTANT_RUNTIME_MESSAGE_ID_CONFLICT:${message.id}`)
    }
    return [...existing]
  }
  if (!afterMessageId) return [...existing, message]
  const insertionIndex = existing.findIndex((candidate) => candidate.id === afterMessageId)
  if (insertionIndex < 0) return [...existing, message]
  return [
    ...existing.slice(0, insertionIndex + 1),
    message,
    ...existing.slice(insertionIndex + 1),
  ]
}

function upsertMessage(existing: readonly UIMessage[], message: UIMessage): UIMessage[] {
  const index = existing.findIndex((candidate) => candidate.id === message.id)
  if (index < 0) return [...existing, message]
  const prior = existing[index]
  if (isDeepStrictEqual(prior, message)) return [...existing]
  if (prior.role !== 'assistant' || message.role !== 'assistant') {
    throw new Error(`ASSISTANT_RUNTIME_MESSAGE_ID_CONFLICT:${message.id}`)
  }
  const next = [...existing]
  next[index] = message
  return next
}

function normalizePlanForStorage(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ASSISTANT_RUNTIME_PLAN_INVALID')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.plan) || record.plan.length > 25) {
    throw new Error('ASSISTANT_RUNTIME_PLAN_INVALID')
  }
  if (record.explanation !== null && typeof record.explanation !== 'string') {
    throw new Error('ASSISTANT_RUNTIME_PLAN_INVALID')
  }
  const explanation = typeof record.explanation === 'string' ? record.explanation.trim() : null
  if (explanation && explanation.length > 500) throw new Error('ASSISTANT_RUNTIME_PLAN_INVALID')
  const plan = record.plan.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('ASSISTANT_RUNTIME_PLAN_INVALID')
    }
    const item = entry as Record<string, unknown>
    const step = typeof item.step === 'string' ? item.step.trim() : ''
    const status = item.status
    if (
      !step || step.length > 160
      || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')
    ) throw new Error('ASSISTANT_RUNTIME_PLAN_INVALID')
    return { step, status }
  })
  if (plan.length === 0 || plan.every((item) => item.status === 'completed')) return Prisma.JsonNull
  return toJson({ explanation, plan })
}

function threadView(row: ProjectAssistantThread, messages: readonly UIMessage[]): ThreadView {
  return {
    projectId: row.projectId,
    userId: row.userId,
    assistantId: 'workspace-command',
    threadId: row.id,
    runtimeThreadId: row.runtimeThreadId,
    runtimeRevision: row.runtimeRevision,
    messages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function turnIdentity(row: ProjectAgentTurn): AssistantRuntimeTurnIdentity {
  return {
    projectId: row.projectId,
    userId: row.userId,
    assistantId: 'workspace-command',
    threadId: row.threadId,
    runtimeThreadId: null,
    turnId: row.id,
    runtimeTurnId: row.runtimeTurnId,
    attempt: row.attempt,
    status: row.status,
  }
}

function buildTurnId(threadId: string, sourceId: string): string {
  const digest = createHash('sha256')
    .update(threadId, 'utf8')
    .update('\0', 'utf8')
    .update(sourceId, 'utf8')
    .digest('hex')
  return `assistant-turn:${digest}`
}

function buildMessageCommandId(scope: AssistantRuntimeScope, sourceId: string): string {
  const digest = createHash('sha256')
    .update(scope.projectId, 'utf8')
    .update('\0', 'utf8')
    .update(scope.userId, 'utf8')
    .update('\0workspace-command\0', 'utf8')
    .update(sourceId, 'utf8')
    .digest('hex')
  return `assistant-message:${digest}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

export function hashAssistantRuntimeSubmitCommand(command: AssistantRuntimeSubmitCommand): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(command)), 'utf8')
    .digest('hex')
}

async function lockProjectScope(tx: TransactionClient, scope: AssistantRuntimeScope): Promise<void> {
  const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM projects
    WHERE id = ${scope.projectId} AND userId = ${scope.userId}
    FOR UPDATE
  `)
  if (projects.length !== 1) throw new Error('ASSISTANT_RUNTIME_PROJECT_SCOPE_INVALID')
}

async function lockThread(
  tx: TransactionClient,
  scope: AssistantRuntimeScope,
  threadId: string,
): Promise<ProjectAssistantThread> {
  const rows = await tx.$queryRaw<ProjectAssistantThread[]>(Prisma.sql`
    SELECT * FROM project_assistant_threads
    WHERE id = ${threadId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (
    !row
    || row.projectId !== scope.projectId
    || row.userId !== scope.userId
    || row.assistantId !== 'workspace-command'
  ) {
    throw new Error('ASSISTANT_RUNTIME_THREAD_SCOPE_DIVERGED')
  }
  return row
}

export async function readAssistantRuntimeMessageReplay(
  command: AssistantRuntimeSubmitCommand,
): Promise<AssistantRuntimeMessageReplayDecision | null> {
  requireIdentity(command.requestId, 'ASSISTANT_RUNTIME_REQUEST_ID_INVALID', 128)
  requireIdentity(command.sourceId, 'ASSISTANT_RUNTIME_SOURCE_ID_INVALID')
  const payloadHash = hashAssistantRuntimeSubmitCommand(command)
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, command)
    const prior = await tx.projectAssistantMessageCommand.findUnique({
      where: {
        projectId_userId_assistantId_sourceId: {
          projectId: command.projectId,
          userId: command.userId,
          assistantId: 'workspace-command',
          sourceId: command.sourceId,
        },
      },
    })
    if (!prior) return null
    if (
      prior.id !== buildMessageCommandId(command, command.sourceId)
      || prior.payloadHash !== payloadHash
    ) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_REPLAY_DIVERGED')
    }
    if (prior.status !== 'accepted') {
      throw new Error(prior.kind === 'turn'
        ? 'ASSISTANT_RUNTIME_START_HANDOFF_UNCERTAIN'
        : 'ASSISTANT_RUNTIME_STEER_HANDOFF_UNCERTAIN')
    }
    if (prior.kind === 'steer') {
      if (!prior.runtimeTurnId) {
        throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_RUNTIME_TURN_MISSING')
      }
      return {
        threadId: prior.threadId,
        turnId: prior.turnId,
        runtimeTurnId: prior.runtimeTurnId,
      }
    }
    if (prior.kind !== 'turn') {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_KIND_INVALID')
    }
    const currentTurn = await tx.projectAgentTurn.findUnique({
      where: { id: prior.turnId },
      select: {
        threadId: true,
        status: true,
        runtimeTurnId: true,
      },
    })
    if (currentTurn && currentTurn.threadId !== prior.threadId) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_TURN_DIVERGED')
    }
    // A process may fail after durable admission but before turn/start. Let the
    // ordinary admission path reclaim that queued Turn instead of acknowledging
    // work that has never reached app-server.
    if (currentTurn?.status === 'queued' && currentTurn.runtimeTurnId === null) {
      return { outcome: 'resume_queued' }
    }
    if (currentTurn?.status === 'running' && currentTurn.runtimeTurnId === null) {
      return { outcome: 'reconcile_unbound_start' }
    }
    const currentThread = await tx.projectAssistantThread.findUnique({
      where: { id: prior.threadId },
      select: {
        projectId: true,
        userId: true,
        assistantId: true,
        runtimeThreadId: true,
      },
    })
    if (
      currentThread
      && (
        currentThread.projectId !== command.projectId
        || currentThread.userId !== command.userId
        || currentThread.assistantId !== 'workspace-command'
      )
    ) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_THREAD_DIVERGED')
    }
    return {
      outcome: 'replayed',
      threadId: prior.threadId,
      turnId: prior.turnId,
      runtimeThreadId: currentThread?.runtimeThreadId ?? null,
      runtimeTurnId: prior.runtimeTurnId,
    }
  })
}

export async function getOrCreateAssistantRuntimeThread(
  scope: AssistantRuntimeScope,
): Promise<ThreadView> {
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, scope)
    const row = await tx.projectAssistantThread.upsert({
      where: {
        projectId_userId_assistantId: {
          projectId: scope.projectId,
          userId: scope.userId,
          assistantId: 'workspace-command',
        },
      },
      update: {},
      create: {
        projectId: scope.projectId,
        userId: scope.userId,
        assistantId: 'workspace-command',
        messagesJson: serializeMessages([]),
      },
    })
    if (row.clearRequestId) {
      throw new Error('ASSISTANT_RUNTIME_CLEAR_IN_PROGRESS')
    }
    return threadView(row, await parseMessages(row.messagesJson))
  })
}

export async function bindAssistantRuntimeThread(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly runtimeThreadId: string
}): Promise<ThreadView> {
  requireIdentity(input.runtimeThreadId, 'ASSISTANT_RUNTIME_CODEX_THREAD_ID_INVALID')
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const row = await lockThread(tx, input.scope, input.threadId)
    if (row.runtimeThreadId && row.runtimeThreadId !== input.runtimeThreadId) {
      throw new Error('ASSISTANT_RUNTIME_CODEX_THREAD_ID_DIVERGED')
    }
    const updated = row.runtimeThreadId
      ? row
      : await tx.projectAssistantThread.update({
          where: { id: row.id },
          data: { runtimeThreadId: input.runtimeThreadId },
        })
    return threadView(updated, await parseMessages(updated.messagesJson))
  })
}

export async function rotateAssistantRuntimeThreadRevision(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly expectedRuntimeThreadId: string | null
  readonly runtimeRevision: string
}): Promise<ThreadView> {
  const runtimeRevision = requireIdentity(
    input.runtimeRevision,
    'ASSISTANT_RUNTIME_REVISION_INVALID',
    64,
  )
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const row = await lockThread(tx, input.scope, input.threadId)
    if (row.runtimeRevision === runtimeRevision) {
      return threadView(row, await parseMessages(row.messagesJson))
    }
    if (row.runtimeThreadId !== input.expectedRuntimeThreadId) {
      throw new Error('ASSISTANT_RUNTIME_REVISION_THREAD_DIVERGED')
    }
    const updated = await tx.projectAssistantThread.update({
      where: { id: row.id },
      data: {
        runtimeThreadId: null,
        runtimeRevision,
      },
    })
    return threadView(updated, await parseMessages(updated.messagesJson))
  })
}

export async function admitAssistantRuntimeTurn(input: {
  readonly command: AssistantRuntimeSubmitCommand
  readonly threadId: string
  readonly clientPayloadHash: string
}): Promise<AdmissionView> {
  const command = input.command
  requireIdentity(command.requestId, 'ASSISTANT_RUNTIME_REQUEST_ID_INVALID', 128)
  requireIdentity(command.sourceId, 'ASSISTANT_RUNTIME_SOURCE_ID_INVALID')
  const payloadHash = requireIdentity(
    input.clientPayloadHash,
    'ASSISTANT_RUNTIME_MESSAGE_COMMAND_HASH_INVALID',
    64,
  )
  const turnId = buildTurnId(input.threadId, command.sourceId)
  const messageCommandId = buildMessageCommandId(command, command.sourceId)
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, command)
    const thread = await lockThread(tx, command, input.threadId)
    if (thread.clearRequestId) {
      throw new Error('ASSISTANT_RUNTIME_CLEAR_IN_PROGRESS')
    }
    const priorCommand = await tx.projectAssistantMessageCommand.findUnique({
      where: {
        projectId_userId_assistantId_sourceId: {
          projectId: command.projectId,
          userId: command.userId,
          assistantId: 'workspace-command',
          sourceId: command.sourceId,
        },
      },
    })
    if (priorCommand) {
      if (
        priorCommand.id !== messageCommandId
        || priorCommand.payloadHash !== payloadHash
        || priorCommand.kind !== 'turn'
        || priorCommand.status !== 'accepted'
        || priorCommand.threadId !== thread.id
        || priorCommand.turnId !== turnId
      ) {
        throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_REPLAY_DIVERGED')
      }
      const priorTurn = await tx.projectAgentTurn.findUnique({ where: { id: turnId } })
      if (!priorTurn || priorTurn.threadId !== thread.id) {
        throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_TURN_MISSING')
      }
      return {
        replayed: true,
        thread: threadView(thread, await parseMessages(thread.messagesJson)),
        turn: { ...turnIdentity(priorTurn), runtimeThreadId: thread.runtimeThreadId },
      }
    }
    const legacyTurn = await tx.projectAgentTurn.findUnique({
      where: {
        threadId_sourceKind_sourceId: {
          threadId: thread.id,
          sourceKind: 'user',
          sourceId: command.sourceId,
        },
      },
      select: { id: true },
    })
    if (legacyTurn) throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_MISSING')
    const active = await tx.projectAgentTurn.findFirst({
      where: {
        projectId: command.projectId,
        userId: command.userId,
        status: { in: [...ACTIVE_TURN_STATUSES] },
      },
      select: { id: true },
    })
    if (active) throw new AssistantRuntimeProjectBusyError()

    const messages = await parseMessages(thread.messagesJson)
    const nextMessages = appendMessages(messages, [command.message])
    const updatedThread = await tx.projectAssistantThread.update({
      where: { id: thread.id },
      data: { messagesJson: serializeMessages(nextMessages) },
    })
    const row = await tx.projectAgentTurn.create({
      data: {
        id: turnId,
        threadId: thread.id,
        projectId: command.projectId,
        userId: command.userId,
        sourceKind: 'user',
        sourceId: command.sourceId,
        payloadHash,
        requestId: command.requestId,
        status: 'queued',
        attempt: 0,
        userMessageJson: toJson(command.message),
        contextJson: toJson(command.context),
      },
    })
    await tx.projectAssistantMessageCommand.create({
      data: {
        id: messageCommandId,
        projectId: command.projectId,
        userId: command.userId,
        assistantId: 'workspace-command',
        sourceId: command.sourceId,
        payloadHash,
        kind: 'turn',
        status: 'accepted',
        threadId: thread.id,
        turnId: row.id,
        runtimeTurnId: null,
        messageJson: toJson(command.message),
        acceptedAt: new Date(),
      },
    })
    return {
      replayed: false,
      thread: threadView(updatedThread, nextMessages),
      turn: { ...turnIdentity(row), runtimeThreadId: updatedThread.runtimeThreadId },
    }
  })
}

export async function bindAssistantRuntimeTurn(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly runtimeTurnId: string
}): Promise<AssistantRuntimeTurnIdentity> {
  requireIdentity(input.runtimeTurnId, 'ASSISTANT_RUNTIME_CODEX_TURN_ID_INVALID')
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId) {
      throw new Error('ASSISTANT_RUNTIME_CLEAR_IN_PROGRESS')
    }
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const row = rows[0]
    if (!row || row.threadId !== thread.id) throw new Error('ASSISTANT_RUNTIME_TURN_SCOPE_DIVERGED')
    if (
      (row.runtimeTurnId && row.runtimeTurnId !== input.runtimeTurnId)
      || (row.executionOwnerId && row.executionOwnerId !== input.runtimeTurnId)
    ) {
      throw new Error('ASSISTANT_RUNTIME_CODEX_TURN_ID_DIVERGED')
    }
    if (
      row.cancelRequestId
      || row.status !== 'running'
    ) {
      throw new Error(`ASSISTANT_RUNTIME_TURN_NOT_STARTABLE:${row.status}`)
    }
    const updated = await tx.projectAgentTurn.update({
      where: { id: row.id },
      data: {
        runtimeTurnId: input.runtimeTurnId,
        executionOwnerId: input.runtimeTurnId,
        status: 'running',
        attempt: row.attempt === 0 ? 1 : row.attempt,
        startedAt: row.startedAt ?? new Date(),
      },
    })
    if (row.sourceKind === 'user') {
      const bound = await tx.projectAssistantMessageCommand.updateMany({
        where: {
          projectId: input.scope.projectId,
          userId: input.scope.userId,
          assistantId: 'workspace-command',
          sourceId: row.sourceId,
          kind: 'turn',
          status: 'accepted',
          threadId: thread.id,
          turnId: row.id,
        },
        data: { runtimeTurnId: input.runtimeTurnId },
      })
      if (bound.count !== 1) {
        throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_BINDING_MISSING')
      }
    }
    return { ...turnIdentity(updated), runtimeThreadId: thread.runtimeThreadId }
  })
}

/**
 * Claims product execution immediately before app-server turn/start. The
 * native Turn id is not known yet, so model/MCP guards continue to require the
 * later binding. Cancellation and clear serialize with this claim on the same
 * Project/Thread/Turn locks.
 */
export async function claimAssistantRuntimeTurnStart(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
}): Promise<AssistantRuntimeTurnIdentity> {
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId) throw new Error('ASSISTANT_RUNTIME_CLEAR_IN_PROGRESS')
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const row = rows[0]
    if (!row || row.threadId !== thread.id) {
      throw new Error('ASSISTANT_RUNTIME_TURN_SCOPE_DIVERGED')
    }
    if (row.cancelRequestId || row.status !== 'queued' || row.runtimeTurnId) {
      throw new Error(`ASSISTANT_RUNTIME_TURN_NOT_STARTABLE:${row.status}`)
    }
    const updated = await tx.projectAgentTurn.update({
      where: { id: row.id },
      data: {
        status: 'running',
        attempt: row.attempt === 0 ? 1 : row.attempt,
        startedAt: row.startedAt ?? new Date(),
      },
    })
    return { ...turnIdentity(updated), runtimeThreadId: thread.runtimeThreadId }
  })
}

export async function failAssistantRuntimeTurnStart(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly reason: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (!turn || turn.threadId !== thread.id) {
      throw new Error('ASSISTANT_RUNTIME_TURN_SCOPE_DIVERGED')
    }
    if (TERMINAL_TURN_STATUSES.includes(turn.status as (typeof TERMINAL_TURN_STATUSES)[number])) {
      return
    }
    if (turn.runtimeTurnId) {
      throw new Error('ASSISTANT_RUNTIME_START_FAILURE_AFTER_RUNTIME_BINDING')
    }
    await tx.projectAgentTurn.update({
      where: { id: turn.id },
      data: {
        status: turn.cancelRequestId ? 'cancelled' : 'interrupted',
        stopReason: turn.cancelRequestId ? 'cancelled_before_binding' : input.reason,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      },
    })
  })
}

export async function failAssistantRuntimeBoundTurnStart(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly runtimeTurnId: string
  readonly reason: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (!turn || turn.threadId !== thread.id) {
      throw new Error('ASSISTANT_RUNTIME_TURN_SCOPE_DIVERGED')
    }
    if (TERMINAL_TURN_STATUSES.includes(turn.status as (typeof TERMINAL_TURN_STATUSES)[number])) {
      return
    }
    if (
      turn.runtimeTurnId !== input.runtimeTurnId
      || turn.executionOwnerId !== input.runtimeTurnId
    ) {
      throw new Error('ASSISTANT_RUNTIME_BOUND_START_IDENTITY_DIVERGED')
    }
    await tx.projectAgentTurn.update({
      where: { id: turn.id },
      data: {
        status: turn.cancelRequestId ? 'cancelled' : 'interrupted',
        stopReason: turn.cancelRequestId ? 'cancelled_during_projection_start' : input.reason,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      },
    })
  })
}

export async function claimAssistantRuntimeSteer(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly sourceId: string
  readonly message: UIMessage
  readonly clientPayloadHash: string
}): Promise<SteerClaimView> {
  requireIdentity(input.sourceId, 'ASSISTANT_RUNTIME_SOURCE_ID_INVALID')
  const commandId = buildMessageCommandId(input.scope, input.sourceId)
  const payloadHash = requireIdentity(
    input.clientPayloadHash,
    'ASSISTANT_RUNTIME_MESSAGE_COMMAND_HASH_INVALID',
    64,
  )
  const messageJson = toJson(input.message)
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId) throw new Error('ASSISTANT_RUNTIME_CLEAR_IN_PROGRESS')
    const prior = await tx.projectAssistantMessageCommand.findUnique({
      where: {
        projectId_userId_assistantId_sourceId: {
          projectId: input.scope.projectId,
          userId: input.scope.userId,
          assistantId: 'workspace-command',
          sourceId: input.sourceId,
        },
      },
    })
    if (prior) {
      if (
        prior.id !== commandId
        || prior.kind !== 'steer'
        || prior.threadId !== thread.id
        || prior.turnId !== input.turnId
        || prior.payloadHash !== payloadHash
        || !isDeepStrictEqual(prior.messageJson, messageJson)
      ) {
        throw new Error('ASSISTANT_RUNTIME_MESSAGE_COMMAND_REPLAY_DIVERGED')
      }
      if (prior.status !== 'accepted' || !prior.runtimeTurnId) {
        throw new Error('ASSISTANT_RUNTIME_STEER_HANDOFF_UNCERTAIN')
      }
      return {
        outcome: 'replayed',
        threadId: prior.threadId,
        turnId: prior.turnId,
        runtimeTurnId: prior.runtimeTurnId,
      }
    }
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (
      !turn
      || turn.threadId !== thread.id
      || turn.status !== 'running'
      || turn.cancelRequestId
      || !turn.runtimeTurnId
    ) {
      throw new Error('ASSISTANT_RUNTIME_STEER_TARGET_INVALID')
    }
    await tx.projectAssistantMessageCommand.create({
      data: {
        id: commandId,
        projectId: input.scope.projectId,
        userId: input.scope.userId,
        assistantId: 'workspace-command',
        sourceId: input.sourceId,
        payloadHash,
        kind: 'steer',
        status: 'pending',
        threadId: thread.id,
        turnId: turn.id,
        runtimeTurnId: turn.runtimeTurnId,
        messageJson,
      },
    })
    return {
      outcome: 'claimed',
      threadId: thread.id,
      turnId: turn.id,
      runtimeTurnId: turn.runtimeTurnId,
    }
  })
}

export async function markAssistantRuntimeSteerUncertain(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly sourceId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    // Do not lock the Thread here: clear may already have removed it. The
    // uncertain tombstone is project-scoped precisely so it survives clear.
    const handoff = await tx.projectAssistantMessageCommand.findUnique({
      where: {
        projectId_userId_assistantId_sourceId: {
          projectId: input.scope.projectId,
          userId: input.scope.userId,
          assistantId: 'workspace-command',
          sourceId: input.sourceId,
        },
      },
    })
    if (
      !handoff
      || handoff.id !== buildMessageCommandId(input.scope, input.sourceId)
      || handoff.kind !== 'steer'
      || handoff.threadId !== input.threadId
      || handoff.turnId !== input.turnId
    ) {
      throw new Error('ASSISTANT_RUNTIME_STEER_HANDOFF_NOT_FOUND')
    }
    if (handoff.status === 'accepted' || handoff.status === 'uncertain') return
    if (handoff.status !== 'pending') {
      throw new Error('ASSISTANT_RUNTIME_STEER_HANDOFF_STATUS_INVALID')
    }
    await tx.projectAssistantMessageCommand.update({
      where: { id: handoff.id },
      data: { status: 'uncertain' },
    })
  })
}

export async function acceptAssistantRuntimeSteer(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly sourceId: string
  readonly runtimeTurnId: string
  readonly message: UIMessage
  readonly clientPayloadHash: string
  readonly assistantBoundaryMessageId: string | null
}): Promise<void> {
  const payloadHash = requireIdentity(
    input.clientPayloadHash,
    'ASSISTANT_RUNTIME_MESSAGE_COMMAND_HASH_INVALID',
    64,
  )
  const messageJson = toJson(input.message)
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (
      !turn
      || turn.threadId !== thread.id
      || turn.runtimeTurnId !== input.runtimeTurnId
    ) {
      throw new Error('ASSISTANT_RUNTIME_STEER_ACCEPT_TARGET_DIVERGED')
    }
    const handoff = await tx.projectAssistantMessageCommand.findUnique({
      where: {
        projectId_userId_assistantId_sourceId: {
          projectId: input.scope.projectId,
          userId: input.scope.userId,
          assistantId: 'workspace-command',
          sourceId: input.sourceId,
        },
      },
    })
    if (
      !handoff
      || handoff.id !== buildMessageCommandId(input.scope, input.sourceId)
      || handoff.kind !== 'steer'
      || handoff.threadId !== thread.id
      || handoff.turnId !== turn.id
      || handoff.runtimeTurnId !== input.runtimeTurnId
      || handoff.payloadHash !== payloadHash
      || !isDeepStrictEqual(handoff.messageJson, messageJson)
    ) {
      throw new Error('ASSISTANT_RUNTIME_STEER_ACCEPT_DIVERGED')
    }
    if (handoff.status === 'accepted') return
    if (handoff.status !== 'pending') {
      throw new Error('ASSISTANT_RUNTIME_STEER_HANDOFF_UNCERTAIN')
    }
    const messages = await parseMessages(thread.messagesJson)
    const nextMessages = insertMessageAfter(
      messages,
      input.message,
      input.assistantBoundaryMessageId,
    )
    if (!isDeepStrictEqual(nextMessages, messages)) {
      await tx.projectAssistantThread.update({
        where: { id: thread.id },
        data: { messagesJson: serializeMessages(nextMessages) },
      })
    }
    await tx.projectAssistantMessageCommand.update({
      where: { id: handoff.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
      },
    })
  })
}

export async function readAssistantRuntimeActiveTurn(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
}): Promise<AssistantRuntimeTurnIdentity> {
  const thread = await prisma.projectAssistantThread.findUnique({ where: { id: input.threadId } })
  if (
    !thread
    || thread.projectId !== input.scope.projectId
    || thread.userId !== input.scope.userId
    || thread.assistantId !== 'workspace-command'
  ) {
    throw new Error('ASSISTANT_RUNTIME_THREAD_SCOPE_DIVERGED')
  }
  const turn = await prisma.projectAgentTurn.findUnique({ where: { id: input.turnId } })
  if (
    !turn
    || turn.threadId !== thread.id
    || turn.status !== 'running'
    || turn.cancelRequestId
    || !turn.runtimeTurnId
  ) {
    throw new Error('ASSISTANT_RUNTIME_ACTIVE_TURN_INVALID')
  }
  return { ...turnIdentity(turn), runtimeThreadId: thread.runtimeThreadId }
}

export async function resolveAssistantRuntimeMessageTarget(
  scope: AssistantRuntimeScope & { readonly sourceId: string },
): Promise<AssistantRuntimeTurnIdentity | null> {
  const thread = await prisma.projectAssistantThread.findUnique({
    where: {
      projectId_userId_assistantId: {
        projectId: scope.projectId,
        userId: scope.userId,
        assistantId: 'workspace-command',
      },
    },
  })
  if (!thread) return null
  const active = await prisma.projectAgentTurn.findMany({
    where: {
      threadId: thread.id,
      status: { in: [...ACTIVE_TURN_STATUSES] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2,
  })
  if (active.length > 1) throw new Error('ASSISTANT_RUNTIME_ACTIVE_TURN_CONFLICT')
  const turn = active[0]
  if (!turn) return null
  // An HTTP retry of the original user message must return through admission's
  // idempotent replay path. Treating the same source identity as a steer would
  // inject the user's request twice into the live Runtime Turn.
  if (turn.sourceId === scope.sourceId) return null
  if (turn.status !== 'running' || !turn.runtimeTurnId || turn.cancelRequestId) {
    throw new AssistantRuntimeProjectBusyError()
  }
  return {
    ...turnIdentity(turn),
    runtimeThreadId: thread.runtimeThreadId,
  }
}

export async function persistAssistantRuntimeInteraction(
  interaction: AssistantRuntimeInteractionView & AssistantRuntimeScope,
): Promise<void> {
  assertInteractionDoesNotRequestSecrets(interaction)
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, interaction)
    const thread = await lockThread(tx, interaction, interaction.threadId)
    if (thread.clearRequestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_CLEAR_IN_PROGRESS')
    }
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${interaction.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (
      !turn
      || turn.threadId !== thread.id
      || turn.cancelRequestId
      || !ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])
    ) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_TURN_INVALID')
    }
    const existing = await tx.agentTurnInteraction.findUnique({
      where: {
        turnId_runtimeRequestId: {
          turnId: interaction.turnId,
          runtimeRequestId: interaction.runtimeRequestId,
        },
      },
    })
    const payload = {
      method: interaction.method,
      params: interaction.payload,
      requestId: interaction.requestId,
    }
    if (existing) {
      if (
        existing.id !== interaction.interactionId
        || existing.kind !== 'runtime_request'
        || !isDeepStrictEqual(existing.payloadJson, payload)
      ) {
        throw new Error('ASSISTANT_RUNTIME_INTERACTION_REPLAY_DIVERGED')
      }
      return
    }
    await tx.agentTurnInteraction.create({
      data: {
        id: interaction.interactionId,
        turnId: interaction.turnId,
        kind: 'runtime_request',
        status: 'pending',
        runtimeRequestId: interaction.runtimeRequestId,
        payloadJson: toJson(payload),
      },
    })
    await tx.projectAgentTurn.update({
      where: { id: turn.id },
      data: { status: 'waiting_approval' },
    })
  })
}

export async function decideAssistantRuntimeInteraction(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly interactionId: string
  readonly response: unknown
}): Promise<{ readonly runtimeRequestId: string; readonly replayed: boolean }> {
  const responseRequestId = runtimeResponseRequestId(input.response)
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_CLEAR_IN_PROGRESS')
    }
    const interaction = await tx.agentTurnInteraction.findUnique({
      where: { id: input.interactionId },
      include: { turn: true },
    })
    if (
      !interaction
      || interaction.turnId !== input.turnId
      || interaction.turn.threadId !== thread.id
      || !interaction.runtimeRequestId
    ) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_SCOPE_DIVERGED')
    }
    if (interaction.turn.cancelRequestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_CANCELLED')
    }
    if (responseRequestId !== interaction.runtimeRequestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESPONSE_ID_DIVERGED')
    }
    if (interaction.responseJson !== null) {
      if (!isDeepStrictEqual(interaction.responseJson, input.response)) {
        throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESPONSE_DIVERGED')
      }
      return { runtimeRequestId: interaction.runtimeRequestId, replayed: true }
    }
    if (interaction.status !== 'pending') {
      throw new Error(`ASSISTANT_RUNTIME_INTERACTION_NOT_PENDING:${interaction.status}`)
    }
    await tx.agentTurnInteraction.update({
      where: { id: interaction.id },
      data: {
        status: 'decided',
        responseJson: toJson(input.response),
        version: { increment: 1 },
      },
    })
    return { runtimeRequestId: interaction.runtimeRequestId, replayed: false }
  })
}

export async function resolveAssistantRuntimeInteraction(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly runtimeRequestId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId) return
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (!turn || turn.threadId !== thread.id) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_TURN_INVALID')
    }
    if (turn.cancelRequestId) return
    const interaction = await tx.agentTurnInteraction.findUnique({
      where: {
        turnId_runtimeRequestId: {
          turnId: input.turnId,
          runtimeRequestId: input.runtimeRequestId,
        },
      },
    })
    if (!interaction || interaction.status === 'resolved' || interaction.status === 'cancelled') return
    if (interaction.status !== 'decided') {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESOLVED_WITHOUT_DECISION')
    }
    await tx.agentTurnInteraction.update({
      where: { id: interaction.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    })
    await tx.projectAgentTurn.updateMany({
      where: {
        id: input.turnId,
        status: 'waiting_approval',
        cancelRequestId: null,
      },
      data: { status: 'running' },
    })
  })
}

export async function replaceAssistantRuntimePlan(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly plan: unknown
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    await lockThread(tx, input.scope, input.threadId)
    await tx.projectAssistantThread.update({
      where: { id: input.threadId },
      data: { planJson: normalizePlanForStorage(input.plan) },
    })
  })
}

export async function persistAssistantRuntimeMessageSnapshot(input: {
  readonly identity: AssistantRuntimeTurnIdentity
  readonly message: UIMessage
}): Promise<void> {
  const baseMessageId = buildAgentTurnAssistantMessageId({
    turnId: input.identity.turnId,
    attempt: input.identity.attempt,
  })
  const isTurnSegment = input.message.id === baseMessageId
    || new RegExp(`^${baseMessageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:segment:[1-9][0-9]*$`).test(input.message.id)
  if (!isTurnSegment || input.message.role !== 'assistant') {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_SNAPSHOT_INVALID')
  }
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.identity)
    const thread = await lockThread(tx, input.identity, input.identity.threadId)
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.identity.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (
      !turn
      || turn.threadId !== thread.id
      || turn.runtimeTurnId !== input.identity.runtimeTurnId
      || turn.attempt !== input.identity.attempt
      || !ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])
    ) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_SNAPSHOT_SCOPE_DIVERGED')
    }
    const messages = await parseMessages(thread.messagesJson)
    const nextMessages = upsertMessage(messages, input.message)
    if (!isDeepStrictEqual(nextMessages, messages)) {
      await tx.projectAssistantThread.update({
        where: { id: thread.id },
        data: { messagesJson: serializeMessages(nextMessages) },
      })
    }
  })
}

export async function settleAssistantRuntimeTurn(input: {
  readonly identity: AssistantRuntimeTurnIdentity
  readonly projection: AssistantRuntimeTerminalProjection
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.identity)
    const thread = await lockThread(tx, input.identity, input.identity.threadId)
    const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT * FROM project_agent_turns WHERE id = ${input.identity.turnId} FOR UPDATE
    `)
    const turn = rows[0]
    if (
      !turn
      || turn.threadId !== thread.id
      || turn.runtimeTurnId !== input.identity.runtimeTurnId
    ) {
      throw new Error('ASSISTANT_RUNTIME_SETTLEMENT_SCOPE_DIVERGED')
    }
    if (TERMINAL_TURN_STATUSES.includes(turn.status as (typeof TERMINAL_TURN_STATUSES)[number])) {
      const projectedMessageId = input.projection.assistantMessage?.id ?? null
      if (turn.status !== input.projection.status) {
        throw new Error('ASSISTANT_RUNTIME_SETTLEMENT_REPLAY_DIVERGED')
      }
      if (turn.assistantMessageId === projectedMessageId) return
      // Session recovery can mark the Turn interrupted immediately after the
      // app-server exits, while the live projector is still flushing its last
      // durable tool/message snapshot. It may fill that one missing message,
      // but can never replace an existing terminal message or status.
      if (turn.assistantMessageId !== null || !input.projection.assistantMessage) {
        throw new Error('ASSISTANT_RUNTIME_SETTLEMENT_REPLAY_DIVERGED')
      }
      const messages = await parseMessages(thread.messagesJson)
      const nextMessages = upsertMessage(messages, input.projection.assistantMessage)
      if (!isDeepStrictEqual(nextMessages, messages)) {
        await tx.projectAssistantThread.update({
          where: { id: thread.id },
          data: { messagesJson: serializeMessages(nextMessages) },
        })
      }
      await tx.projectAgentTurn.update({
        where: { id: turn.id },
        data: { assistantMessageId: projectedMessageId },
      })
      await recordAgentTurnUsageFactsInTransaction({
        tx,
        turnId: turn.id,
        attempt: turn.attempt,
        projectId: turn.projectId,
        userId: turn.userId,
        usageFacts: input.projection.usage ? [input.projection.usage] : [],
      })
      return
    }
    const messages = await parseMessages(thread.messagesJson)
    const nextMessages = input.projection.assistantMessage
      ? upsertMessage(messages, input.projection.assistantMessage)
      : messages
    if (!isDeepStrictEqual(nextMessages, messages)) {
      await tx.projectAssistantThread.update({
        where: { id: thread.id },
        data: { messagesJson: serializeMessages(nextMessages) },
      })
    }
    await tx.agentTurnInteraction.updateMany({
      where: { turnId: turn.id, status: { in: ['pending', 'decided'] } },
      data: { status: 'cancelled', resolvedAt: new Date() },
    })
    await tx.projectAgentTurn.update({
      where: { id: turn.id },
      data: {
        status: input.projection.status,
        assistantMessageId: input.projection.assistantMessage?.id ?? null,
        stopReason: input.projection.stopReason,
        errorCode: input.projection.status === 'failed' ? 'ASSISTANT_RUNTIME_TURN_FAILED' : null,
        errorMessage: null,
        finishedAt: new Date(),
      },
    })
    await recordAgentTurnUsageFactsInTransaction({
      tx,
      turnId: turn.id,
      attempt: turn.attempt,
      projectId: turn.projectId,
      userId: turn.userId,
      usageFacts: input.projection.usage ? [input.projection.usage] : [],
    })
  })
}

export async function requestAssistantRuntimeInterrupt(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly turnId: string
  readonly requestId: string
  readonly reason: string | null
}): Promise<{ readonly runtimeTurnId: string | null; readonly terminal: boolean }> {
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const thread = await lockThread(tx, input.scope, input.threadId)
    const turn = await tx.projectAgentTurn.findUnique({ where: { id: input.turnId } })
    if (!turn || turn.threadId !== thread.id) throw new Error('ASSISTANT_RUNTIME_TURN_SCOPE_DIVERGED')
    if (TERMINAL_TURN_STATUSES.includes(turn.status as (typeof TERMINAL_TURN_STATUSES)[number])) {
      return { runtimeTurnId: turn.runtimeTurnId, terminal: true }
    }
    if (turn.cancelRequestId && turn.cancelRequestId !== input.requestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERRUPT_REQUEST_DIVERGED')
    }
    await tx.agentTurnInteraction.updateMany({
      where: { turnId: turn.id, status: { in: ['pending', 'decided'] } },
      data: { status: 'cancelled', resolvedAt: new Date() },
    })
    if (turn.status === 'queued' && turn.runtimeTurnId === null) {
      await tx.projectAgentTurn.update({
        where: { id: turn.id },
        data: {
          status: 'cancelled',
          cancelRequestId: input.requestId,
          cancelReason: input.reason,
          stopReason: 'cancelled_before_start',
          finishedAt: new Date(),
        },
      })
      return { runtimeTurnId: null, terminal: true }
    }
    await tx.projectAgentTurn.update({
      where: { id: turn.id },
      data: {
        cancelRequestId: input.requestId,
        cancelReason: input.reason,
      },
    })
    return { runtimeTurnId: turn.runtimeTurnId, terminal: false }
  })
}

export async function claimAssistantRuntimeThreadClear(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly requestId: string
}): Promise<'claimed' | 'replayed'> {
  requireIdentity(input.requestId, 'ASSISTANT_RUNTIME_CLEAR_REQUEST_ID_INVALID', 128)
  return await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const archived = await tx.projectAssistantThreadArchive.findUnique({
      where: { threadId: input.threadId },
    })
    if (archived) {
      if (
        archived.projectId !== input.scope.projectId
        || archived.userId !== input.scope.userId
        || archived.assistantId !== 'workspace-command'
        || archived.clearRequestId !== input.requestId
      ) {
        throw new Error('ASSISTANT_RUNTIME_CLEAR_REPLAY_DIVERGED')
      }
      return 'replayed'
    }
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId && thread.clearRequestId !== input.requestId) {
      throw new Error('ASSISTANT_RUNTIME_CLEAR_REQUEST_DIVERGED')
    }
    if (!thread.clearRequestId) {
      await tx.projectAssistantThread.update({
        where: { id: thread.id },
        data: { clearRequestId: input.requestId },
      })
    }
    return 'claimed'
  })
}

export async function clearAssistantRuntimeThread(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly requestId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const archived = await tx.projectAssistantThreadArchive.findUnique({
      where: { threadId: input.threadId },
    })
    if (archived) {
      if (
        archived.projectId !== input.scope.projectId
        || archived.userId !== input.scope.userId
        || archived.assistantId !== 'workspace-command'
        || archived.clearRequestId !== input.requestId
      ) {
        throw new Error('ASSISTANT_RUNTIME_CLEAR_REPLAY_DIVERGED')
      }
      return
    }
    const thread = await lockThread(tx, input.scope, input.threadId)
    if (thread.clearRequestId !== input.requestId) {
      throw new Error('ASSISTANT_RUNTIME_CLEAR_NOT_CLAIMED')
    }
    const messages = await parseMessages(thread.messagesJson)
    const activeTurns = await tx.projectAgentTurn.findMany({
      where: { threadId: thread.id, status: { in: [...ACTIVE_TURN_STATUSES] } },
      select: { id: true },
    })
    await tx.projectAssistantThreadArchive.upsert({
      where: { threadId: thread.id },
      update: {},
      create: {
        threadId: thread.id,
        projectId: thread.projectId,
        userId: thread.userId,
        assistantId: thread.assistantId,
        runtimeThreadId: thread.runtimeThreadId,
        messagesJson: serializeMessages(messages),
        clearRequestId: input.requestId,
        cancelledTurnIds: toJson(activeTurns.map((turn) => turn.id)),
        threadCreatedAt: thread.createdAt,
        threadUpdatedAt: thread.updatedAt,
      },
    })
    await tx.agentTurnInteraction.updateMany({
      where: { turn: { threadId: thread.id }, status: { in: ['pending', 'decided'] } },
      data: { status: 'cancelled', resolvedAt: new Date() },
    })
    await tx.projectAgentTurn.updateMany({
      where: { threadId: thread.id, status: { in: [...ACTIVE_TURN_STATUSES] } },
      data: {
        status: 'cancelled',
        stopReason: 'thread_cleared',
        finishedAt: new Date(),
      },
    })
    await tx.followUpBatch.updateMany({
      where: { threadId: thread.id, status: { in: ['pending', 'ready'] } },
      data: { status: 'cancelled', cancelledAt: new Date() },
    })
    await tx.projectAssistantThread.delete({ where: { id: thread.id } })
  })
}

export async function markAssistantRuntimeProjectTurnsInterrupted(input: {
  readonly scope: Pick<AssistantRuntimeScope, 'projectId' | 'userId'>
  readonly runtimeThreadId: string | null
  readonly runtimeTurnId: string | null
  readonly reason: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockProjectScope(tx, input.scope)
    const turns = await tx.projectAgentTurn.findMany({
      where: {
        projectId: input.scope.projectId,
        userId: input.scope.userId,
        // queued has not crossed the app-server handoff boundary and is safe
        // to resume. Only a claimed/bound Runtime Turn is orphaned here.
        status: { in: ['running', 'waiting_approval'] },
        ...(input.runtimeTurnId ? { runtimeTurnId: input.runtimeTurnId } : {}),
        ...(input.runtimeThreadId ? { thread: { runtimeThreadId: input.runtimeThreadId } } : {}),
      },
      select: {
        id: true,
        sourceKind: true,
        sourceId: true,
        runtimeTurnId: true,
      },
    })
    if (turns.length === 0) return
    const unboundFollowUps = turns.filter((turn) => (
      turn.sourceKind === 'task_follow_up' && turn.runtimeTurnId === null
    ))
    for (const turn of unboundFollowUps) {
      const restored = await tx.followUpBatch.updateMany({
        where: {
          id: turn.sourceId,
          status: 'notified',
          notifiedTurnId: turn.id,
        },
        data: {
          status: 'ready',
          notifiedTurnId: null,
          notifiedAt: null,
        },
      })
      if (restored.count !== 1) {
        throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_RECONCILE_DIVERGED:${turn.sourceId}`)
      }
      await tx.projectAgentTurn.delete({ where: { id: turn.id } })
    }
    const interrupted = turns.filter((turn) => !unboundFollowUps.includes(turn))
    if (interrupted.length === 0) return
    const ids = interrupted.map((turn) => turn.id)
    for (const turn of interrupted.filter((candidate) => (
      candidate.sourceKind === 'user' && candidate.runtimeTurnId === null
    ))) {
      const fenced = await tx.projectAssistantMessageCommand.updateMany({
        where: {
          projectId: input.scope.projectId,
          userId: input.scope.userId,
          assistantId: 'workspace-command',
          sourceId: turn.sourceId,
          kind: 'turn',
          status: 'accepted',
          turnId: turn.id,
          runtimeTurnId: null,
        },
        data: { status: 'uncertain' },
      })
      if (fenced.count !== 1) {
        throw new Error('ASSISTANT_RUNTIME_START_HANDOFF_COMMAND_DIVERGED')
      }
    }
    await tx.agentTurnInteraction.updateMany({
      where: { turnId: { in: ids }, status: { in: ['pending', 'decided'] } },
      data: { status: 'cancelled', resolvedAt: new Date() },
    })
    await tx.projectAgentTurn.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'interrupted',
        stopReason: input.reason,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      },
    })
  })
}

function parseFollowUpContext(value: unknown): AssistantRuntimeTaskFollowUp['context'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ASSISTANT_RUNTIME_FOLLOW_UP_CONTEXT_INVALID')
  }
  const record = value as Record<string, unknown>
  const locale = typeof record.locale === 'string' ? record.locale.trim() : ''
  if (!locale) throw new Error('ASSISTANT_RUNTIME_FOLLOW_UP_LOCALE_MISSING')
  const nullable = (key: string): string | null => {
    const candidate = record[key]
    if (candidate === null || candidate === undefined) return null
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_CONTEXT_FIELD_INVALID:${key}`)
    }
    return candidate.trim()
  }
  return {
    locale,
    selectedScopeRef: nullable('selectedScopeRef'),
    selectedAssetId: nullable('selectedAssetId'),
  }
}

type FollowUpBatchWithTasks = Prisma.FollowUpBatchGetPayload<{
  include: {
    members: {
      include: {
        task: {
          select: {
            id: true
            type: true
            status: true
            targetType: true
            targetId: true
            result: true
            errorCode: true
          }
        }
      }
    }
  }
}>

function buildFollowUpContent(batch: FollowUpBatchWithTasks): string {
  if (batch.members.some((member) => member.status === 'pending')) {
    throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_MEMBERS_PENDING:${batch.id}`)
  }
  const facts = [...batch.members]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((member) => ({
      taskId: member.task.id,
      taskType: member.task.type,
      status: member.task.status,
      targetType: member.task.targetType,
      targetId: member.task.targetId,
      result: member.task.result,
      failure: member.task.status === 'failed'
        ? projectErrorForModel(member.task.errorCode)
        : null,
    }))
  const content = [
    '[task_follow_up]',
    `batchId=${batch.id}`,
    `originTurnId=${batch.originTurnId}`,
    `toolCallId=${batch.callId}`,
    `operationId=${batch.operationId}`,
    `tasks=${JSON.stringify(facts)}`,
    'A failed task never authorizes automatic resubmission or new billing. Explain the structured failure and wait for explicit user direction.',
    '[/task_follow_up]',
  ].join('\n')
  if (Buffer.byteLength(content, 'utf8') > FOLLOW_UP_INPUT_MAX_BYTES) {
    throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_INPUT_TOO_LARGE:${batch.id}`)
  }
  return content
}

function toTaskFollowUp(batch: FollowUpBatchWithTasks): AssistantRuntimeTaskFollowUp {
  const context = parseFollowUpContext(batch.contextJson)
  return {
    projectId: batch.projectId,
    userId: batch.userId,
    assistantId: 'workspace-command',
    batchId: batch.id,
    threadId: batch.threadId,
    requestId: `task-follow-up:${batch.id}`,
    context,
    inputs: [{ type: 'text', text: buildFollowUpContent(batch) }],
  }
}

async function readFollowUpBatch(batchId: string): Promise<FollowUpBatchWithTasks> {
  requireIdentity(batchId, 'ASSISTANT_RUNTIME_FOLLOW_UP_BATCH_ID_INVALID')
  const batch = await prisma.followUpBatch.findUnique({
    where: { id: batchId },
    include: {
      members: {
        include: {
          task: {
            select: {
              id: true,
              type: true,
              status: true,
              targetType: true,
              targetId: true,
              result: true,
              errorCode: true,
            },
          },
        },
      },
    },
  })
  if (!batch) throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_NOT_FOUND:${batchId}`)
  if (batch.assistantId !== 'workspace-command') {
    throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_ASSISTANT_INVALID:${batchId}`)
  }
  return batch
}

export async function loadAssistantRuntimeTaskFollowUp(
  batchId: string,
): Promise<
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'notified'; readonly turnId: string; readonly followUp: AssistantRuntimeTaskFollowUp }
  | { readonly kind: 'ready'; readonly followUp: AssistantRuntimeTaskFollowUp }
> {
  const batch = await readFollowUpBatch(batchId)
  if (batch.status === 'cancelled') return { kind: 'cancelled' }
  const followUp = toTaskFollowUp(batch)
  if (batch.status === 'notified' && batch.notifiedTurnId) {
    return { kind: 'notified', turnId: batch.notifiedTurnId, followUp }
  }
  if (batch.status !== 'ready') {
    throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_NOT_READY:${batch.id}:${batch.status}`)
  }
  return { kind: 'ready', followUp }
}

export async function admitAssistantRuntimeTaskFollowUp(input: {
  readonly batchId: string
  readonly expected: AssistantRuntimeTaskFollowUp
}): Promise<AdmissionView & { readonly followUp: AssistantRuntimeTaskFollowUp }> {
  const batchId = requireIdentity(input.batchId, 'ASSISTANT_RUNTIME_FOLLOW_UP_BATCH_ID_INVALID')
  return await prisma.$transaction(async (tx) => {
    const seed = await tx.followUpBatch.findUnique({ where: { id: batchId } })
    if (!seed) throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_NOT_FOUND:${batchId}`)
    const scope: AssistantRuntimeScope = {
      projectId: seed.projectId,
      userId: seed.userId,
    }
    await lockProjectScope(tx, scope)
    const batch = await tx.followUpBatch.findUnique({
      where: { id: batchId },
      include: {
        members: {
          include: {
            task: {
              select: {
                id: true,
                type: true,
                status: true,
                targetType: true,
                targetId: true,
                result: true,
                errorCode: true,
              },
            },
          },
        },
      },
    })
    if (!batch || batch.status === 'cancelled') {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_CANCELLED:${batchId}`)
    }
    const followUp = toTaskFollowUp(batch)
    if (!isDeepStrictEqual(followUp, input.expected)) {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_PREFLIGHT_DIVERGED:${batchId}`)
    }
    const thread = await lockThread(tx, scope, batch.threadId)
    if (thread.clearRequestId) {
      throw new Error('ASSISTANT_RUNTIME_CLEAR_IN_PROGRESS')
    }
    const turnId = buildTurnId(thread.id, batch.id)
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(canonicalize(followUp)), 'utf8')
      .digest('hex')
    const existing = await tx.projectAgentTurn.findUnique({
      where: {
        threadId_sourceKind_sourceId: {
          threadId: thread.id,
          sourceKind: 'task_follow_up',
          sourceId: batch.id,
        },
      },
    })
    if (existing) {
      if (
        existing.id !== turnId
        || existing.payloadHash !== payloadHash
        || batch.status !== 'notified'
        || batch.notifiedTurnId !== existing.id
      ) {
        throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_REPLAY_DIVERGED:${batch.id}`)
      }
      return {
        replayed: true,
        thread: threadView(thread, await parseMessages(thread.messagesJson)),
        turn: { ...turnIdentity(existing), runtimeThreadId: thread.runtimeThreadId },
        followUp,
      }
    }
    if (batch.status !== 'ready' || batch.notifiedTurnId !== null) {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_NOT_READY:${batch.id}:${batch.status}`)
    }
    const active = await tx.projectAgentTurn.findFirst({
      where: {
        projectId: batch.projectId,
        userId: batch.userId,
        status: { in: [...ACTIVE_TURN_STATUSES] },
      },
      select: { id: true },
    })
    if (active) throw new AssistantRuntimeProjectBusyError()
    const created = await tx.projectAgentTurn.create({
      data: {
        id: turnId,
        threadId: thread.id,
        projectId: batch.projectId,
        userId: batch.userId,
        sourceKind: 'task_follow_up',
        sourceId: batch.id,
        payloadHash,
        requestId: followUp.requestId,
        status: 'queued',
        attempt: 0,
        userMessageJson: Prisma.JsonNull,
        contextJson: toJson(followUp.context),
      },
    })
    const notified = await tx.followUpBatch.updateMany({
      where: { id: batch.id, status: 'ready', notifiedTurnId: null },
      data: {
        status: 'notified',
        notifiedTurnId: created.id,
        notifiedAt: new Date(),
      },
    })
    if (notified.count !== 1) {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_NOTIFY_CAS_FAILED:${batch.id}`)
    }
    return {
      replayed: false,
      thread: threadView(thread, await parseMessages(thread.messagesJson)),
      turn: { ...turnIdentity(created), runtimeThreadId: thread.runtimeThreadId },
      followUp,
    }
  })
}

export async function rollbackAssistantRuntimeTaskFollowUpPreparation(input: {
  readonly batchId: string
  readonly turnId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const batch = await tx.followUpBatch.findUnique({ where: { id: input.batchId } })
    const turn = await tx.projectAgentTurn.findUnique({ where: { id: input.turnId } })
    if (
      !batch
      || !turn
      || batch.status !== 'notified'
      || batch.notifiedTurnId !== turn.id
      || turn.sourceKind !== 'task_follow_up'
      || turn.sourceId !== batch.id
      || turn.status !== 'queued'
      || turn.runtimeTurnId !== null
    ) {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_PREPARATION_ROLLBACK_DIVERGED:${input.batchId}`)
    }
    await tx.projectAgentTurn.delete({ where: { id: turn.id } })
    const restored = await tx.followUpBatch.updateMany({
      where: { id: batch.id, status: 'notified', notifiedTurnId: turn.id },
      data: {
        status: 'ready',
        notifiedTurnId: null,
        notifiedAt: null,
      },
    })
    if (restored.count !== 1) {
      throw new Error(`ASSISTANT_RUNTIME_FOLLOW_UP_PREPARATION_ROLLBACK_CAS_FAILED:${input.batchId}`)
    }
  })
}
