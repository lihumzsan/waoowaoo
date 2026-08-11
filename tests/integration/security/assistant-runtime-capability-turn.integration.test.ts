import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  requireAssistantRuntimeCapabilityTurn,
  requireAssistantRuntimeModelCapabilityTurn,
} from '@/lib/assistant-runtime/capability-turn'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import { RedisAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

describe('Assistant Runtime capability Turn fence', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('accepts a bound first Turn before runtime Thread checkpoint and rejects identity drift', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const thread = await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        runtimeThreadId: null,
        messagesJson: [],
      },
    })
    const runtimeTurnId = `runtime_turn_${randomUUID()}`
    const turn = await prisma.projectAgentTurn.create({
      data: {
        id: `product_turn_${randomUUID()}`,
        threadId: thread.id,
        projectId: project.id,
        userId: user.id,
        sourceKind: 'user',
        sourceId: `source_${randomUUID()}`,
        payloadHash: 'a'.repeat(64),
        requestId: randomUUID(),
        status: 'running',
        attempt: 1,
        executionOwnerId: runtimeTurnId,
        contextJson: {
          locale: 'zh',
          selectedScopeRef: null,
          selectedAssetId: null,
        },
        runtimeTurnId,
        startedAt: new Date(),
      },
    })
    const scope = { userId: user.id, projectId: project.id }
    const ownerToken = `owner_${randomUUID()}`
    const ownership = await new RedisAssistantRuntimeOwnership().acquire(scope, ownerToken)

    try {
      await expect(requireAssistantRuntimeCapabilityTurn({
        scope: { ...scope, assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID },
        ownerToken,
      })).resolves.toMatchObject({
        threadId: thread.id,
        turnId: turn.id,
        runtimeTurnId,
        executionOwnerId: runtimeTurnId,
      })

      await prisma.projectAgentTurn.update({
        where: { id: turn.id },
        data: { executionOwnerId: `different_${randomUUID()}` },
      })
      await expect(requireAssistantRuntimeCapabilityTurn({
        scope: { ...scope, assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID },
        ownerToken,
      })).rejects.toMatchObject({
        code: 'ACTIVE_TURN_IDENTITY_INVALID',
      })
    } finally {
      await ownership.release()
    }

    await expect(requireAssistantRuntimeCapabilityTurn({
      scope: { ...scope, assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID },
      ownerToken,
    })).rejects.toMatchObject({
      code: 'OWNERSHIP_REQUIRED',
    })
  })

  it('atomically binds the first authenticated model request before side effects are allowed', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const thread = await prisma.projectAssistantThread.create({
      data: {
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        runtimeThreadId: `runtime_thread_${randomUUID()}`,
        messagesJson: [],
      },
    })
    const sourceId = `source_${randomUUID()}`
    const turn = await prisma.projectAgentTurn.create({
      data: {
        id: `product_turn_${randomUUID()}`,
        threadId: thread.id,
        projectId: project.id,
        userId: user.id,
        sourceKind: 'user',
        sourceId,
        payloadHash: 'b'.repeat(64),
        requestId: randomUUID(),
        status: 'running',
        attempt: 1,
        executionOwnerId: null,
        contextJson: {
          locale: 'zh',
          selectedScopeRef: null,
          selectedAssetId: null,
        },
        runtimeTurnId: null,
        startedAt: new Date(),
      },
    })
    await prisma.projectAssistantMessageCommand.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        userId: user.id,
        assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
        sourceId,
        payloadHash: turn.payloadHash,
        kind: 'turn',
        status: 'accepted',
        threadId: thread.id,
        turnId: turn.id,
        messageJson: {},
        acceptedAt: new Date(),
      },
    })
    const scope = { userId: user.id, projectId: project.id }
    const ownerToken = `owner_${randomUUID()}`
    const ownership = await new RedisAssistantRuntimeOwnership().acquire(scope, ownerToken)
    const runtimeTurnId = `runtime_turn_${randomUUID()}`

    try {
      await expect(requireAssistantRuntimeCapabilityTurn({
        scope: { ...scope, assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID },
        ownerToken,
      })).rejects.toMatchObject({ code: 'ACTIVE_TURN_IDENTITY_INVALID' })

      await expect(requireAssistantRuntimeModelCapabilityTurn({
        scope: { ...scope, assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID },
        ownerToken,
        runtimeTurnId,
      })).resolves.toMatchObject({
        threadId: thread.id,
        turnId: turn.id,
        runtimeTurnId,
        executionOwnerId: runtimeTurnId,
      })

      await expect(requireAssistantRuntimeCapabilityTurn({
        scope: { ...scope, assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID },
        ownerToken,
      })).resolves.toMatchObject({ runtimeTurnId, executionOwnerId: runtimeTurnId })
    } finally {
      await ownership.release()
    }
  })
})
