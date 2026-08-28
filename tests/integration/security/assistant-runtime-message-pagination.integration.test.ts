import { beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { Prisma } from '@prisma/client'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import {
  admitAssistantRuntimeTurn,
  claimAssistantRuntimeThreadClear,
  clearAssistantRuntimeThread,
  getOrCreateAssistantRuntimeThread,
  hashAssistantRuntimeSubmitCommand,
} from '@/lib/assistant-runtime/persistence'
import { readAssistantRuntimeMessagePage } from '@/lib/assistant-runtime/message-store'
import { getAssistantRuntimeSessionView } from '@/lib/assistant-runtime/session-view'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

const SEEDED_MESSAGE_COUNT = 60
const SEEDED_TEXT_BYTES = 110 * 1_024
const MESSAGE_PAGE_BYTE_BUDGET = 4 * 1_024 * 1_024

function seededMessage(position: number): UIMessage {
  return {
    id: `seeded-message-${String(position).padStart(3, '0')}`,
    role: position % 2 === 0 ? 'assistant' : 'user',
    parts: [{ type: 'text', text: `${String(position)}:${'x'.repeat(SEEDED_TEXT_BYTES)}` }],
  }
}

describe('Assistant Runtime normalized message persistence', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('admits beyond the former aggregate limit, pages without gaps, and archives every row', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const thread = await getOrCreateAssistantRuntimeThread(scope)
    const seeded = Array.from(
      { length: SEEDED_MESSAGE_COUNT },
      (_, index) => seededMessage(index + 1),
    )
    expect(Buffer.byteLength(JSON.stringify(seeded), 'utf8')).toBeGreaterThan(4 * 1_024 * 1_024)

    await prisma.$transaction(async (tx) => {
      await tx.projectAssistantMessage.createMany({
        data: seeded.map((message, index) => ({
          threadId: thread.threadId,
          messageId: message.id,
          position: index + 1,
          messageJson: message as unknown as Prisma.InputJsonValue,
          byteLength: Buffer.byteLength(JSON.stringify(message), 'utf8'),
        })),
      })
      await tx.projectAssistantThread.update({
        where: { id: thread.threadId },
        data: { nextMessagePosition: SEEDED_MESSAGE_COUNT + 1 },
      })
    })

    const nextMessage: UIMessage = {
      id: 'user-message-after-former-limit',
      role: 'user',
      parts: [{ type: 'text', text: 'This must still be admitted.' }],
    }
    const command = {
      ...scope,
      requestId: 'request-after-former-limit',
      sourceId: nextMessage.id,
      message: nextMessage,
      context: {
        locale: 'zh',
        selectedScopeRef: null,
        selectedAssetId: null,
        selectedResource: null,
      },
    }
    const admission = await admitAssistantRuntimeTurn({
      command,
      threadId: thread.threadId,
      clientPayloadHash: hashAssistantRuntimeSubmitCommand(command),
    })
    expect(admission.replayed).toBe(false)

    const session = await getAssistantRuntimeSessionView(scope)
    expect(session.protocol).toBe('assistant_runtime_session_view_v2')
    const latestMessages = session.thread?.messages ?? []
    expect(Buffer.byteLength(JSON.stringify(latestMessages), 'utf8'))
      .toBeLessThanOrEqual(MESSAGE_PAGE_BYTE_BUDGET)
    expect(latestMessages.at(-1)?.id).toBe(nextMessage.id)
    expect(session.thread?.messagePage.hasMore).toBe(true)
    expect(session.thread?.messagePage.before).not.toBeNull()

    const older = await readAssistantRuntimeMessagePage({
      scope,
      threadId: thread.threadId,
      before: session.thread?.messagePage.before ?? null,
      limit: 100,
    })
    expect(Buffer.byteLength(JSON.stringify(older.messages), 'utf8'))
      .toBeLessThanOrEqual(MESSAGE_PAGE_BYTE_BUDGET)
    expect(older.messages[0]?.id).toBe('seeded-message-001')
    expect(older.messagePage).toEqual({ hasMore: false, before: null })
    expect([...older.messages, ...latestMessages].map((message) => message.id)).toEqual([
      ...seeded.map((message) => message.id),
      nextMessage.id,
    ])

    const clear = {
      scope,
      threadId: thread.threadId,
      requestId: 'clear-normalized-message-thread',
    }
    await expect(claimAssistantRuntimeThreadClear(clear)).resolves.toBe('claimed')
    await clearAssistantRuntimeThread(clear)

    await expect(prisma.projectAssistantMessage.count({
      where: { threadId: thread.threadId },
    })).resolves.toBe(0)
    const archive = await prisma.projectAssistantThreadArchive.findUniqueOrThrow({
      where: { threadId: thread.threadId },
    })
    const archivedMessages = await prisma.projectAssistantMessageArchive.findMany({
      where: { archiveId: archive.id },
      orderBy: { position: 'asc' },
    })
    expect(archivedMessages).toHaveLength(SEEDED_MESSAGE_COUNT + 1)
    expect(archivedMessages[0]?.messageId).toBe('seeded-message-001')
    expect(archivedMessages.at(-1)?.messageId).toBe(nextMessage.id)
  })

  it('enforces the independent 100-message page cap', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const thread = await getOrCreateAssistantRuntimeThread(scope)
    const messages = Array.from({ length: 101 }, (_, index): UIMessage => ({
      id: `small-message-${String(index + 1).padStart(3, '0')}`,
      role: 'user',
      parts: [{ type: 'text', text: `message ${String(index + 1)}` }],
    }))
    await prisma.$transaction(async (tx) => {
      await tx.projectAssistantMessage.createMany({
        data: messages.map((message, index) => ({
          threadId: thread.threadId,
          messageId: message.id,
          position: index + 1,
          messageJson: message as unknown as Prisma.InputJsonValue,
          byteLength: Buffer.byteLength(JSON.stringify(message), 'utf8'),
        })),
      })
      await tx.projectAssistantThread.update({
        where: { id: thread.threadId },
        data: { nextMessagePosition: messages.length + 1 },
      })
    })

    const latest = await readAssistantRuntimeMessagePage({
      scope,
      threadId: thread.threadId,
      before: null,
      limit: 100,
    })
    expect(latest.messages).toHaveLength(100)
    expect(latest.messages[0]?.id).toBe('small-message-002')
    expect(latest.messages.at(-1)?.id).toBe('small-message-101')
    expect(latest.messagePage.hasMore).toBe(true)
    expect(latest.messagePage.before).not.toBeNull()

    const oldest = await readAssistantRuntimeMessagePage({
      scope,
      threadId: thread.threadId,
      before: latest.messagePage.before,
      limit: 100,
    })
    expect(oldest.messages.map((message) => message.id)).toEqual(['small-message-001'])
    expect(oldest.messagePage).toEqual({ hasMore: false, before: null })
  })
})
