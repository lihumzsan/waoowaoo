import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { requireAssistantRuntimeCapabilityTurn } from '@/lib/assistant-runtime/capability-turn'
import { ASSISTANT_RUNTIME_ASSISTANT_ID } from '@/lib/assistant-runtime/contracts'
import { RedisAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { issueWaoRuntimeToken, verifyWaoRuntimeToken } from '@/lib/wao-mcp/runtime-token'
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

  it('authorizes a signed placement only while its nonce owns the live Runtime lease', async () => {
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
        payloadHash: 'b'.repeat(64),
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
    const scope = {
      userId: user.id,
      projectId: project.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    }
    const issued = issueWaoRuntimeToken({ scope })
    const signedPlacement = verifyWaoRuntimeToken(issued.token)
    const ownership = await new RedisAssistantRuntimeOwnership().acquire(
      scope,
      signedPlacement.nonce,
    )

    try {
      await expect(requireAssistantRuntimeCapabilityTurn({
        scope: signedPlacement,
        ownerToken: signedPlacement.nonce,
      })).resolves.toMatchObject({
        threadId: thread.id,
        turnId: turn.id,
        runtimeTurnId,
      })
    } finally {
      await ownership.release()
    }

    await expect(requireAssistantRuntimeCapabilityTurn({
      scope: signedPlacement,
      ownerToken: signedPlacement.nonce,
    })).rejects.toMatchObject({
      code: 'OWNERSHIP_REQUIRED',
    })
  })
})
