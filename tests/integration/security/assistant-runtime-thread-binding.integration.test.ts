import { beforeEach, describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import { bindAssistantRuntimeThread } from '@/lib/assistant-runtime/persistence'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

describe('Assistant Runtime native Thread binding', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('binds only an unbound native Thread id and preserves Wao messages', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const messages = [{
      id: 'message-1',
      role: 'user',
      parts: [{ type: 'text', text: 'keep me' }],
    }]
    const thread = await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        runtimeThreadId: null,
        nextMessagePosition: 2,
        messages: {
          create: {
            messageId: messages[0].id,
            position: 1,
            messageJson: messages[0] as unknown as Prisma.InputJsonValue,
            byteLength: Buffer.byteLength(JSON.stringify(messages[0]), 'utf8'),
          },
        },
      },
    })
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const binding = {
      scope,
      threadId: thread.id,
      runtimeThreadId: 'native-new-thread',
    }

    await expect(bindAssistantRuntimeThread(binding)).resolves.toMatchObject({
      runtimeThreadId: 'native-new-thread',
    })

    await expect(prisma.projectAssistantThread.findUniqueOrThrow({
      where: { id: thread.id },
      select: {
        runtimeThreadId: true,
        nextMessagePosition: true,
        messages: { orderBy: { position: 'asc' }, select: { messageJson: true } },
      },
    })).resolves.toEqual({
      runtimeThreadId: 'native-new-thread',
      nextMessagePosition: 2,
      messages: [{ messageJson: messages[0] }],
    })

    await expect(bindAssistantRuntimeThread({
      ...binding,
      runtimeThreadId: 'native-third-thread',
    })).rejects.toThrow('ASSISTANT_RUNTIME_CODEX_THREAD_ID_DIVERGED')

    await expect(prisma.projectAssistantThread.findUniqueOrThrow({
      where: { id: thread.id },
      select: {
        runtimeThreadId: true,
        nextMessagePosition: true,
        messages: { orderBy: { position: 'asc' }, select: { messageJson: true } },
      },
    })).resolves.toEqual({
      runtimeThreadId: 'native-new-thread',
      nextMessagePosition: 2,
      messages: [{ messageJson: messages[0] }],
    })
  })
})
