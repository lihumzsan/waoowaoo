import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentFollowUpBatchBinding } from '@/lib/agent-turn/follow-up-batch'
import { persistSubmittedTaskBatchInTransaction } from '@/lib/task/transactional-create'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

async function createBindingFixture(taskCount: number) {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const threadId = `follow-up-binding-thread-${user.id}`
  const turnId = `follow-up-binding-turn-${user.id}`
  const operationId = 'test.follow-up-binding'
  const executionKey = `follow-up-binding-execution-${user.id}`
  const callId = `follow-up-binding-call-${user.id}`
  const operationExecution = await prisma.operationExecution.create({
    data: {
      userId: user.id,
      scopeKind: 'project',
      scopeId: project.id,
      projectId: project.id,
      operationId,
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
  const persisted = await prisma.$transaction((tx) =>
    persistSubmittedTaskBatchInTransaction({
      tx,
      inputs: Array.from({ length: taskCount }, (_, index) => {
        const resourceId = `follow-up-binding-resource-${user.id}-${index}`
        return {
          userId: user.id,
          projectId: project.id,
          type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
          targetType: 'WorkspaceResource',
          targetId: resourceId,
          payload: {
            lifecycleProjection: {
              resources: [
                {
                  resourceId,
                  mediaType: 'audio',
                  schemaId: 'generic.audio',
                  name: 'follow-up-binding',
                },
              ],
            },
            resourceId,
          },
          operationExecutionId: operationExecution.id,
          operationPlanTaskId: `0${index + 1}:follow-up-binding`,
        }
      }),
    }),
  )
  return {
    taskIds: persisted.map(({ task }) => task.id),
    origin: { executionKey, turnId, callId, operationId },
  }
}

describe('FollowUpBatch binding admission', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('rejects mixed terminal and active members without creating a batch', async () => {
    const fixture = await createBindingFixture(2)
    const [terminalTaskId, activeTaskId] = fixture.taskIds
    await prisma.task.update({
      where: { id: terminalTaskId },
      data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
    })
    const binding = createAgentFollowUpBatchBinding(fixture.origin)

    await expect(
      prisma.$transaction((tx) =>
        binding.bindInTransaction(tx, {
          operationId: fixture.origin.operationId,
          taskIds: [activeTaskId, terminalTaskId],
        }),
      ),
    ).rejects.toThrow(
      `FOLLOW_UP_BATCH_MEMBER_NOT_ACTIVE:${fixture.origin.executionKey}:${terminalTaskId}:completed`,
    )
    await expect(
      prisma.followUpBatch.count({
        where: { executionKey: fixture.origin.executionKey },
      }),
    ).resolves.toBe(0)
  })

  it('replays an existing pending batch after a member reaches terminal state', async () => {
    const fixture = await createBindingFixture(2)
    const firstBinding = createAgentFollowUpBatchBinding(fixture.origin)
    const batchId = await prisma.$transaction((tx) =>
      firstBinding.bindInTransaction(tx, {
        operationId: fixture.origin.operationId,
        taskIds: fixture.taskIds,
      }),
    )
    await prisma.task.update({
      where: { id: fixture.taskIds[0] },
      data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
    })
    const replayBinding = createAgentFollowUpBatchBinding(fixture.origin)
    await expect(
      prisma.$transaction((tx) =>
        replayBinding.bindInTransaction(tx, {
          operationId: fixture.origin.operationId,
          taskIds: fixture.taskIds,
        }),
      ),
    ).resolves.toBe(batchId)
    await expect(
      prisma.followUpBatch.count({
        where: { executionKey: fixture.origin.executionKey },
      }),
    ).resolves.toBe(1)
  })
})
