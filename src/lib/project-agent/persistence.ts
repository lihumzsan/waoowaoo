import { Prisma, type ProjectAssistantThread } from '@prisma/client'
import { protocol, type AgentInputItem } from '@openai/agents'
import { isDeepStrictEqual } from 'node:util'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import { ensureUniqueUIMessages } from './ui-message-validation'
import type { ProjectAssistantId, ProjectAssistantThreadSnapshot } from './types'

interface ProjectAssistantThreadScopeInput {
  projectId: string
  episodeId?: string | null
}

export interface ProjectAssistantThreadIdentity extends ProjectAssistantThreadScopeInput {
  userId: string
  assistantId: ProjectAssistantId
}

export interface ProjectAssistantModelHistoryCommit {
  executionSegmentId: string
  expectedVersion: number
  items: readonly AgentInputItem[]
}

export interface ProjectAssistantModelHistorySnapshot {
  version: number
  items: AgentInputItem[]
  pending: {
    executionSegmentId: string
    baseVersion: number
    ready: boolean
    items: AgentInputItem[]
  } | null
}

interface AppendProjectAssistantThreadMessagesInput extends ProjectAssistantThreadIdentity {
  messages: unknown
  modelHistoryCommit?: ProjectAssistantModelHistoryCommit
}

interface ReplaceProjectAssistantThreadPlanInput extends ProjectAssistantThreadIdentity {
  planJson: Prisma.InputJsonValue | typeof Prisma.DbNull
}

type ProjectAssistantThreadTransactionClient = Prisma.TransactionClient

function buildProjectAssistantScopeRef(input: ProjectAssistantThreadScopeInput): string {
  return input.episodeId ? `episode:${input.episodeId}` : `project:${input.projectId}`
}

function serializeMessages(messages: UIMessage[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(ensureUniqueUIMessages(messages))) as Prisma.InputJsonValue
}

function validateModelHistoryItem(value: unknown): AgentInputItem {
  const parsed = protocol.ModelItem.safeParse(value)
  if (!parsed.success) {
    throw new Error('PROJECT_ASSISTANT_MODEL_HISTORY_ITEM_INVALID')
  }
  return structuredClone(value) as AgentInputItem
}

function parseModelHistory(value: unknown): AgentInputItem[] {
  if (!Array.isArray(value)) throw new Error('PROJECT_ASSISTANT_MODEL_HISTORY_INVALID')
  return value.map(validateModelHistoryItem)
}

function serializeModelHistory(items: readonly AgentInputItem[]): Prisma.InputJsonValue {
  const serialized = JSON.parse(JSON.stringify(items)) as unknown
  return parseModelHistory(serialized) as unknown as Prisma.InputJsonValue
}

async function validateMessages(messages: unknown): Promise<UIMessage[]> {
  const validation = await safeValidateUIMessages({ messages })
  if (!validation.success) {
    throw new Error('PROJECT_ASSISTANT_INVALID_THREAD_MESSAGES')
  }
  return ensureUniqueUIMessages(validation.data)
}

function toThreadSnapshot(record: ProjectAssistantThread, messages: UIMessage[]): ProjectAssistantThreadSnapshot {
  return {
    id: record.id,
    assistantId: record.assistantId as ProjectAssistantId,
    projectId: record.projectId,
    episodeId: record.episodeId,
    scopeRef: record.scopeRef,
    messages,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function mergeAppendMessages(existing: UIMessage[], appended: UIMessage[]): UIMessage[] {
  const nextMessages = existing.map((message) => ({ ...message, parts: [...message.parts] }))
  const existingById = new Map(nextMessages.map((message) => [message.id, message] as const))
  const toolPartLocations = new Map<string, { messageIndex: number; partIndex: number }>()
  for (const [messageIndex, message] of nextMessages.entries()) {
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type === 'dynamic-tool' && typeof part.toolCallId === 'string') {
        toolPartLocations.set(part.toolCallId, { messageIndex, partIndex })
      }
    }
  }
  for (const appendedMessage of appended) {
    const message = { ...appendedMessage, parts: [...appendedMessage.parts] }
    message.parts = message.parts.filter((part) => {
      if (part.type !== 'dynamic-tool' || typeof part.toolCallId !== 'string') return true
      const prior = toolPartLocations.get(part.toolCallId)
      if (!prior) return true
      const priorMessage = nextMessages[prior.messageIndex]
      if (!priorMessage) throw new Error(`PROJECT_ASSISTANT_TOOL_CALL_MESSAGE_MISSING:${part.toolCallId}`)
      priorMessage.parts[prior.partIndex] = part
      return false
    })
    const persisted = existingById.get(message.id)
    if (persisted) {
      if (!isDeepStrictEqual(persisted, message)) {
        throw new Error(`PROJECT_ASSISTANT_MESSAGE_ID_CONFLICT:${message.id}`)
      }
      continue
    }
    existingById.set(message.id, message)
    const messageIndex = nextMessages.length
    nextMessages.push(message)
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type === 'dynamic-tool' && typeof part.toolCallId === 'string') {
        toolPartLocations.set(part.toolCallId, { messageIndex, partIndex })
      }
    }
  }
  return ensureUniqueUIMessages(nextMessages)
}

