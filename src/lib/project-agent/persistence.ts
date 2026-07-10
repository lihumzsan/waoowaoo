import { Prisma, type ProjectAssistantThread } from '@prisma/client'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import { ensureUniqueUIMessages } from './ui-message-validation'
import type { ProjectAssistantId, ProjectAssistantThreadSnapshot } from './types'

interface ProjectAssistantThreadScopeInput {
  projectId: string
  episodeId?: string | null
}

interface ProjectAssistantThreadIdentity extends ProjectAssistantThreadScopeInput {
  userId: string
  assistantId: ProjectAssistantId
}

interface AppendProjectAssistantThreadMessagesInput extends ProjectAssistantThreadIdentity {
  messages: unknown
}

type ProjectAssistantThreadTransactionClient = Prisma.TransactionClient

function buildProjectAssistantScopeRef(input: ProjectAssistantThreadScopeInput): string {
  return input.episodeId ? `episode:${input.episodeId}` : `project:${input.projectId}`
}

function serializeMessages(messages: UIMessage[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(ensureUniqueUIMessages(messages))) as Prisma.InputJsonValue
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
  const seenIds = new Set(existing.map((message) => message.id))
  const nextMessages = [...existing]
  for (const message of appended) {
    if (seenIds.has(message.id)) continue
    seenIds.add(message.id)
    nextMessages.push(message)
  }
  return ensureUniqueUIMessages(nextMessages)
}

async function readThreadMessages(record: ProjectAssistantThread | null): Promise<UIMessage[]> {
  if (!record) return []
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
  // Materialize the unique aggregate row before taking the lock. The no-op
  // update makes concurrent first appends serialize on the same unique key;
  // without this, two transactions can both read an absent/old JSON array and
  // the last writer silently drops the other message.
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
      messagesJson: serializeMessages(nextMessages),
    },
  })
  return toThreadSnapshot(record, nextMessages)
}

export async function clearProjectAssistantThread(input: ProjectAssistantThreadIdentity): Promise<void> {
  await prisma.projectAssistantThread.deleteMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef: buildProjectAssistantScopeRef(input),
    },
  })
}

export { buildProjectAssistantScopeRef }
