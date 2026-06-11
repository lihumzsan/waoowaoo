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

interface SaveProjectAssistantThreadInput extends ProjectAssistantThreadIdentity {
  messages: unknown
}

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

export async function saveProjectAssistantThread(
  input: SaveProjectAssistantThreadInput,
): Promise<ProjectAssistantThreadSnapshot> {
  const messages = await validateMessages(input.messages)
  const record = await prisma.projectAssistantThread.upsert({
    where: {
      projectId_userId_assistantId_scopeRef: {
        projectId: input.projectId,
        userId: input.userId,
        assistantId: input.assistantId,
        scopeRef: buildProjectAssistantScopeRef(input),
      },
    },
    update: {
      episodeId: input.episodeId || null,
      messagesJson: serializeMessages(messages),
    },
    create: {
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId || null,
      assistantId: input.assistantId,
      scopeRef: buildProjectAssistantScopeRef(input),
      messagesJson: serializeMessages(messages),
    },
  })

  return toThreadSnapshot(record, messages)
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
