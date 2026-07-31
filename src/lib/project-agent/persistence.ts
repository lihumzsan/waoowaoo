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

interface AppendProjectAssistantThreadMessagesInput extends ProjectAssistantThreadIdentity {
  messages: unknown
}

export interface CommitProjectAssistantTurnInput
  extends ProjectAssistantThreadIdentity {
  threadId: string
  expectedModelHistoryVersion: number
  messages: unknown
  modelHistoryItems: readonly AgentInputItem[]
}

interface ReplaceProjectAssistantThreadPlanInput extends ProjectAssistantThreadIdentity {
  planJson: Prisma.InputJsonValue | typeof Prisma.DbNull
}

type ProjectAssistantThreadTransactionClient = Prisma.TransactionClient

function buildProjectAssistantScopeRef(input: ProjectAssistantThreadScopeInput): string {
  return input.episodeId ? `episode:${input.episodeId}` : `project:${input.projectId}`
}

export function serializeProjectAssistantThreadMessages(
  messages: UIMessage[],
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(ensureUniqueUIMessages(messages))) as Prisma.InputJsonValue
}

function validateModelHistoryItem(value: unknown): AgentInputItem {
  const parsed = protocol.ModelItem.safeParse(value)
  if (!parsed.success) {
    throw new Error('PROJECT_ASSISTANT_MODEL_HISTORY_ITEM_INVALID')
  }
  return structuredClone(value) as AgentInputItem
}

export function parseProjectAssistantModelHistory(
  value: unknown,
): AgentInputItem[] {
  if (!Array.isArray(value)) throw new Error('PROJECT_ASSISTANT_MODEL_HISTORY_INVALID')
  return value.map(validateModelHistoryItem)
}

export function serializeProjectAssistantModelHistory(
  items: readonly AgentInputItem[],
): Prisma.InputJsonValue {
  const serialized = JSON.parse(JSON.stringify(items)) as unknown
  return parseProjectAssistantModelHistory(serialized) as unknown as Prisma.InputJsonValue
}

export async function validateProjectAssistantThreadMessages(
  messages: unknown,
): Promise<UIMessage[]> {
  // An empty list is the canonical initial state of a materialized Thread.
  // AI SDK message validation expects at least one message, so the domain
  // owner must admit this one explicit state before delegating non-empty
  // message shape validation to the SDK.
  if (Array.isArray(messages) && messages.length === 0) return []
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
  return await validateProjectAssistantThreadMessages(record.messagesJson)
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

  const messages = await validateProjectAssistantThreadMessages(record.messagesJson)
  return toThreadSnapshot(record, messages)
}

/**
 * Materializes the canonical Thread identity before the command enters
 * Temporal. An empty Thread is the only fact allowed to precede command
 * admission; user content and AgentTurn are still committed together by the
 * Coordinator admission Activity.
 */
export async function getOrCreateProjectAssistantThread(
  input: ProjectAssistantThreadIdentity,
): Promise<ProjectAssistantThreadSnapshot> {
  return await appendProjectAssistantThreadMessages({
    ...input,
    messages: [],
  })
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
  const appendedMessages = await validateProjectAssistantThreadMessages(input.messages)
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
  if (input.episodeId) {
    const lockedEpisodes = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_episodes
      WHERE id = ${input.episodeId}
        AND projectId = ${input.projectId}
      FOR UPDATE
    `)
    if (lockedEpisodes.length !== 1) {
      throw new Error(
        `PROJECT_ASSISTANT_EPISODE_SCOPE_INVALID:${input.projectId}:${input.episodeId}`,
      )
    }
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
      messagesJson: serializeProjectAssistantThreadMessages([]),
      modelHistoryJson: serializeProjectAssistantModelHistory([]),
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
  if (existingRecord && nextMessages.length === existingMessages.length) {
    return toThreadSnapshot(existingRecord, existingMessages)
  }

  if (!existingRecord) {
    throw new Error(`PROJECT_ASSISTANT_THREAD_NOT_FOUND_AFTER_LOCK:${input.projectId}:${scopeRef}`)
  }
  const record = await tx.projectAssistantThread.update({
    where: { id: existingRecord.id },
    data: {
      episodeId: input.episodeId || null,
      messagesJson: serializeProjectAssistantThreadMessages(nextMessages),
    },
  })
  return toThreadSnapshot(record, nextMessages)
}

/**
 * B+ Turn settlement owner. A complete model transcript and its UI projection
 * become visible in one transaction. Unlike the legacy Run/Handoff path, this
 * boundary never promotes a partially staged SDK segment.
 */
export async function commitProjectAssistantTurnInTransaction(
  tx: ProjectAssistantThreadTransactionClient,
  input: CommitProjectAssistantTurnInput,
): Promise<ProjectAssistantThreadSnapshot> {
  const threadId = input.threadId.trim()
  if (!threadId) throw new Error('PROJECT_ASSISTANT_THREAD_ID_REQUIRED')
  const appendedMessages = await validateProjectAssistantThreadMessages(input.messages)
  const serializedModelHistory = serializeProjectAssistantModelHistory(
    input.modelHistoryItems,
  )
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
  const lockedThreads = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM project_assistant_threads
    WHERE id = ${threadId}
    FOR UPDATE
  `)
  if (lockedThreads.length !== 1) {
    throw new Error(`PROJECT_ASSISTANT_THREAD_NOT_FOUND:${threadId}`)
  }
  const record = await tx.projectAssistantThread.findUnique({
    where: { id: threadId },
  })
  if (
    !record
    || record.projectId !== input.projectId
    || record.userId !== input.userId
    || record.assistantId !== input.assistantId
    || record.episodeId !== (input.episodeId || null)
    || record.scopeRef !== scopeRef
  ) {
    throw new Error(`PROJECT_ASSISTANT_THREAD_SCOPE_DIVERGED:${threadId}`)
  }
  if (record.modelHistoryVersion !== input.expectedModelHistoryVersion) {
    throw new Error(
      `PROJECT_ASSISTANT_MODEL_HISTORY_VERSION_CONFLICT:${record.modelHistoryVersion}:${input.expectedModelHistoryVersion}`,
    )
  }
  const existingMessages = await readThreadMessages(record)
  const nextMessages = mergeAppendMessages(existingMessages, appendedMessages)
  const updated = await tx.projectAssistantThread.update({
    where: { id: threadId },
    data: {
      messagesJson: serializeProjectAssistantThreadMessages(nextMessages),
      modelHistoryJson: serializedModelHistory,
      modelHistoryVersion: { increment: 1 },
    },
  })
  return toThreadSnapshot(updated, nextMessages)
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

export { buildProjectAssistantScopeRef }