async function readThreadMessages(record: ProjectAssistantThread | null): Promise<UIMessage[]> {
  if (!record) return []
  if (Array.isArray(record.messagesJson) && record.messagesJson.length === 0) return []
  return await validateMessages(record.messagesJson)
}

export async function loadProjectAssistantThread(
  input: ProjectAssistantThreadIdentity,
): Promise<ProjectAssistantThreadSnapshot | null> {
  const record = await prisma.projectAssistantThread.findUnique({
    where: {
      projectId_userId_assistantId_scopeRef: {
        projectId: input.projectId,
        userId: input.userId,
        assistantId: input.assistantId,
        scopeRef: buildProjectAssistantScopeRef(input),
      },
    },
  })
  if (!record) return null

  const messages = await validateMessages(record.messagesJson)
  return toThreadSnapshot(record, messages)
}

export async function loadProjectAssistantModelHistory(
  input: ProjectAssistantThreadIdentity,
): Promise<ProjectAssistantModelHistorySnapshot> {
  const record = await prisma.projectAssistantThread.findUnique({
    where: {
      projectId_userId_assistantId_scopeRef: {
        projectId: input.projectId,
        userId: input.userId,
        assistantId: input.assistantId,
        scopeRef: buildProjectAssistantScopeRef(input),
      },
    },
    select: {
      modelHistoryJson: true,
      modelHistoryVersion: true,
      pendingModelHistoryJson: true,
      pendingModelHistorySegmentId: true,
      pendingModelHistoryBaseVersion: true,
      pendingModelHistoryReady: true,
    },
  })
  if (!record) return { version: 0, items: [], pending: null }
  const hasPendingIdentity = record.pendingModelHistorySegmentId !== null
  const hasPendingPayload = record.pendingModelHistoryJson !== null
    && record.pendingModelHistoryBaseVersion !== null
  if (hasPendingIdentity !== hasPendingPayload) {
    throw new Error('PROJECT_ASSISTANT_PENDING_MODEL_HISTORY_INCOMPLETE')
  }
  return {
    version: record.modelHistoryVersion,
    items: parseModelHistory(record.modelHistoryJson),
    pending: hasPendingIdentity && hasPendingPayload
      ? {
          executionSegmentId: record.pendingModelHistorySegmentId as string,
          baseVersion: record.pendingModelHistoryBaseVersion as number,
          ready: record.pendingModelHistoryReady,
          items: parseModelHistory(record.pendingModelHistoryJson),
        }
      : null,
  }
}

