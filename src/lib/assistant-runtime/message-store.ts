import { isDeepStrictEqual } from 'node:util'
import {
  Prisma,
  type ProjectAssistantMessage,
  type ProjectAssistantThread,
} from '@prisma/client'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import { prisma } from '@/lib/prisma'
import type { AssistantRuntimeScope } from './contracts'
import {
  AssistantRuntimeMessageTooLargeError,
  parseAssistantRuntimeMessage,
  serializeAssistantRuntimeMessage,
} from './message-serialization'

const DEFAULT_MESSAGE_PAGE_SIZE = 50
const MAX_MESSAGE_PAGE_SIZE = 100
const MAX_MESSAGE_PAGE_BYTES = 4 * 1_024 * 1_024

type TransactionClient = Prisma.TransactionClient

export type AssistantRuntimeMessagePage = {
  readonly threadId: string
  readonly messages: readonly UIMessage[]
  readonly messagePage: {
    readonly hasMore: boolean
    readonly before: string | null
  }
}

function requireMessageId(value: string): string {
  if (!value || value !== value.trim() || value.length > 191) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_ID_INVALID')
  }
  return value
}

export { AssistantRuntimeMessageTooLargeError, parseAssistantRuntimeMessage }

async function parseRows(rows: readonly ProjectAssistantMessage[]): Promise<UIMessage[]> {
  if (rows.length === 0) return []
  const validation = await safeValidateUIMessages({
    messages: rows.map((row) => row.messageJson),
  })
  if (!validation.success || validation.data.length !== rows.length) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGES_INVALID')
  }
  const ids = new Set<string>()
  for (let index = 0; index < validation.data.length; index += 1) {
    const message = validation.data[index]
    const row = rows[index]
    if (!message || !row || message.id !== row.messageId) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_ID_DIVERGED')
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_ROLE_INVALID')
    }
    const serialized = JSON.stringify(row.messageJson)
    if (!serialized || Buffer.byteLength(serialized, 'utf8') !== row.byteLength) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_BYTE_LENGTH_DIVERGED')
    }
    requireMessageId(message.id)
    if (ids.has(message.id)) throw new Error('ASSISTANT_RUNTIME_MESSAGE_ID_DUPLICATE')
    ids.add(message.id)
  }
  return validation.data
}

function parseBeforeCursor(value: string | null): number | null {
  if (value === null) return null
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_CURSOR_INVALID')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_CURSOR_INVALID')
  }
  return parsed
}

function parsePageLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MESSAGE_PAGE_SIZE) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_PAGE_LIMIT_INVALID')
  }
  return value
}

async function readPageRows(
  tx: TransactionClient,
  input: {
    readonly threadId: string
    readonly before: string | null
    readonly limit: number
  },
): Promise<AssistantRuntimeMessagePage> {
  const before = parseBeforeCursor(input.before)
  const limit = parsePageLimit(input.limit)
  const metadataRows = await tx.projectAssistantMessage.findMany({
    where: {
      threadId: input.threadId,
      ...(before === null ? {} : { position: { lt: before } }),
    },
    orderBy: { position: 'desc' },
    take: limit + 1,
    select: { position: true, byteLength: true },
  })
  const selectedMetadata: typeof metadataRows = []
  let selectedBytes = 0
  for (const row of metadataRows.slice(0, limit)) {
    if (!Number.isSafeInteger(row.byteLength) || row.byteLength <= 0) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_BYTE_LENGTH_INVALID')
    }
    if (selectedBytes + row.byteLength > MAX_MESSAGE_PAGE_BYTES) break
    selectedMetadata.push(row)
    selectedBytes += row.byteLength
  }
  if (metadataRows.length > 0 && selectedMetadata.length === 0) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_PAGE_BYTE_BUDGET_EXHAUSTED')
  }
  const hasMore = metadataRows.length > selectedMetadata.length
  const selectedRows = selectedMetadata.length === 0
    ? []
    : await tx.projectAssistantMessage.findMany({
        where: {
          threadId: input.threadId,
          position: { in: selectedMetadata.map((row) => row.position) },
        },
        orderBy: { position: 'asc' },
      })
  if (selectedRows.length !== selectedMetadata.length) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_PAGE_CHANGED')
  }
  const messages = await parseRows(selectedRows)
  return {
    threadId: input.threadId,
    messages,
    messagePage: {
      hasMore,
      before: hasMore ? String(selectedMetadata.at(-1)?.position) : null,
    },
  }
}

export async function readLatestAssistantRuntimeMessagePage(
  tx: TransactionClient,
  threadId: string,
): Promise<AssistantRuntimeMessagePage> {
  return await readPageRows(tx, {
    threadId,
    before: null,
    limit: DEFAULT_MESSAGE_PAGE_SIZE,
  })
}

export async function readAssistantRuntimeMessagePage(input: {
  readonly scope: AssistantRuntimeScope
  readonly threadId: string
  readonly before: string | null
  readonly limit?: number
}): Promise<AssistantRuntimeMessagePage> {
  return await prisma.$transaction(async (tx) => {
    const thread = await tx.projectAssistantThread.findUnique({
      where: { id: input.threadId },
      select: { projectId: true, userId: true, assistantId: true },
    })
    if (
      !thread
      || thread.projectId !== input.scope.projectId
      || thread.userId !== input.scope.userId
      || thread.assistantId !== 'workspace-command'
    ) {
      throw new Error('ASSISTANT_RUNTIME_THREAD_SCOPE_DIVERGED')
    }
    return await readPageRows(tx, {
      threadId: input.threadId,
      before: input.before,
      limit: input.limit ?? DEFAULT_MESSAGE_PAGE_SIZE,
    })
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 30_000,
  })
}

