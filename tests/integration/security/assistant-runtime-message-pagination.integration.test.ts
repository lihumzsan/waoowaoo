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

const SEEDED_MESSAGE_COUNT = 72
const SEEDED_TEXT_BYTES = 70 * 1_024

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
    expect(session.thread?.messages).toHaveLength(50)
    expect(session.thread?.messages[0]?.id).toBe('seeded-message-024')
    expect(session.thread?.messages.at(-1)?.id).toBe(nextMessage.id)
    expect(session.thread?.messagePage).toEqual({
      hasMore: true,
      before: '24',
    })

    const older = await readAssistantRuntimeMessagePage({
      scope,
      threadId: thread.threadId,
      before: session.thread?.messagePage.before ?? null,
      limit: 50,
    })
    expect(older.messages).toHaveLength(23)
    expect(older.messages[0]?.id).toBe('seeded-message-001')
    expect(older.messages.at(-1)?.id).toBe('seeded-message-023')
    expect(older.messagePage).toEqual({ hasMore: false, before: null })

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
})