export async function stageProjectAssistantModelHistory(
  input: ProjectAssistantThreadIdentity & ProjectAssistantModelHistoryCommit & { ready: boolean },
): Promise<void> {
  const scopeRef = buildProjectAssistantScopeRef(input)
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_assistant_threads
      WHERE projectId = ${input.projectId}
        AND userId = ${input.userId}
        AND assistantId = ${input.assistantId}
        AND scopeRef = ${scopeRef}
      FOR UPDATE
    `)
    if (locked.length !== 1) {
      throw new Error(`PROJECT_ASSISTANT_THREAD_NOT_FOUND:${input.projectId}:${scopeRef}`)
    }
    const record = await tx.projectAssistantThread.findUnique({
      where: {
        projectId_userId_assistantId_scopeRef: {
          projectId: input.projectId,
          userId: input.userId,
          assistantId: input.assistantId,
          scopeRef,
        },
      },
      select: {
        id: true,
        modelHistoryVersion: true,
        pendingModelHistorySegmentId: true,
        pendingModelHistoryBaseVersion: true,
        pendingModelHistoryReady: true,
      },
    })
    if (!record) throw new Error(`PROJECT_ASSISTANT_THREAD_NOT_FOUND:${input.projectId}:${scopeRef}`)
    if (record.modelHistoryVersion !== input.expectedVersion) {
      throw new Error(
        `PROJECT_ASSISTANT_MODEL_HISTORY_VERSION_CONFLICT:${record.modelHistoryVersion}:${input.expectedVersion}`,
      )
    }
    if (
      record.pendingModelHistorySegmentId !== null
      && (
        record.pendingModelHistorySegmentId !== input.executionSegmentId
        || record.pendingModelHistoryBaseVersion !== input.expectedVersion
      )
    ) {
      throw new Error(
        `PROJECT_ASSISTANT_PENDING_MODEL_HISTORY_CONFLICT:${record.pendingModelHistorySegmentId}:${input.executionSegmentId}`,
      )
    }
    await tx.projectAssistantThread.update({
      where: { id: record.id },
      data: {
        pendingModelHistoryJson: serializeModelHistory(input.items),
        pendingModelHistorySegmentId: input.executionSegmentId,
        pendingModelHistoryBaseVersion: input.expectedVersion,
        pendingModelHistoryReady: record.pendingModelHistoryReady || input.ready,
      },
    })
  })
}

/**
 * Cancellation may discard only a pending segment proven to belong to the
 * cancelled Run. Committed history is immutable here, and a concurrent/newer
 * segment cannot match the explicit execution identity set.
 */
export async function discardProjectAssistantPendingModelHistoryInTransaction(
  tx: ProjectAssistantThreadTransactionClient,
  input: ProjectAssistantThreadIdentity & { executionSegmentIds: readonly string[] },
): Promise<boolean> {
  const executionSegmentIds = Array.from(new Set(
    input.executionSegmentIds.map((value) => value.trim()).filter(Boolean),
  ))
  if (executionSegmentIds.length === 0) return false
  const discarded = await tx.projectAssistantThread.updateMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef: buildProjectAssistantScopeRef(input),
      pendingModelHistorySegmentId: { in: executionSegmentIds },
    },
    data: {
      pendingModelHistoryJson: Prisma.DbNull,
      pendingModelHistorySegmentId: null,
      pendingModelHistoryBaseVersion: null,
      pendingModelHistoryReady: false,
    },
  })
  return discarded.count === 1
}

export async function appendProjectAssistantThreadMessages(
  input: AppendProjectAssistantThreadMessagesInput,
): Promise<ProjectAssistantThreadSnapshot> {
  return await prisma.$transaction(async (tx) => appendProjectAssistantThreadMessagesInTransaction(tx, input))
}

export async function appendProjectAssistantThreadMessagesInTransaction(
  tx: ProjectAssistantThreadTransactionClient,
  input: AppendProjectAssistantThreadMessagesInput,
): Promise<ProjectAssistantThreadSnapshot> {
  const appendedMessages = await validateMessages(input.messages)
  const scopeRef = buildProjectAssistantScopeRef(input)
  // The thread row does not exist on the first append, so it cannot be the
  // initial lock. Serialize first materialization on the stable parent row;
  // MySQL can otherwise reject two concurrent upserts with a unique-key race.
  const lockedProjects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM projects
    WHERE id = ${input.projectId}
    FOR UPDATE
  `)
  if (lockedProjects.length !== 1) {
    throw new Error(`PROJECT_ASSISTANT_PROJECT_LOCK_FAILED:${input.projectId}`)
  }
  await tx.projectAssistantThread.upsert({
    where: {
      projectId_userId_assistantId_scopeRef: {
        projectId: input.projectId,
        userId: input.userId,
        assistantId: input.assistantId,
        scopeRef,
      },
    },
    update: {},
    create: {
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId || null,
      assistantId: input.assistantId,
      scopeRef,
      messagesJson: serializeMessages([]),
      modelHistoryJson: serializeModelHistory([]),
    },
  })
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM project_assistant_threads
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${input.assistantId}
      AND scopeRef = ${scopeRef}
    FOR UPDATE
  `)
  if (locked.length !== 1) {
    throw new Error(`PROJECT_ASSISTANT_THREAD_LOCK_FAILED:${input.projectId}:${scopeRef}`)
  }
  const existingRecord = await tx.projectAssistantThread.findUnique({
    where: {
      projectId_userId_assistantId_scopeRef: {
        projectId: input.projectId,
        userId: input.userId,
        assistantId: input.assistantId,
        scopeRef,
      },
    },
  })
  const existingMessages = await readThreadMessages(existingRecord)
  const nextMessages = mergeAppendMessages(existingMessages, appendedMessages)
  const modelHistoryCommit = input.modelHistoryCommit
  if (
    modelHistoryCommit
    && existingRecord
    && existingRecord.modelHistoryVersion !== modelHistoryCommit.expectedVersion
  ) {
    throw new Error(
      `PROJECT_ASSISTANT_MODEL_HISTORY_VERSION_CONFLICT:${existingRecord.modelHistoryVersion}:${modelHistoryCommit.expectedVersion}`,
    )
  }
  if (modelHistoryCommit && existingRecord) {
    const serializedModelHistory = serializeModelHistory(modelHistoryCommit.items)
    if (
      existingRecord.pendingModelHistorySegmentId !== modelHistoryCommit.executionSegmentId
      || existingRecord.pendingModelHistoryBaseVersion !== modelHistoryCommit.expectedVersion
      || existingRecord.pendingModelHistoryReady !== true
      || !isDeepStrictEqual(existingRecord.pendingModelHistoryJson, serializedModelHistory)
    ) {
      throw new Error(
        `PROJECT_ASSISTANT_PENDING_MODEL_HISTORY_NOT_READY:${modelHistoryCommit.executionSegmentId}`,
      )
    }
  }
  if (existingRecord && nextMessages.length === existingMessages.length && !modelHistoryCommit) {
    return toThreadSnapshot(existingRecord, existingMessages)
  }

  if (!existingRecord) {
    throw new Error(`PROJECT_ASSISTANT_THREAD_NOT_FOUND_AFTER_LOCK:${input.projectId}:${scopeRef}`)
  }
  const record = await tx.projectAssistantThread.update({
    where: { id: existingRecord.id },
    data: {
      episodeId: input.episodeId || null,
      messagesJson: serializeMessages(nextMessages),
      ...(modelHistoryCommit
        ? {
            modelHistoryJson: serializeModelHistory(modelHistoryCommit.items),
            modelHistoryVersion: { increment: 1 },
            pendingModelHistoryJson: Prisma.DbNull,
            pendingModelHistorySegmentId: null,
            pendingModelHistoryBaseVersion: null,
            pendingModelHistoryReady: false,
          }
        : {}),
    },
  })
  return toThreadSnapshot(record, nextMessages)
}

export async function replaceProjectAssistantThreadPlanInTransaction(
  tx: ProjectAssistantThreadTransactionClient,
  input: ReplaceProjectAssistantThreadPlanInput,
): Promise<void> {
  const scopeRef = buildProjectAssistantScopeRef(input)
  const updated = await tx.projectAssistantThread.updateMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef,
    },
    data: { planJson: input.planJson },
  })
  if (updated.count !== 1) {
    throw new Error(`PROJECT_ASSISTANT_THREAD_NOT_FOUND:${input.projectId}:${scopeRef}`)
  }
}

export async function clearProjectAssistantThreadInTransaction(
  tx: ProjectAssistantThreadTransactionClient,
  input: ProjectAssistantThreadIdentity,
): Promise<void> {
  const scopeRef = buildProjectAssistantScopeRef(input)
  const lockedProjects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM projects
    WHERE id = ${input.projectId}
    FOR UPDATE
  `)
  if (lockedProjects.length !== 1) {
    throw new Error(`PROJECT_ASSISTANT_PROJECT_LOCK_FAILED:${input.projectId}`)
  }
  const blockingRun = await tx.projectAgentRun.findFirst({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef,
      status: { in: ['running', 'awaiting_approval', 'awaiting_choice', 'awaiting_task'] },
    },
    select: { id: true },
  })
  if (blockingRun) throw new Error(`PROJECT_AGENT_THREAD_ACTIVE:${blockingRun.id}`)
  const threadFilter = {
    projectId: input.projectId,
    userId: input.userId,
    assistantId: input.assistantId,
    scopeRef,
  }
  // 清空对用户是删除，对系统是归档：同一事务内先归档再删除，原文的唯一权威留在归档表。
  const threads = await tx.projectAssistantThread.findMany({
    where: threadFilter,
    select: {
      id: true,
      projectId: true,
      userId: true,
      episodeId: true,
      assistantId: true,
      scopeRef: true,
      messagesJson: true,
      modelHistoryJson: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (threads.length > 0) {
    await tx.projectAssistantThreadArchive.createMany({
      data: threads.map((thread) => ({
        threadId: thread.id,
        projectId: thread.projectId,
        userId: thread.userId,
        episodeId: thread.episodeId,
        assistantId: thread.assistantId,
        scopeRef: thread.scopeRef,
        messagesJson: thread.messagesJson as Prisma.InputJsonValue,
        modelHistoryJson: thread.modelHistoryJson as Prisma.InputJsonValue,
        threadCreatedAt: thread.createdAt,
        threadUpdatedAt: thread.updatedAt,
      })),
    })
  }
  await tx.projectAssistantThread.deleteMany({ where: threadFilter })
}

export { buildProjectAssistantScopeRef }
