import { randomUUID } from 'node:crypto'
import { WorkflowUpdateFailedError, type WorkflowHandle } from '@temporalio/client'
import { Prisma } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  resolveAgentTurnApprovalDecision,
  type AgentTurnApprovalPayload,
  type ResolveAgentTurnApprovalCommand,
} from '@/lib/agent-turn/approval'
import { cancelAgentTurn, clearAgentThread } from '@/lib/agent-turn/lifecycle'
import { buildAgentTurnRuntimeContract } from '@/lib/agent-turn/runtime-contract'
import { getAgentSessionView } from '@/lib/agent-turn/view'
import { parseAgentSessionView } from '@/lib/agent-turn/view-contract'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { buildAgentTurnEnvelope } from '@/lib/agent-turn/identity'
import {
  acceptAgentTurnCommand,
  failAgentTurnExecution,
  recoverAgentThreadCoordinatorState,
  settleAgentTurnAfterActivityLoss,
} from '@/lib/agent-turn/service'
import { loadInterruptedTurnContinuationInputs } from '@/lib/agent-turn/interrupted-effect-digest'
import {
  getOrCreateProjectAssistantThread,
  parseProjectAssistantModelHistory,
  serializeProjectAssistantModelHistory,
} from '@/lib/project-agent/persistence'
import {
  TemporalAgentThreadClient,
  TemporalAgentTurnCommandConflictError,
} from '@/lib/temporal/agent-thread/client'
import { connectTemporalClient } from '@/lib/temporal/client'
import { buildAgentThreadWorkflowId } from '@/lib/temporal/identity'
import { createFixtureEpisode, createFixtureProject } from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'
import {
  startAgentAdmissionWorker,
  startAgentSupersedeWorker,
  type AgentAdmissionWorkerHarness,
} from './helpers/agent-admission-worker'
import {
  acceptedUpdateCount,
  agentActivityAttempts,
  scheduledActivityCount,
  timedOutActivityCount,
} from './helpers/agent-temporal-history'
import {
  buildUserTurnCommand,
  createAgentTurnFixture,
  removeAgentTurnFixture,
} from './helpers/agent-turn-fixture'
import {
  startAgentSettlementWorker,
  startKillableAgentWorker,
  type AgentSettlementWorker,
} from './helpers/agent-worker-loss-harness'

/**
 * Admission record:
 * - TG-03 critical infrastructure: real Temporal Server, production Workflow,
 *   production admission Activity and real MySQL transaction.
 * - Independent oracle: MySQL's unique Turn fact and persisted Thread message.
 * - Rejects ACK-loss duplication and accepting one source identity with
 *   divergent payload. The only injected fault is after the production
 *   admission Activity has committed; its retry delegates to the same owner.
 * - This suite deliberately does not run the model Activity. Model execution
 *   durability has a separate Worker-loss oracle and must not use a fake model.
 */

let worker: AgentAdmissionWorkerHarness | null = null

function requireWorker(): AgentAdmissionWorkerHarness {
  if (!worker) throw new Error('AGENT_ADMISSION_WORKER_MISSING')
  return worker
}

