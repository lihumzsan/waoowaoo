import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentFollowUpBatchBinding } from '@/lib/agent-turn/follow-up-batch'
import { persistSubmittedTaskBatchInTransaction } from '@/lib/task/transactional-create'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

describe('FollowUpBatch binding admission', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('rejects a terminal member instead of creating an un-settleable pending membership', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const threadId = `follow-up-binding-thread-${user.id}`
    const turnId = `follow-up-binding-turn-${user.id}`
    const operationExecution = await prisma.operationExecution.create({
      data: {
        userId: user.id,
        scopeKind: 'project',
        scopeId: project.id,
        projectId: project.id,
        operationId: 'test.follow-up-binding',
        requestId: `follow-up-binding-request-${user.id}`,
        status: 'committing',
      },
    })
    await prisma.projectAssistantThread.create({
      data: {
        id: threadId,
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        messagesJson: [],
      },
    })
    await prisma.projectAgentTurn.create({
      data: {
        id: turnId,
        threadId,
        projectId: project.id,
        userId: user.id,
        sourceKind: 'user',
        sourceId: `follow-up-binding-source-${user.id}`,
        payloadHash: 'b'.repeat(64),
        requestId: `follow-up-binding-turn-request-${user.id}`,
        status: 'running',
        attempt: 1,
        contextJson: {
          locale: 'en',
          selectedScopeRef: null,
          selectedAssetId: null,
        },
        startedAt: new Date(),
      },
    })
    const [{ task }] = await prisma.$transaction(async (tx) =>
      persistSubmittedTaskBatchInTransaction({
        tx,
        inputs: [
          {
            userId: user.id,
            projectId: project.id,
            type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
            targetType: 'WorkspaceResource',
            targetId: `follow-up-binding-resource-${user.id}`,
            payload: {
              lifecycleProjection: {
                resources: [
                  {
                    resourceId: `follow-up-binding-resource-${user.id}`,
                    mediaType: 'audio',
                    schemaId: 'generic.audio',
                    name: 'follow-up-binding',
                  },
                ],
              },
              resourceId: `follow-up-binding-resource-${user.id}`,
            },
            operationExecutionId: operationExecution.id,
            operationPlanTaskId: '01:follow-up-binding',
          },
        ],
      }),
    )
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
    })
    const binding = createAgentFollowUpBatchBinding({
      executionKey: `follow-up-binding-execution-${user.id}`,
      turnId,
      callId: `follow-up-binding-call-${user.id}`,
      operationId: 'test.follow-up-binding',
    })

    await expect(
      prisma.$transaction((tx) =>
        binding.bindInTransaction(tx, {
          operationId: 'test.follow-up-binding',
          taskIds: [task.id],
        }),
      ),
    ).rejects.toThrow(
      `FOLLOW_UP_BATCH_MEMBER_NOT_ACTIVE:follow-up-binding-execution-${user.id}:${task.id}:completed`,
    )
    await expect(
      prisma.followUpBatch.count({
        where: { executionKey: `follow-up-binding-execution-${user.id}` },
      }),
    ).resolves.toBe(0)
  })
})
