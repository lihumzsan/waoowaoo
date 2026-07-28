import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import {
  createProjectAgentUserTurnRun,
  updateProjectAgentRunStatus,
} from '@/lib/project-agent/runs'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  bindProjectAgentOperationBatchWaitMemberInTransaction,
  sealProjectAgentOperationBatchWait,
} from '@/lib/project-agent/waits'
import { createProjectAgentOperationBatchCoordinator } from '@/lib/project-agent/operation-batch'
import { runProjectAgentWaitContinuationCommand } from '@/lib/project-agent/server-follow-up'
import { getProjectAgentSessionState } from '@/lib/project-agent/session-state'
import { commitTaskTerminal } from '@/lib/task/terminal'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { parseOutboxCommandPayload } from '@/lib/outbox/types'
import { buildCreativeResourceId } from '@/lib/creative-resource/identity'

describe('Project Agent OperationBatch Wait concurrency', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  /**
   * Authority: one model-step OperationBatch owns one background Run and collecting Wait.
   * Rejects: blocking the foreground Run, losing a terminal Task that wins the seal race,
   * canceling background work on a new user turn, or scheduling more than one continuation.
   * Production entry: Operation Task transaction -> OperationBatch member bind -> seal -> Task terminal.
   * Oracle: duplicate image plus audio/video Operation members remain one exact Wait while a later foreground Run stays active.
   * Command: BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/task/project-agent-task-terminal-wait-concurrency.integration.test.ts
   */
  it('keeps background Tasks independent from later user turns and resumes once after all terminals', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: { projectId: project.id, episodeNumber: 1, name: 'Operation batch concurrency episode' },
    })
    const { run: originRun } = await createProjectAgentUserTurnRun({
      runId: 'assistant-operation-batch-origin-run',
      requestId: 'assistant-operation-batch-origin-request',
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      message: {
        id: 'assistant-operation-batch-origin-message',
        role: 'user',
        parts: [{ type: 'text', text: 'generate images, audio, and video in parallel' }],
      },
    })
    const coordinator = createProjectAgentOperationBatchCoordinator({ originRunId: originRun.id })
    const taskSpecs = [
      { operationId: 'create_image', taskType: TASK_TYPE.CREATIVE_RESOURCE_IMAGE, mediaType: 'image' },
      { operationId: 'create_image', taskType: TASK_TYPE.CREATIVE_RESOURCE_IMAGE, mediaType: 'image' },
      { operationId: 'create_audio', taskType: TASK_TYPE.CREATIVE_RESOURCE_AUDIO, mediaType: 'audio' },
      { operationId: 'create_video', taskType: TASK_TYPE.CREATIVE_RESOURCE_VIDEO, mediaType: 'video' },
    ] as const
    const taskIds = taskSpecs.map((_, index) => `assistant-operation-batch-task-${index + 1}`)
    const resourceIds = taskSpecs.map((_, index) => buildCreativeResourceId({
      operationId: 'operation_batch_test',
      requestId: originRun.id,
      candidateIndex: index,
    }))
    await prisma.creativeResource.createMany({
      data: taskSpecs.map((spec, index) => ({
        id: resourceIds[index]!,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        scopeKind: 'episode',
        scopeId: episode.id,
        mediaType: spec.mediaType,
        schemaId: `generic.${spec.mediaType}`,
        name: `Operation batch ${spec.mediaType} ${index + 1}`,
      })),
    })
    await prisma.task.createMany({
      data: taskSpecs.map((spec, index) => ({
        id: taskIds[index]!,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: spec.taskType,
        targetType: 'CreativeResource',
        targetId: resourceIds[index]!,
        status: TASK_STATUS.QUEUED,
        operationId: spec.operationId,
        payload: {
          lifecycleProjection: {
            resources: [{
              resourceId: resourceIds[index]!,
              mediaType: spec.mediaType,
              schemaId: `generic.${spec.mediaType}`,
              name: `Operation batch ${spec.mediaType} ${index + 1}`,
            }],
          },
          resource: {
            resourceId: resourceIds[index]!,
            mediaType: spec.mediaType,
            schemaId: `generic.${spec.mediaType}`,
            prompt: `Operation batch ${spec.mediaType} prompt`,
            modelKey: `test-${spec.mediaType}-model`,
            inputHash: `${index + 1}`.repeat(64),
            inputs: [],
            imageInputPositions: [],
            audioInputPositions: [],
            videoInputPositions: [],
            generationOptions: {},
            executionSegmentId: null,
            toolCallId: `assistant-operation-batch-tool-call-${index + 1}`,
          },
          count: 1,
          generationOptions: {},
        },
      })),
    })

    for (const [index, spec] of taskSpecs.entries()) {
      const taskId = taskIds[index]!
      const toolCallId = `assistant-operation-batch-tool-call-${index + 1}`
      const result = await prisma.$transaction(async (tx) => (
        await bindProjectAgentOperationBatchWaitMemberInTransaction(tx, {
          batch: coordinator.claim(spec.operationId),
          backgroundRunFence: coordinator.readRunFence(),
          projectId: project.id,
          userId: user.id,
          episodeId: episode.id,
          assistantId: 'workspace-command',
          operationId: spec.operationId,
          toolCallId,
          taskIds: [taskId],
        })
      ))
      coordinator.commitMember({
        toolCallId,
        operationId: spec.operationId,
        taskIds: [taskId],
        receipt: result.receipt,
        runFence: result.backgroundRunFence,
      })
    }

    const members = coordinator.readMembers()
    expect(members).toHaveLength(4)
    const backgroundRunId = members[0]?.receipt.backgroundRunId
    const waitId = members[0]?.receipt.waitId
    if (!backgroundRunId || !waitId) throw new Error('EXPECTED_OPERATION_BATCH_IDENTITY')

    const earlyTerminal = await commitTaskTerminal({
      kind: 'failed',
      taskId: taskIds[0]!,
      fence: { kind: 'active' },
      errorCode: 'EARLY_TERMINAL_TEST',
      errorMessage: 'terminal before batch seal',
      source: 'validation',
    })
    expect(earlyTerminal).toMatchObject({ applied: true, status: 'failed' })
    await expect(prisma.outboxCommand.count({
      where: { kind: 'project_agent.continue_wait', aggregateId: waitId },
    })).resolves.toBe(0)

    await sealProjectAgentOperationBatchWait({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      batch: coordinator.claim(taskSpecs[0].operationId),
      taskIds,
    })
    await updateProjectAgentRunStatus({
      runFence: createProjectAgentRunFence(originRun),
      status: 'completed',
      expectedStatuses: ['running'],
      stopReason: 'completed',
    })
    const { run: nextForegroundRun } = await createProjectAgentUserTurnRun({
      runId: 'assistant-operation-batch-next-run',
      requestId: 'assistant-operation-batch-next-request',
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      message: {
        id: 'assistant-operation-batch-next-message',
        role: 'user',
        parts: [{ type: 'text', text: 'continue with another idea' }],
      },
    })

    const sessionWhileBackgroundRuns = await getProjectAgentSessionState({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      locale: 'en',
    })
    expect(sessionWhileBackgroundRuns.currentRun?.runId).toBe(nextForegroundRun.id)
    expect(sessionWhileBackgroundRuns.activeWaits).toEqual([
      expect.objectContaining({ waitId, runId: backgroundRunId, status: 'pending', total: 4 }),
    ])
    expect(sessionWhileBackgroundRuns.activeTasks).toHaveLength(3)

    const terminalResults = await Promise.all(taskIds.slice(1).map(async (taskId) => await commitTaskTerminal({
      kind: 'failed',
      taskId,
      fence: { kind: 'active' },
      errorCode: 'CONCURRENT_TERMINAL_TEST',
      errorMessage: `${taskId} failed`,
      source: 'validation',
    })))
    expect(terminalResults).toEqual([
      expect.objectContaining({ applied: true, status: 'failed' }),
      expect.objectContaining({ applied: true, status: 'failed' }),
      expect.objectContaining({ applied: true, status: 'failed' }),
    ])

    const [wait, backgroundRun, storedNextRun, continuationCommands] = await Promise.all([
      prisma.projectAgentWait.findUniqueOrThrow({ where: { id: waitId } }),
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: backgroundRunId } }),
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: nextForegroundRun.id } }),
      prisma.outboxCommand.findMany({
        where: { kind: 'project_agent.continue_wait', aggregateId: waitId },
      }),
    ])
    expect(wait).toMatchObject({ status: 'resolved', terminalStatus: 'failed' })
    expect((wait.terminalTaskIds as string[]).sort()).toEqual([...taskIds].sort())
    expect((wait.failedTaskIds as string[]).sort()).toEqual([...taskIds].sort())
    expect(backgroundRun.status).toBe('awaiting_task')
    expect(storedNextRun.status).toBe('running')
    expect(continuationCommands).toHaveLength(1)
    const continuationCommand = continuationCommands[0]
    if (!continuationCommand) throw new Error('EXPECTED_OPERATION_BATCH_CONTINUATION_COMMAND')
    const payload = parseOutboxCommandPayload(continuationCommand.payload)
    if (payload.kind !== 'project_agent.continue_wait') {
      throw new Error(`EXPECTED_OPERATION_BATCH_CONTINUATION_PAYLOAD:${payload.kind}`)
    }
    await expect(runProjectAgentWaitContinuationCommand(payload, continuationCommand.id))
      .rejects.toThrow('PROJECT_AGENT_RUN_ACTIVE')
    await expect(prisma.projectAgentWait.findUniqueOrThrow({ where: { id: waitId } }))
      .resolves.toMatchObject({ status: 'resolved', claimId: null })
  })
})
