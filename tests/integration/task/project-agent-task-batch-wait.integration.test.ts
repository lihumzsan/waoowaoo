import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  bindProjectAgentOperationBatchWaitMemberInTransaction,
  sealProjectAgentOperationBatchWait,
} from '@/lib/project-agent/waits'
import { runWithProjectAgentOperationExecutionFence } from '@/lib/project-agent/operation-execution-fence'
import { submitOperationTaskBatch } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationTaskBatchBinding, ProjectAgentTaskSubmissionReceipt } from '@/lib/operations/types'
import { createProjectAgentOperationBatchCoordinator } from '@/lib/project-agent/operation-batch'
import { TASK_TYPE } from '@/lib/task/types'
import { CREATIVE_WORK_TASK_PROTOCOL } from '@/lib/creative-worker'

describe('Project Agent non-billable Task batch to Wait DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('commits every Task into one background batch without blocking the foreground Run', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: { projectId: project.id, episodeNumber: 1, name: 'Assistant creative batch episode' },
    })
    const { run } = await createProjectAgentUserTurnRun({
      runId: 'assistant-nonbillable-batch-run',
      requestId: 'assistant-nonbillable-batch-request',
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: 'assistant-nonbillable-batch-message',
        role: 'user',
        parts: [{ type: 'text', text: 'delegate two creative reviews' }],
      },
    })
    const runFence = createProjectAgentRunFence(run)
    const coordinator = createProjectAgentOperationBatchCoordinator({ originRunId: run.id })
    const toolCallId = 'assistant-nonbillable-batch-tool-call'
    let bound = false
    let committed = false
    let committedReceipt: ProjectAgentTaskSubmissionReceipt | null = null
    let committedBackgroundRunFence = coordinator.readRunFence()
    const binding: ProjectAgentOperationTaskBatchBinding = {
      async bindInTransaction(tx, batch) {
        const result = await bindProjectAgentOperationBatchWaitMemberInTransaction(tx, {
          batch: coordinator.claim(batch.operationId),
          backgroundRunFence: coordinator.readRunFence(),
          projectId: project.id,
          userId: user.id,
          assistantId: 'workspace-command',
          operationId: batch.operationId,
          toolCallId,
          taskIds: [...batch.taskIds],
        })
        bound = true
        committedReceipt = result.receipt
        committedBackgroundRunFence = result.backgroundRunFence
        return result.receipt
      },
      isBound: () => bound,
      markCommitted: () => {
        if (!bound || !committedReceipt) return
        committed = true
        coordinator.commitMember({
          toolCallId,
          operationId: committedReceipt.operationId,
          taskIds: committedReceipt.taskIds,
          receipt: committedReceipt,
          runFence: committedBackgroundRunFence,
        })
      },
      isCommitted: () => committed,
      getCommittedReceipt: () => committed ? committedReceipt : null,
    }
    const request = new Request('http://localhost', {
      headers: { 'x-request-id': 'assistant-nonbillable-batch-request' },
    }) as NextRequest
    const results = await runWithProjectAgentOperationExecutionFence({
      runFence,
      signal: new AbortController().signal,
      taskBatchBinding: binding,
    }, async () => await submitOperationTaskBatch([1, 2].map((index) => {
      const requestKey = `creative-review-${index}`
      const goal = `Review creative work item ${index}.`
      return {
        request,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.CREATIVE_WORK,
        targetType: 'CreativeWork',
        targetId: `creative-work-${index}`,
        operationId: 'delegate_creative_work',
        source: 'assistant-panel',
        payload: {
          protocol: CREATIVE_WORK_TASK_PROTOCOL,
          requestKey,
          request: {
            outputKind: 'continuity_analysis',
            goal,
            context: {
              userRequest: 'Analyze these independent creative work items.',
              sourceMaterials: [],
              constraints: [],
            },
            creativeDirection: null,
            productionContext: { video: null },
          },
          modelKey: 'test:creative-model',
          inputFingerprint: `${index}`.repeat(64),
          origin: { runId: run.id, toolCallId },
          lifecycleProjection: {
            requestKey,
            outputKind: 'continuity_analysis',
            goal,
            events: [],
          },
        },
        dedupeKey: `assistant-nonbillable-batch:${index}`,
        locale: 'en' as const,
        billingInfo: null,
      }
    })))

    const members = coordinator.readMembers()
    const firstMember = members[0]
    if (!firstMember) throw new Error('EXPECTED_OPERATION_BATCH_MEMBER')
    await sealProjectAgentOperationBatchWait({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      batch: coordinator.claim(firstMember.operationId),
      taskIds: members.flatMap((member) => [...member.taskIds]),
    })

    const [storedRun, backgroundRun, waits, tasks, enqueueCommands] = await Promise.all([
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: run.id } }),
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: firstMember.receipt.backgroundRunId } }),
      prisma.projectAgentWait.findMany({ where: { runId: firstMember.receipt.backgroundRunId } }),
      prisma.task.findMany({ where: { id: { in: results.map((result) => result.taskId) } } }),
      prisma.outboxCommand.findMany({
        where: { kind: 'task.enqueue', aggregateId: { in: results.map((result) => result.taskId) } },
      }),
    ])
    expect(binding.isCommitted()).toBe(true)
    expect(storedRun.status).toBe('running')
    expect(backgroundRun.status).toBe('awaiting_task')
    expect(waits).toHaveLength(1)
    expect((waits[0]?.taskIds as string[]).sort()).toEqual(results.map((result) => result.taskId).sort())
    expect(tasks).toHaveLength(2)
    expect(enqueueCommands).toHaveLength(2)
  })
})
