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

function persistedLargeFailure(diagnostic: string): Prisma.InputJsonObject {
  return {
    version: 2,
    native: {
      name: 'Error',
      message: 'large persisted diagnostic',
      code: null,
      statusCode: null,
      requestId: null,
      metadata: { diagnostic },
      cause: null,
    },
    interpretation: { code: 'INTERNAL_ERROR', details: null },
    context: { system: 'application' },
    recovery: {
      operation: null,
      effect: 'unknown',
      taskReplay: 'forbidden',
      attempts: 1,
    },
    frames: [],
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

  it('includes JSON array framing in the message page byte budget', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const thread = await getOrCreateAssistantRuntimeThread(scope)
    const targetMessageBytes = MESSAGE_PAGE_BYTE_BUDGET / 4
    const messages = Array.from({ length: 4 }, (_, index): UIMessage => {
      const base: UIMessage = {
        id: `boundary-message-${String(index + 1)}`,
        role: 'user',
        parts: [{ type: 'text', text: '' }],
      }
      const baseBytes = Buffer.byteLength(JSON.stringify(base), 'utf8')
      return {
        ...base,
        parts: [{ type: 'text', text: 'x'.repeat(targetMessageBytes - baseBytes) }],
      }
    })
    expect(messages.map((message) => Buffer.byteLength(JSON.stringify(message), 'utf8')))
      .toEqual([targetMessageBytes, targetMessageBytes, targetMessageBytes, targetMessageBytes])

    await prisma.$transaction(async (tx) => {
      await tx.projectAssistantMessage.createMany({
        data: messages.map((message, index) => ({
          threadId: thread.threadId,
          messageId: message.id,
          position: index + 1,
          messageJson: message as unknown as Prisma.InputJsonValue,
          byteLength: targetMessageBytes,
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
      limit: 4,
    })
    expect(latest.messages.map((message) => message.id)).toEqual([
      'boundary-message-2',
      'boundary-message-3',
      'boundary-message-4',
    ])
    expect(Buffer.byteLength(JSON.stringify(latest.messages), 'utf8'))
      .toBeLessThanOrEqual(MESSAGE_PAGE_BYTE_BUDGET)
    expect(latest.messagePage).toEqual({ hasMore: true, before: '2' })

    const oldest = await readAssistantRuntimeMessagePage({
      scope,
      threadId: thread.threadId,
      before: latest.messagePage.before,
      limit: 4,
    })
    expect(oldest.messages.map((message) => message.id)).toEqual(['boundary-message-1'])
    expect(oldest.messagePage).toEqual({ hasMore: false, before: null })
  })

  it('reads the session view without sorting large turn JSON payloads', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const thread = await getOrCreateAssistantRuntimeThread(scope)
    const largeText = 'x'.repeat(512 * 1_024)
    const largeFailure = persistedLargeFailure(largeText)
    const turnCount = 32
    const turns = Array.from({ length: turnCount }, (_, index) => ({
      id: `large-payload-turn-${String(index + 1).padStart(3, '0')}`,
      threadId: thread.threadId,
      projectId: project.id,
      userId: user.id,
      sourceKind: 'user',
      sourceId: `large-payload-source-${String(index + 1).padStart(3, '0')}`,
      payloadHash: 'c'.repeat(64),
      requestId: `large-payload-request-${String(index + 1).padStart(3, '0')}`,
      status: 'completed',
      attempt: 1,
      userMessageJson: {
        id: `large-payload-source-${String(index + 1).padStart(3, '0')}`,
        role: 'user',
        parts: [{ type: 'text', text: largeText }],
      },
      contextJson: { locale: 'zh', selectedScopeRef: null, selectedAssetId: null },
      planJson: { diagnostic: largeText },
      failure: largeFailure,
      createdAt: new Date(Date.now() - (turnCount - index) * 1_000),
    }))

    await prisma.projectAgentTurn.createMany({ data: turns })

    await expect(getAssistantRuntimeSessionView(scope)).resolves.toMatchObject({
      protocol: 'assistant_runtime_session_view_v2',
      thread: { threadId: thread.threadId },
      currentTurn: { turnId: 'large-payload-turn-032' },
    })
  })

  it('reads one pending interaction without sorting its large runtime payload', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const thread = await getOrCreateAssistantRuntimeThread(scope)
    const turnId = 'large-interaction-turn'

    await prisma.projectAgentTurn.create({
      data: {
        id: turnId,
        threadId: thread.threadId,
        projectId: project.id,
        userId: user.id,
        sourceKind: 'user',
        sourceId: 'large-interaction-source',
        payloadHash: 'd'.repeat(64),
        requestId: 'large-interaction-request',
        status: 'running',
        attempt: 1,
        contextJson: { locale: 'zh' },
        startedAt: new Date(),
      },
    })
    await prisma.agentTurnInteraction.create({
      data: {
        id: 'large-pending-interaction',
        turnId,
        kind: 'runtime_request',
        status: 'pending',
        runtimeRequestId: 'large-runtime-request',
        payloadJson: {
          requestId: 'large-runtime-request',
          method: 'mcpServer/elicitation/request',
          params: {
            threadId: 'large-runtime-thread',
            turnId,
            mode: 'form',
            message: 'Provide a value',
            requestedSchema: { type: 'object', properties: {} },
            _meta: { diagnostic: 'x'.repeat(8 * 1_024 * 1_024) },
          },
        },
      },
    })

    await expect(getAssistantRuntimeSessionView(scope)).resolves.toMatchObject({
      pendingInteraction: {
        interactionId: 'large-pending-interaction',
        runtimeRequestId: 'large-runtime-request',
      },
    })
  })

  it('reads follow-up batches without sorting large task JSON payloads', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const thread = await getOrCreateAssistantRuntimeThread(scope)
    const largeText = 'x'.repeat(512 * 1_024)
    const taskCount = 32
    const taskIds = Array.from(
      { length: taskCount },
      (_, index) => `large-follow-up-task-${String(index + 1).padStart(3, '0')}`,
    )

    await prisma.task.createMany({
      data: taskIds.map((taskId) => ({
        id: taskId,
        userId: user.id,
        projectId: project.id,
        type: 'test_large_follow_up',
        targetType: 'Project',
        targetId: project.id,
        status: 'failed',
        operationId: 'assistant_test_large_follow_up',
        payload: { diagnostic: largeText },
        result: { diagnostic: largeText },
        failure: persistedLargeFailure(largeText),
        finishedAt: new Date(),
      })),
    })
    await prisma.followUpBatch.create({
      data: {
        id: 'large-follow-up-batch',
        executionKey: 'large-follow-up-execution',
        threadId: thread.threadId,
        originTurnId: 'large-follow-up-origin-turn',
        callId: 'large-follow-up-call',
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        operationId: 'assistant_test_large_follow_up',
        contextJson: { diagnostic: largeText },
        status: 'ready',
        members: {
          create: taskIds.map((taskId) => ({ taskId, status: 'settled' })),
        },
      },
    })

    await expect(getAssistantRuntimeSessionView(scope)).resolves.toMatchObject({
      followUpBatches: [{
        batchId: 'large-follow-up-batch',
        progress: { total: taskCount, failed: taskCount },
      }],
    })
  })
})