describe('Agent Thread Temporal admission durability', () => {
  beforeAll(async () => {
    worker = await startAgentAdmissionWorker()
  }, 60_000)

  afterAll(async () => {
    await worker?.close()
    worker = null
  }, 60_000)

  it('exact-replays Update-With-Start after commit/ACK loss and rejects divergent payload', async () => {
    const fixture = await createAgentTurnFixture()
    const connected = await connectTemporalClient()
    const workflowId = buildAgentThreadWorkflowId(fixture.threadId)
    let handle: WorkflowHandle | null = null
    try {
      const client = new TemporalAgentThreadClient(
        connected.client.workflow,
        requireWorker().taskQueue,
      )
      const original = buildUserTurnCommand(fixture, '请为这个项目整理一个导演方案。')
      const originalEnvelope = buildAgentTurnEnvelope(original)
      const first = await client.submit(original)
      handle = connected.client.workflow.getHandle(workflowId)
      await requireWorker().waitForPostCommitFault()
      if (first.outcome !== 'accepted') {
        throw new Error('AGENT_USER_TURN_UNEXPECTEDLY_IGNORED')
      }

      const replay = await client.submit(original)
      expect(replay).toEqual(first)
      expect(first).toMatchObject({
        workflowId,
        commandId: originalEnvelope.commandId,
        payloadHash: originalEnvelope.payloadHash,
        threadId: fixture.threadId,
        outcome: 'accepted',
      })

      const divergent = buildUserTurnCommand(fixture, '这是同一个来源身份，但内容已经被篡改。')
      const conflict = await client.submit(divergent).then(
        () => null,
        (error: unknown) => error,
      )
      expect(conflict).toBeInstanceOf(TemporalAgentTurnCommandConflictError)
      if (!(conflict instanceof TemporalAgentTurnCommandConflictError)) {
        throw new Error('AGENT_TURN_DIVERGENT_REPLAY_NOT_TYPED')
      }
      expect(conflict).toMatchObject({
        code: 'AGENT_TURN_COMMAND_REPLAY_DIVERGED',
        commandId: originalEnvelope.commandId,
      })

      const [turns, thread, history] = await Promise.all([
        prisma.projectAgentTurn.findMany({
          where: {
            threadId: fixture.threadId,
            sourceKind: original.sourceKind,
            sourceId: fixture.sourceId,
          },
        }),
        prisma.projectAssistantThread.findUniqueOrThrow({
          where: { id: fixture.threadId },
        }),
        handle.fetchHistory(),
      ])
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({
        id: first.turn.id,
        payloadHash: originalEnvelope.payloadHash,
        requestId: original.requestId,
      })
      expect(thread.messagesJson).toEqual([original.userMessage])
      expect(acceptedUpdateCount(history, originalEnvelope.commandId)).toBe(1)
      // Temporal compacts retry history by retaining the final started
      // attempt. `2` proves the post-commit failure caused a real retry; the
      // harness latch above proves the first production commit was reached.
      expect(agentActivityAttempts(history, 'admitAgentTurn')).toEqual([2])
    } finally {
      if (handle) {
        await handle.terminate('AGENT_ADMISSION_DURABILITY_TEST_COMPLETE')
        const closed = await handle.describe()
        if (closed.status.name !== 'TERMINATED') {
          throw new Error(`AGENT_ADMISSION_WORKFLOW_NOT_TERMINATED:${closed.status.name}`)
        }
      }
      await connected.close()
      await removeAgentTurnFixture(fixture)
    }
  }, 60_000)

  it('settles one claimed Turn as interrupted after its Worker process is SIGKILLed', async () => {
    const fixture = await createAgentTurnFixture()
    const connected = await connectTemporalClient()
    const killableWorker = await startKillableAgentWorker()
    const workflowId = buildAgentThreadWorkflowId(fixture.threadId)
    let settlementWorker: AgentSettlementWorker | null = null
    let handle: WorkflowHandle | null = null
    try {
      await killableWorker.waitUntilReady()
      const client = new TemporalAgentThreadClient(
        connected.client.workflow,
        killableWorker.taskQueue,
      )
      const command = buildUserTurnCommand(fixture, '请开始一个会被真实 Worker 丢失打断的 Turn。')
      const receipt = await client.submit(command)
      if (receipt.outcome !== 'accepted') {
        throw new Error('AGENT_WORKER_LOSS_TURN_UNEXPECTEDLY_IGNORED')
      }
      handle = connected.client.workflow.getHandle(workflowId)
      await killableWorker.waitUntilTurnRunning(receipt.turn.id)

      const running = await prisma.projectAgentTurn.findUniqueOrThrow({
        where: { id: receipt.turn.id },
      })
      expect(running).toMatchObject({
        status: 'running',
        attempt: 1,
      })

      await killableWorker.killProcessGroup()
      settlementWorker = await startAgentSettlementWorker(killableWorker.taskQueue)
      const result = await handle.result()
      expect(result).toMatchObject({
        workflowId,
        threadId: fixture.threadId,
        lastTurn: {
          turnId: receipt.turn.id,
          status: 'interrupted',
          stopReason: 'activity_lost',
          errorCode: 'GENERATION_FAILED',
        },
      })

      const [interrupted, history, completed] = await Promise.all([
        prisma.projectAgentTurn.findUniqueOrThrow({
          where: { id: receipt.turn.id },
        }),
        handle.fetchHistory(),
        handle.describe(),
      ])
      expect(interrupted).toMatchObject({
        status: 'interrupted',
        attempt: 1,
        stopReason: 'activity_lost',
        errorCode: 'GENERATION_FAILED',
      })
      expect(completed.status.name).toBe('COMPLETED')
      expect(scheduledActivityCount(history, 'executeAgentTurn')).toBe(1)
      expect(agentActivityAttempts(history, 'executeAgentTurn')).toEqual([1])
      expect(timedOutActivityCount(history, 'executeAgentTurn')).toBe(1)
    } finally {
      await killableWorker.close()
      if (handle) {
        const description = await handle.describe()
        if (description.status.name === 'RUNNING') {
          await handle.terminate('AGENT_WORKER_LOSS_TEST_CLEANUP')
        }
      }
      await settlementWorker?.close()
      await connected.close()
      await removeAgentTurnFixture(fixture)
    }
  }, 90_000)

  it('keeps rapid user corrections and drains the superseded Activity before the latest Turn starts', async () => {
    const fixture = await createAgentTurnFixture()
    const connected = await connectTemporalClient()
    const supersedeWorker = await startAgentSupersedeWorker()
    const workflowId = buildAgentThreadWorkflowId(fixture.threadId)
    const handle = connected.client.workflow.getHandle(workflowId)
    const client = new TemporalAgentThreadClient(
      connected.client.workflow,
      supersedeWorker.taskQueue,
    )
    const firstCommand = buildUserTurnCommand(fixture, '短一点，三十秒这样，休闲的。')
    const secondCommand = buildUserTurnCommand(
      {
        ...fixture,
        sourceId: `user-source-${randomUUID()}`,
      },
      '短一点，三十秒这样，修仙的。',
    )
    const thirdCommand = buildUserTurnCommand(
      {
        ...fixture,
        sourceId: `user-source-${randomUUID()}`,
      },
      '最终按三十秒修仙短片执行。',
    )
    let latestTurnId: string | null = null
    try {
      const first = await client.submit(firstCommand)
      if (first.outcome !== 'accepted') {
        throw new Error('AGENT_FIRST_CORRECTION_TURN_UNEXPECTEDLY_IGNORED')
      }
      await supersedeWorker.waitForEvent(`started:${first.turn.id}`)

      const second = await client.submit(secondCommand)
      if (second.outcome !== 'accepted') {
        throw new Error('AGENT_SECOND_CORRECTION_TURN_UNEXPECTEDLY_IGNORED')
      }
      const third = await client.submit(thirdCommand)
      if (third.outcome !== 'accepted') {
        throw new Error('AGENT_THIRD_CORRECTION_TURN_UNEXPECTEDLY_IGNORED')
      }
      latestTurnId = third.turn.id

      await supersedeWorker.waitForEvent(`cancelled:${first.turn.id}`)
      await supersedeWorker.waitForEvent(`started:${third.turn.id}`)

      const [turns, thread, continuation] = await Promise.all([
        prisma.projectAgentTurn.findMany({
          where: {
            id: { in: [first.turn.id, second.turn.id, third.turn.id] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        prisma.projectAssistantThread.findUniqueOrThrow({
          where: { id: fixture.threadId },
        }),
        loadInterruptedTurnContinuationInputs(third.turn.id),
      ])
      expect(turns).toHaveLength(3)
      expect(turns.find((turn) => turn.id === first.turn.id)).toMatchObject({
        status: 'cancelled',
        attempt: 1,
        stopReason: 'superseded_by_user_turn',
      })
      expect(turns.find((turn) => turn.id === second.turn.id)).toMatchObject({
        status: 'cancelled',
        attempt: 0,
        stopReason: 'superseded_by_user_turn',
      })
      expect(turns.find((turn) => turn.id === third.turn.id)).toMatchObject({
        status: 'running',
        attempt: 1,
      })
      expect(thread.messagesJson).toEqual([
        firstCommand.userMessage,
        secondCommand.userMessage,
        thirdCommand.userMessage,
      ])
      expect(JSON.stringify(continuation)).toContain('短一点，三十秒这样，休闲的。')
      expect(JSON.stringify(continuation)).toContain('短一点，三十秒这样，修仙的。')

      const eventsBeforeStop = supersedeWorker.readEvents()
      expect(eventsBeforeStop.indexOf(`cancelled:${first.turn.id}`)).toBeLessThan(
        eventsBeforeStop.indexOf(`started:${third.turn.id}`),
      )
      expect(eventsBeforeStop).not.toContain(`started:${second.turn.id}`)

      const cancellation = await client.cancel({
        protocol: 'agent_turn_cancel_v1',
        threadId: fixture.threadId,
        turnId: third.turn.id,
        projectId: fixture.projectId,
        userId: fixture.userId,
        requestId: `cancel-latest-${randomUUID()}`,
        reason: '用户停止最新一轮。',
      })
      expect(cancellation).toMatchObject({
        turnId: third.turn.id,
        status: 'cancelled',
        stopReason: 'user_cancelled',
      })
      // The cancellation Update is not acknowledged until the Activity has
      // exited, so the stop button cannot report success while tools still run.
      expect(supersedeWorker.readEvents()).toContain(`cancelled:${third.turn.id}`)
      await expect(handle.result()).resolves.toMatchObject({
        workflowId,
        threadId: fixture.threadId,
        lastTurn: {
          turnId: third.turn.id,
          status: 'cancelled',
          stopReason: 'user_cancelled',
        },
      })
    } finally {
      const description = await handle.describe().catch(() => null)
      if (description?.status.name === 'RUNNING') {
        if (latestTurnId) {
          await client
            .cancel({
              protocol: 'agent_turn_cancel_v1',
              threadId: fixture.threadId,
              turnId: latestTurnId,
              projectId: fixture.projectId,
              userId: fixture.userId,
              requestId: `cleanup-latest-${randomUUID()}`,
              reason: '测试清理。',
            })
            .catch(() => undefined)
        }
        const current = await handle.describe().catch(() => null)
        if (current?.status.name === 'RUNNING') {
          await handle.terminate('AGENT_SUPERSEDE_TEST_CLEANUP')
        }
      }
      await supersedeWorker.close()
      await connected.close()
      await removeAgentTurnFixture(fixture)
    }
  }, 60_000)

  it('replays approval and cancellation through a new Coordinator execution after HTTP acknowledgement loss', async () => {
    const fixture = await createAgentTurnFixture()
    const connected = await connectTemporalClient()
    const workflowId = buildAgentThreadWorkflowId(fixture.threadId)
    const suffix = randomUUID().replaceAll('-', '')
    const approvalTurnId = `approval-turn-${suffix}`
    const interactionId = `approval-interaction-${suffix}`
    const approvalInput = {
      target: {
        kind: 'character',
        id: `character-${suffix}`,
      },
    }
    const approvalPayload: AgentTurnApprovalPayload = {
      protocol: 'agent_turn_approval_v1',
      runtime: buildAgentTurnRuntimeContract(),
      members: [
        {
          approvalId: `approval-${suffix}`,
          callId: `call-${suffix}`,
          operationId: 'delete_asset',
          input: approvalInput,
          inputHash: hashCanonicalJson(approvalInput),
          toolContractRevision: 'delete_asset/v1',
          operationPlan: null,
        },
      ],
    }
    let latestHandle: WorkflowHandle | null = null
    try {
      await prisma.projectAgentTurn.create({
        data: {
          id: approvalTurnId,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          episodeId: null,
          sourceKind: 'user',
          sourceId: `approval-source-${suffix}`,
          payloadHash: hashCanonicalJson({ suffix, kind: 'approval' }),
          requestId: `approval-turn-request-${suffix}`,
          status: 'waiting_approval',
          attempt: 1,
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 0,
        },
      })
      await prisma.agentTurnInteraction.create({
        data: {
          id: interactionId,
          turnId: approvalTurnId,
          kind: 'approval',
          status: 'pending',
          payloadJson: JSON.parse(JSON.stringify(approvalPayload)) as Prisma.InputJsonValue,
          runState: JSON.stringify({
            $schemaVersion: approvalPayload.runtime.runStateSchemaVersion,
          }),
        },
      })

      const view = await getAgentSessionView({
        projectId: fixture.projectId,
        userId: fixture.userId,
        episodeId: null,
        assistantId: 'workspace-command',
      })
      const parsedView = await parseAgentSessionView(view)
      expect(parsedView.thread?.messages).toEqual([])
      expect(parsedView.pendingInteraction).toMatchObject({
        interactionId,
        kind: 'approval',
        version: 0,
      })

      const approvalCommand: ResolveAgentTurnApprovalCommand = {
        protocol: 'agent_turn_approval_response_v1',
        threadId: fixture.threadId,
        turnId: approvalTurnId,
        interactionId,
        projectId: fixture.projectId,
        userId: fixture.userId,
        requestId: `approval-command-${suffix}`,
        decision: 'reject',
        reason: '不执行这次删除。',
      }
      const committedApproval = await resolveAgentTurnApprovalDecision(approvalCommand)
      expect(committedApproval.resumeRequired).toBe(true)
      await prisma.$transaction([
        prisma.projectAgentTurn.update({
          where: { id: approvalTurnId },
          data: {
            status: 'completed',
            stopReason: 'completed',
            finishedAt: new Date(),
          },
        }),
        prisma.agentTurnInteraction.update({
          where: { id: interactionId },
          data: { runState: null },
        }),
      ])

      const client = new TemporalAgentThreadClient(
        connected.client.workflow,
        requireWorker().taskQueue,
      )
      const approvalReplay = await client.resolveApproval(approvalCommand)
      expect(approvalReplay).toMatchObject({
        payloadHash: hashCanonicalJson(approvalCommand),
        resumeRequired: false,
      })
      latestHandle = connected.client.workflow.getHandle(workflowId)
      await latestHandle.result()

      const divergentApproval = {
        ...approvalCommand,
        reason: '同一 requestId 却换了拒绝理由。',
      }
      const divergentError = await client.resolveApproval(divergentApproval).then(
        () => null,
        (error: unknown) => error,
      )
      expect(divergentError).toBeInstanceOf(WorkflowUpdateFailedError)
      latestHandle = connected.client.workflow.getHandle(workflowId)
      const divergentDescription = await latestHandle.describe()
      if (divergentDescription.status.name === 'RUNNING') {
        await latestHandle.terminate('AGENT_APPROVAL_DIVERGENCE_TEST_COMPLETE')
      }

      const cancelTurnId = `cancel-turn-${suffix}`
      const cancelCommand = {
        protocol: 'agent_turn_cancel_v1' as const,
        threadId: fixture.threadId,
        turnId: cancelTurnId,
        projectId: fixture.projectId,
        userId: fixture.userId,
        requestId: `cancel-command-${suffix}`,
        reason: '用户停止本轮。',
      }
      await prisma.projectAgentTurn.create({
        data: {
          id: cancelTurnId,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          episodeId: null,
          sourceKind: 'user',
          sourceId: `cancel-source-${suffix}`,
          payloadHash: hashCanonicalJson({ suffix, kind: 'cancel' }),
          requestId: `cancel-turn-request-${suffix}`,
          status: 'queued',
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 0,
        },
      })
      const committedCancellation = await cancelAgentTurn(cancelCommand)
      const cancellationReplay = await client.cancel(cancelCommand)
      expect(cancellationReplay).toEqual(committedCancellation)
      latestHandle = connected.client.workflow.getHandle(workflowId)
      await latestHandle.result()
    } finally {
      if (latestHandle) {
        const description = await latestHandle.describe()
        if (description.status.name === 'RUNNING') {
          await latestHandle.terminate('AGENT_CONTROL_ACK_LOSS_TEST_CLEANUP')
        }
      }
      await connected.close()
      await removeAgentTurnFixture(fixture)
    }
  }, 90_000)

  it('atomically rejects a pending approval and closes its model call before admitting a successor user Turn', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const priorTurnId = `approval-supersede-turn-${suffix}`
    const interactionId = `approval-supersede-interaction-${suffix}`
    const callId = `approval-supersede-call-${suffix}`
    try {
      const pendingCall: AgentInputItem = {
        type: 'function_call',
        callId,
        name: 'delete_asset',
        status: 'completed',
        arguments: JSON.stringify({ assetId: `asset-${suffix}` }),
      } as AgentInputItem
      const pendingApprovalPayload: AgentTurnApprovalPayload = {
        protocol: 'agent_turn_approval_v1',
        runtime: buildAgentTurnRuntimeContract(),
        members: [
          {
            approvalId: `approval-${suffix}`,
            callId,
            operationId: 'delete_asset',
            input: { assetId: `asset-${suffix}` },
            inputHash: hashCanonicalJson({ assetId: `asset-${suffix}` }),
            toolContractRevision: 'delete_asset/v1',
            operationPlan: null,
          },
        ],
      }
      await prisma.projectAssistantThread.update({
        where: { id: fixture.threadId },
        data: {
          modelHistoryJson: serializeProjectAssistantModelHistory([pendingCall]),
          modelHistoryVersion: 1,
        },
      })
      await prisma.projectAgentTurn.create({
        data: {
          id: priorTurnId,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          sourceKind: 'user',
          sourceId: `approval-supersede-source-${suffix}`,
          payloadHash: hashCanonicalJson({ suffix, kind: 'superseded' }),
          requestId: `approval-supersede-request-${suffix}`,
          status: 'waiting_approval',
          attempt: 1,
          executionOwnerId: `approval-supersede-owner-${suffix}`,
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 1,
        },
      })
      await prisma.agentTurnInteraction.create({
        data: {
          id: interactionId,
          turnId: priorTurnId,
          kind: 'approval',
          status: 'pending',
          payloadJson: JSON.parse(JSON.stringify(pendingApprovalPayload)) as Prisma.InputJsonValue,
          runState: JSON.stringify({
            $schemaVersion: buildAgentTurnRuntimeContract().runStateSchemaVersion,
          }),
        },
      })

      const successor = buildUserTurnCommand(fixture, '不要执行删除，改为告诉我还有哪些安全方案。')
      const admission = await acceptAgentTurnCommand(buildAgentTurnEnvelope(successor))
      expect(admission.outcome).toBe('accepted')

      const [priorTurn, interaction, successorTurn, thread] = await Promise.all([
        prisma.projectAgentTurn.findUniqueOrThrow({
          where: { id: priorTurnId },
        }),
        prisma.agentTurnInteraction.findUniqueOrThrow({
          where: { id: interactionId },
        }),
        prisma.projectAgentTurn.findUniqueOrThrow({
          where: {
            threadId_sourceKind_sourceId: {
              threadId: fixture.threadId,
              sourceKind: 'user',
              sourceId: fixture.sourceId,
            },
          },
        }),
        prisma.projectAssistantThread.findUniqueOrThrow({
          where: { id: fixture.threadId },
        }),
      ])
      expect(priorTurn).toMatchObject({
        status: 'cancelled',
        stopReason: 'superseded_by_user_turn',
        modelHistoryBaseVersion: 2,
      })
      expect(interaction).toMatchObject({
        status: 'rejected',
        runState: null,
        version: 1,
      })
      expect(interaction.responseJson).toMatchObject({
        decision: 'reject',
        via: 'user_message',
        successorTurnId: successorTurn.id,
      })
      expect(successorTurn).toMatchObject({
        status: 'queued',
        modelHistoryBaseVersion: 2,
      })
      expect(thread.modelHistoryVersion).toBe(2)
      expect(thread.messagesJson).toEqual([successor.userMessage])
      expect(parseProjectAssistantModelHistory(thread.modelHistoryJson)).toContainEqual(
        expect.objectContaining({
          type: 'function_call_result',
          callId,
          name: 'delete_asset',
          status: 'completed',
        }),
      )
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('returns committed terminal facts after Activity ACK loss and settles an unclaimed queued Turn as interrupted', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const ownerId = `activity-loss-owner-${suffix}`
    const completedTurnId = `activity-loss-completed-${suffix}`
    const queuedTurnId = `activity-loss-queued-${suffix}`
    const createTurn = async (params: {
      id: string
      status: 'completed' | 'queued'
      owner: string | null
    }) =>
      await prisma.projectAgentTurn.create({
        data: {
          id: params.id,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          sourceKind: 'task_follow_up',
          sourceId: `source-${params.id}`,
          payloadHash: hashCanonicalJson(params),
          requestId: `request-${params.id}`.slice(0, 128),
          status: params.status,
          attempt: params.status === 'completed' ? 1 : 0,
          executionOwnerId: params.owner,
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 0,
          stopReason: params.status === 'completed' ? 'completed' : null,
          finishedAt: params.status === 'completed' ? new Date() : null,
        },
      })
    try {
      await createTurn({
        id: completedTurnId,
        status: 'completed',
        owner: ownerId,
      })
      await createTurn({ id: queuedTurnId, status: 'queued', owner: null })
      const committed = await settleAgentTurnAfterActivityLoss({
        turnId: completedTurnId,
        executionOwnerId: ownerId,
        errorCode: 'GENERATION_FAILED',
        errorMessage: 'Generation failed',
      })
      expect(committed).toMatchObject({
        id: completedTurnId,
        status: 'completed',
        stopReason: 'completed',
      })
      const interrupted = await settleAgentTurnAfterActivityLoss({
        turnId: queuedTurnId,
        executionOwnerId: ownerId,
        errorCode: 'GENERATION_FAILED',
        errorMessage: 'Generation failed',
      })
      expect(interrupted).toMatchObject({
        id: queuedTurnId,
        status: 'interrupted',
        stopReason: 'activity_lost',
      })
      expect(
        await prisma.projectAgentTurn.findUniqueOrThrow({
          where: { id: queuedTurnId },
        }),
      ).toMatchObject({
        status: 'interrupted',
        executionOwnerId: ownerId,
      })
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('recovers one foreground Turn before older background follow-ups', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const backgroundId = `recovery-background-${suffix}`
    const foregroundId = `recovery-foreground-${suffix}`
    try {
      await prisma.projectAgentTurn.createMany({
        data: [
          {
            id: backgroundId,
            threadId: fixture.threadId,
            projectId: fixture.projectId,
            userId: fixture.userId,
            sourceKind: 'task_follow_up',
            sourceId: `batch-${suffix}`,
            payloadHash: hashCanonicalJson({ kind: 'background', suffix }),
            requestId: `background-request-${suffix}`,
            status: 'queued',
            contextJson: {
              locale: 'zh',
              episodeId: null,
              selectedScopeRef: null,
              selectedAssetId: null,
            },
            modelHistoryBaseVersion: 0,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            id: foregroundId,
            threadId: fixture.threadId,
            projectId: fixture.projectId,
            userId: fixture.userId,
            sourceKind: 'user',
            sourceId: `user-${suffix}`,
            payloadHash: hashCanonicalJson({ kind: 'foreground', suffix }),
            requestId: `foreground-request-${suffix}`,
            status: 'queued',
            userMessageJson: {
              id: `foreground-message-${suffix}`,
              role: 'user',
              parts: [{ type: 'text', text: '优先处理这个用户决定。' }],
            },
            contextJson: {
              locale: 'zh',
              episodeId: null,
              selectedScopeRef: null,
              selectedAssetId: null,
            },
            modelHistoryBaseVersion: 0,
            createdAt: new Date('2026-01-01T00:00:01.000Z'),
          },
        ],
      })

      const recovered = await recoverAgentThreadCoordinatorState(fixture.threadId)
      expect(recovered.queuedTurns.map((turn) => turn.id)).toEqual([foregroundId, backgroundId])
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('projects the durable source of an unfinished Turn into its successor', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const priorTurnId = `source-continuity-prior-${suffix}`
    const currentTurnId = `source-continuity-current-${suffix}`
    const priorStartedAt = new Date('2026-01-01T00:00:00.000Z')
    const currentStartedAt = new Date('2026-01-01T00:00:01.000Z')
    try {
      await prisma.projectAgentTurn.createMany({
        data: [
          {
            id: priorTurnId,
            threadId: fixture.threadId,
            projectId: fixture.projectId,
            userId: fixture.userId,
            sourceKind: 'user',
            sourceId: `prior-user-${suffix}`,
            payloadHash: hashCanonicalJson({ kind: 'prior', suffix }),
            requestId: `prior-request-${suffix}`,
            status: 'interrupted',
            attempt: 1,
            startedAt: priorStartedAt,
            finishedAt: priorStartedAt,
            stopReason: 'activity_lost',
            userMessageJson: {
              id: `prior-message-${suffix}`,
              role: 'user',
              parts: [{ type: 'text', text: '把第三幕的主色改成红色。' }],
            },
            contextJson: {
              locale: 'zh',
              episodeId: null,
              selectedScopeRef: null,
              selectedAssetId: null,
            },
            modelHistoryBaseVersion: 0,
          },
          {
            id: currentTurnId,
            threadId: fixture.threadId,
            projectId: fixture.projectId,
            userId: fixture.userId,
            sourceKind: 'user',
            sourceId: `current-user-${suffix}`,
            payloadHash: hashCanonicalJson({ kind: 'current', suffix }),
            requestId: `current-request-${suffix}`,
            status: 'running',
            attempt: 1,
            executionOwnerId: `current-owner-${suffix}`,
            startedAt: currentStartedAt,
            userMessageJson: {
              id: `current-message-${suffix}`,
              role: 'user',
              parts: [{ type: 'text', text: '继续。' }],
            },
            contextJson: {
              locale: 'zh',
              episodeId: null,
              selectedScopeRef: null,
              selectedAssetId: null,
            },
            modelHistoryBaseVersion: 0,
          },
        ],
      })

      const inputs = await loadInterruptedTurnContinuationInputs(currentTurnId)
      expect(JSON.stringify(inputs)).toContain('把第三幕的主色改成红色。')
      expect(JSON.stringify(inputs)).toContain(priorTurnId)
      expect(JSON.stringify(inputs)).toContain('interrupted_turn_continuation_v3')
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('closes checkpointed approval calls when the suspended Turn is cancelled', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const turnId = `approval-cancel-turn-${suffix}`
    const interactionId = `approval-cancel-interaction-${suffix}`
    const callId = `approval-cancel-call-${suffix}`
    const pendingCall: AgentInputItem = {
      type: 'function_call',
      callId,
      name: 'delete_asset',
      status: 'completed',
      arguments: JSON.stringify({ assetId: `asset-${suffix}` }),
    } as AgentInputItem
    const payload: AgentTurnApprovalPayload = {
      protocol: 'agent_turn_approval_v1',
      runtime: buildAgentTurnRuntimeContract(),
      members: [
        {
          approvalId: `approval-cancel-${suffix}`,
          callId,
          operationId: 'delete_asset',
          input: { assetId: `asset-${suffix}` },
          inputHash: hashCanonicalJson({ assetId: `asset-${suffix}` }),
          toolContractRevision: 'delete_asset/v1',
          operationPlan: null,
        },
      ],
    }
    try {
      await prisma.projectAssistantThread.update({
        where: { id: fixture.threadId },
        data: {
          modelHistoryJson: serializeProjectAssistantModelHistory([
            {
              role: 'user',
              content: '删除这个资产。',
            },
            pendingCall,
          ]),
          modelHistoryVersion: 1,
        },
      })
      await prisma.projectAgentTurn.create({
        data: {
          id: turnId,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          sourceKind: 'user',
          sourceId: `approval-cancel-source-${suffix}`,
          payloadHash: hashCanonicalJson({ kind: 'approval-cancel', suffix }),
          requestId: `approval-cancel-request-${suffix}`,
          status: 'waiting_approval',
          attempt: 1,
          executionOwnerId: `approval-cancel-owner-${suffix}`,
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 1,
        },
      })
      await prisma.agentTurnInteraction.create({
        data: {
          id: interactionId,
          turnId,
          kind: 'approval',
          status: 'pending',
          payloadJson: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
          runState: JSON.stringify({
            $schemaVersion: payload.runtime.runStateSchemaVersion,
          }),
        },
      })

      await cancelAgentTurn({
        protocol: 'agent_turn_cancel_v1',
        threadId: fixture.threadId,
        turnId,
        projectId: fixture.projectId,
        userId: fixture.userId,
        requestId: `cancel-approval-request-${suffix}`,
        reason: '用户取消审批中的操作。',
      })

      const [thread, interaction] = await Promise.all([
        prisma.projectAssistantThread.findUniqueOrThrow({
          where: { id: fixture.threadId },
        }),
        prisma.agentTurnInteraction.findUniqueOrThrow({
          where: { id: interactionId },
        }),
      ])
      expect(thread.modelHistoryVersion).toBe(2)
      expect(parseProjectAssistantModelHistory(thread.modelHistoryJson)).toContainEqual(
        expect.objectContaining({
          type: 'function_call_result',
          callId,
          name: 'delete_asset',
        }),
      )
      expect(interaction).toMatchObject({
        status: 'cancelled',
        runState: null,
      })
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('closes only unresolved calls across multiple approval rounds when resume fails', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const turnId = `approval-failure-turn-${suffix}`
    const firstInteractionId = `approval-failure-first-interaction-${suffix}`
    const secondInteractionId = `approval-failure-second-interaction-${suffix}`
    const firstCallId = `approval-failure-first-call-${suffix}`
    const secondCallId = `approval-failure-second-call-${suffix}`
    const executionOwnerId = `approval-failure-owner-${suffix}`
    const firstPayload: AgentTurnApprovalPayload = {
      protocol: 'agent_turn_approval_v1',
      runtime: buildAgentTurnRuntimeContract(),
      members: [
        {
          approvalId: `approval-failure-first-${suffix}`,
          callId: firstCallId,
          operationId: 'delete_asset',
          input: { assetId: `first-asset-${suffix}` },
          inputHash: hashCanonicalJson({ assetId: `first-asset-${suffix}` }),
          toolContractRevision: 'delete_asset/v1',
          operationPlan: null,
        },
      ],
    }
    const secondPayload: AgentTurnApprovalPayload = {
      protocol: 'agent_turn_approval_v1',
      runtime: buildAgentTurnRuntimeContract(),
      members: [
        {
          approvalId: `approval-failure-second-${suffix}`,
          callId: secondCallId,
          operationId: 'delete_asset',
          input: { assetId: `second-asset-${suffix}` },
          inputHash: hashCanonicalJson({ assetId: `second-asset-${suffix}` }),
          toolContractRevision: 'delete_asset/v1',
          operationPlan: null,
        },
      ],
    }
    try {
      await prisma.projectAssistantThread.update({
        where: { id: fixture.threadId },
        data: {
          modelHistoryJson: serializeProjectAssistantModelHistory([
            {
              type: 'function_call',
              callId: firstCallId,
              name: 'delete_asset',
              status: 'completed',
              arguments: JSON.stringify({ assetId: `first-asset-${suffix}` }),
            } as AgentInputItem,
            {
              type: 'function_call_result',
              callId: firstCallId,
              name: 'delete_asset',
              status: 'completed',
              output: { type: 'text', text: 'First approval completed.' },
            } as AgentInputItem,
            {
              type: 'function_call',
              callId: secondCallId,
              name: 'delete_asset',
              status: 'completed',
              arguments: JSON.stringify({ assetId: `second-asset-${suffix}` }),
            } as AgentInputItem,
          ]),
          modelHistoryVersion: 1,
        },
      })
      await prisma.projectAgentTurn.create({
        data: {
          id: turnId,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          sourceKind: 'user',
          sourceId: `approval-failure-source-${suffix}`,
          payloadHash: hashCanonicalJson({ kind: 'approval-failure', suffix }),
          requestId: `approval-failure-request-${suffix}`,
          status: 'running',
          attempt: 1,
          executionOwnerId,
          startedAt: new Date(),
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 1,
        },
      })
      await prisma.agentTurnInteraction.createMany({
        data: [
          {
            id: firstInteractionId,
            turnId,
            kind: 'approval',
            status: 'approved',
            payloadJson: JSON.parse(JSON.stringify(firstPayload)) as Prisma.InputJsonValue,
            responseJson: {
              protocol: 'agent_turn_approval_response_v1',
              requestId: `approval-failure-first-decision-${suffix}`,
              decision: 'approve',
              reason: null,
              grants: [],
            },
            runState: JSON.stringify({
              $schemaVersion: firstPayload.runtime.runStateSchemaVersion,
            }),
            version: 1,
            resolvedAt: new Date(),
          },
          {
            id: secondInteractionId,
            turnId,
            kind: 'approval',
            status: 'approved',
            payloadJson: JSON.parse(JSON.stringify(secondPayload)) as Prisma.InputJsonValue,
            responseJson: {
              protocol: 'agent_turn_approval_response_v1',
              requestId: `approval-failure-second-decision-${suffix}`,
              decision: 'approve',
              reason: null,
              grants: [],
            },
            runState: JSON.stringify({
              $schemaVersion: secondPayload.runtime.runStateSchemaVersion,
            }),
            version: 1,
            resolvedAt: new Date(),
          },
        ],
      })

      await failAgentTurnExecution({
        turnId,
        executionOwnerId,
        errorCode: 'GENERATION_FAILED',
        errorMessage: 'Generation failed',
      })

      const [thread, interactions] = await Promise.all([
        prisma.projectAssistantThread.findUniqueOrThrow({
          where: { id: fixture.threadId },
        }),
        prisma.agentTurnInteraction.findMany({
          where: { id: { in: [firstInteractionId, secondInteractionId] } },
        }),
      ])
      expect(thread.modelHistoryVersion).toBe(2)
      const history = parseProjectAssistantModelHistory(thread.modelHistoryJson)
      expect(history).toContainEqual(
        expect.objectContaining({
          type: 'function_call_result',
          callId: secondCallId,
        }),
      )
      expect(
        history.filter(
          (item) =>
            'type' in item &&
            item.type === 'function_call_result' &&
            'callId' in item &&
            item.callId === firstCallId,
        ),
      ).toHaveLength(1)
      expect(interactions).toHaveLength(2)
      expect(interactions.every((interaction) => interaction.runState === null)).toBe(true)
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('exact-replays a clear receipt and rejects another request identity', async () => {
    const fixture = await createAgentTurnFixture()
    const suffix = randomUUID().replaceAll('-', '')
    const turnId = `clear-receipt-turn-${suffix}`
    const command = {
      protocol: 'agent_thread_clear_v1' as const,
      threadId: fixture.threadId,
      projectId: fixture.projectId,
      userId: fixture.userId,
      episodeId: null,
      assistantId: 'workspace-command' as const,
      requestId: `clear-receipt-request-${suffix}`,
    }
    try {
      await prisma.projectAgentTurn.create({
        data: {
          id: turnId,
          threadId: fixture.threadId,
          projectId: fixture.projectId,
          userId: fixture.userId,
          sourceKind: 'user',
          sourceId: `clear-receipt-source-${suffix}`,
          payloadHash: hashCanonicalJson({ kind: 'clear', suffix }),
          requestId: `clear-turn-request-${suffix}`,
          status: 'queued',
          contextJson: {
            locale: 'zh',
            episodeId: null,
            selectedScopeRef: null,
            selectedAssetId: null,
          },
          modelHistoryBaseVersion: 0,
        },
      })

      const first = await clearAgentThread(command)
      const replay = await clearAgentThread(command)
      expect(replay).toEqual(first)
      expect(first.cancelledTurnIds).toEqual([turnId])
      await expect(
        clearAgentThread({
          ...command,
          requestId: `different-clear-request-${suffix}`,
        }),
      ).rejects.toThrow('AGENT_THREAD_CLEAR_REPLAY_DIVERGED')
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })

  it('rejects a cross-project episode before materializing a Thread', async () => {
    const fixture = await createAgentTurnFixture()
    try {
      const otherProject = await createFixtureProject(fixture.userId)
      const foreignEpisode = await createFixtureEpisode(otherProject.id)

      await expect(
        getOrCreateProjectAssistantThread({
          projectId: fixture.projectId,
          userId: fixture.userId,
          episodeId: foreignEpisode.id,
          assistantId: 'workspace-command',
        }),
      ).rejects.toThrow('PROJECT_ASSISTANT_EPISODE_SCOPE_INVALID')

      expect(
        await prisma.projectAssistantThread.count({
          where: {
            projectId: fixture.projectId,
            episodeId: foreignEpisode.id,
          },
        }),
      ).toBe(0)
    } finally {
      await removeAgentTurnFixture(fixture)
    }
  })
})
