import { randomUUID } from 'node:crypto'
import {
  WorkflowUpdateFailedError,
  type WorkflowHandle,
} from '@temporalio/client'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  resolveAgentTurnApprovalDecision,
  type AgentTurnApprovalPayload,
  type ResolveAgentTurnApprovalCommand,
} from '@/lib/agent-turn/approval'
import { cancelAgentTurn } from '@/lib/agent-turn/lifecycle'
import { buildAgentTurnRuntimeContract } from '@/lib/agent-turn/runtime-contract'
import {
  getAgentSessionView,
} from '@/lib/agent-turn/view'
import { parseAgentSessionView } from '@/lib/agent-turn/view-contract'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { buildAgentTurnEnvelope } from '@/lib/agent-turn/identity'
import { getOrCreateProjectAssistantThread } from '@/lib/project-agent/persistence'
import {
  TemporalAgentThreadClient,
  TemporalAgentTurnCommandConflictError,
} from '@/lib/temporal/agent-thread/client'
import { connectTemporalClient } from '@/lib/temporal/client'
import { buildAgentThreadWorkflowId } from '@/lib/temporal/identity'
import {
  createFixtureEpisode,
  createFixtureProject,
} from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'
import {
  startAgentAdmissionWorker,
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
      const original = buildUserTurnCommand(
        fixture,
        '请为这个项目整理一个导演方案。',
      )
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

      const divergent = buildUserTurnCommand(
        fixture,
        '这是同一个来源身份，但内容已经被篡改。',
      )
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
      expect(
        acceptedUpdateCount(history, originalEnvelope.commandId),
      ).toBe(1)
      // Temporal compacts retry history by retaining the final started
      // attempt. `2` proves the post-commit failure caused a real retry; the
      // harness latch above proves the first production commit was reached.
      expect(agentActivityAttempts(history, 'admitAgentTurn')).toEqual([2])
    } finally {
      if (handle) {
        await handle.terminate('AGENT_ADMISSION_DURABILITY_TEST_COMPLETE')
        const closed = await handle.describe()
        if (closed.status.name !== 'TERMINATED') {
          throw new Error(
            `AGENT_ADMISSION_WORKFLOW_NOT_TERMINATED:${closed.status.name}`,
          )
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
      const command = buildUserTurnCommand(
        fixture,
        '请开始一个会被真实 Worker 丢失打断的 Turn。',
      )
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
      settlementWorker = await startAgentSettlementWorker(
        killableWorker.taskQueue,
      )
      const result = await handle.result()
      expect(result).toMatchObject({
        workflowId,
        threadId: fixture.threadId,
        lastTurn: {
          turnId: receipt.turn.id,
          status: 'interrupted',
          stopReason: 'activity_lost',
          errorCode: 'AGENT_TURN_ACTIVITY_LOST',
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
        errorCode: 'AGENT_TURN_ACTIVITY_LOST',
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
      members: [{
        approvalId: `approval-${suffix}`,
        callId: `call-${suffix}`,
        operationId: 'delete_asset',
        input: approvalInput,
        inputHash: hashCanonicalJson(approvalInput),
        toolContractRevision: 'delete_asset/v1',
        operationPlan: null,
      }],
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
          payloadJson: JSON.parse(
            JSON.stringify(approvalPayload),
          ) as Prisma.InputJsonValue,
          runState: JSON.stringify({
            $schemaVersion:
              approvalPayload.runtime.runStateSchemaVersion,
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
      const committedApproval =
        await resolveAgentTurnApprovalDecision(approvalCommand)
      expect(committedApproval.resumeRequired).toBe(true)
      await prisma.projectAgentTurn.update({
        where: { id: approvalTurnId },
        data: {
          status: 'completed',
          stopReason: 'completed',
          finishedAt: new Date(),
        },
      })

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
      const divergentError = await client.resolveApproval(
        divergentApproval,
      ).then(
        () => null,
        (error: unknown) => error,
      )
      expect(divergentError).toBeInstanceOf(WorkflowUpdateFailedError)
      latestHandle = connected.client.workflow.getHandle(workflowId)
      const divergentDescription = await latestHandle.describe()
      if (divergentDescription.status.name === 'RUNNING') {
        await latestHandle.terminate(
          'AGENT_APPROVAL_DIVERGENCE_TEST_COMPLETE',
        )
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
          await latestHandle.terminate(
            'AGENT_CONTROL_ACK_LOSS_TEST_CLEANUP',
          )
        }
      }
      await connected.close()
      await removeAgentTurnFixture(fixture)
    }
  }, 90_000)

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