async function readExistingMessage(
  tx: TransactionClient,
  threadId: string,
  messageId: string,
): Promise<ProjectAssistantMessage | null> {
  return await tx.projectAssistantMessage.findUnique({
    where: { threadId_messageId: { threadId, messageId } },
  })
}

export async function appendAssistantRuntimeMessage(
  tx: TransactionClient,
  input: {
    readonly thread: ProjectAssistantThread
    readonly message: UIMessage
    readonly afterMessageId?: string | null
  },
): Promise<ProjectAssistantThread> {
  const serializedMessage = await serializeAssistantRuntimeMessage(input.message)
  const message = serializedMessage.message
  const messageJson = serializedMessage.json as Prisma.InputJsonValue
  const existing = await readExistingMessage(tx, input.thread.id, message.id)
  if (existing) {
    if (
      !isDeepStrictEqual(existing.messageJson, messageJson)
      || existing.byteLength !== serializedMessage.byteLength
    ) {
      throw new Error(`ASSISTANT_RUNTIME_MESSAGE_ID_CONFLICT:${message.id}`)
    }
    return input.thread
  }
  const tail = await tx.projectAssistantMessage.findFirst({
    where: { threadId: input.thread.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  if (input.thread.nextMessagePosition !== (tail?.position ?? 0) + 1) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_POSITION_DIVERGED')
  }
  if (input.afterMessageId) {
    requireMessageId(input.afterMessageId)
    const boundary = await readExistingMessage(tx, input.thread.id, input.afterMessageId)
    if (!boundary) throw new Error('ASSISTANT_RUNTIME_STEER_BOUNDARY_MISSING')
    if (boundary.position !== input.thread.nextMessagePosition - 1) {
      throw new Error('ASSISTANT_RUNTIME_STEER_BOUNDARY_NOT_TAIL')
    }
  }
  await tx.projectAssistantMessage.create({
    data: {
      threadId: input.thread.id,
      messageId: message.id,
      position: input.thread.nextMessagePosition,
      messageJson,
      byteLength: serializedMessage.byteLength,
    },
  })
  return await tx.projectAssistantThread.update({
    where: { id: input.thread.id },
    data: { nextMessagePosition: { increment: 1 } },
  })
}

export async function upsertAssistantRuntimeMessage(
  tx: TransactionClient,
  input: {
    readonly thread: ProjectAssistantThread
    readonly message: UIMessage
  },
): Promise<ProjectAssistantThread> {
  const serializedMessage = await serializeAssistantRuntimeMessage(input.message)
  const message = serializedMessage.message
  if (message.role !== 'assistant') {
    throw new Error('ASSISTANT_RUNTIME_ASSISTANT_MESSAGE_REQUIRED')
  }
  const messageJson = serializedMessage.json as Prisma.InputJsonValue
  const existing = await readExistingMessage(tx, input.thread.id, message.id)
  if (!existing) {
    return await appendAssistantRuntimeMessage(tx, { thread: input.thread, message })
  }
  const prior = await parseAssistantRuntimeMessage(existing.messageJson)
  if (prior.role !== 'assistant') {
    throw new Error(`ASSISTANT_RUNTIME_MESSAGE_ID_CONFLICT:${message.id}`)
  }
  if (isDeepStrictEqual(existing.messageJson, messageJson)) {
    if (existing.byteLength !== serializedMessage.byteLength) {
      throw new Error('ASSISTANT_RUNTIME_MESSAGE_BYTE_LENGTH_DIVERGED')
    }
    return input.thread
  }
  await tx.projectAssistantMessage.update({
    where: {
      threadId_messageId: {
        threadId: input.thread.id,
        messageId: message.id,
      },
    },
    data: {
      messageJson,
      byteLength: serializedMessage.byteLength,
      revision: { increment: 1 },
    },
  })
  return await tx.projectAssistantThread.update({
    where: { id: input.thread.id },
    data: { updatedAt: new Date() },
  })
}

export async function archiveAssistantRuntimeMessages(
  tx: TransactionClient,
  input: {
    readonly threadId: string
    readonly archiveId: string
  },
): Promise<void> {
  const sourceCount = await tx.projectAssistantMessage.count({
    where: { threadId: input.threadId },
  })
  const copied = await tx.$executeRaw(Prisma.sql`
    INSERT INTO project_assistant_message_archives (
      archiveId,
      messageId,
      position,
      messageJson,
      byteLength,
      revision,
      createdAt,
      updatedAt
    )
    SELECT
      ${input.archiveId},
      messageId,
      position,
      messageJson,
      byteLength,
      revision,
      createdAt,
      updatedAt
    FROM project_assistant_messages
    WHERE threadId = ${input.threadId}
  `)
  if (copied !== sourceCount) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_ARCHIVE_INCOMPLETE')
  }
}
