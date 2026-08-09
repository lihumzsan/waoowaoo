import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import { bindAssistantRuntimeThread } from '@/lib/assistant-runtime/persistence'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

describe('Assistant Runtime native Thread binding', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('replaces only the expected native Thread id and preserves Wao messages', async () => {
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
        runtimeThreadId: 'native-old-thread',
        messagesJson: messages,
      },
    })
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const replacement = {
      scope,
      threadId: thread.id,
      runtimeThreadId: 'native-new-thread',
      expectedRuntimeThreadId: 'native-old-thread',
    } as Parameters<typeof bindAssistantRuntimeThread>[0] & {
      readonly expectedRuntimeThreadId: string
    }

    await expect(bindAssistantRuntimeThread(replacement)).resolves.toMatchObject({
      runtimeThreadId: 'native-new-thread',
    })

    await expect(prisma.projectAssistantThread.findUniqueOrThrow({
      where: { id: thread.id },
      select: { runtimeThreadId: true, messagesJson: true },
    })).resolves.toEqual({
      runtimeThreadId: 'native-new-thread',
      messagesJson: messages,
    })

    await expect(bindAssistantRuntimeThread({
      ...replacement,
      runtimeThreadId: 'native-third-thread',
      expectedRuntimeThreadId: 'different-native-thread',
    })).rejects.toThrow('ASSISTANT_RUNTIME_CODEX_THREAD_ID_DIVERGED')

    await expect(prisma.projectAssistantThread.findUniqueOrThrow({
      where: { id: thread.id },
      select: { runtimeThreadId: true, messagesJson: true },
    })).resolves.toEqual({
      runtimeThreadId: 'native-new-thread',
      messagesJson: messages,
    })
  })
})
