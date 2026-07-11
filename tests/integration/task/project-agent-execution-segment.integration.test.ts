import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import {
  createProjectAgentUserTurnRun,
  getProjectAgentRun,
} from '@/lib/project-agent/runs'
import {
  consumeProjectAgentApprovalInterruption,
} from '@/lib/project-agent/interruptions'
import {
  prepareProjectAgentApprovalExecutionHandoff,
  settleProjectAgentPreparedApprovalHandoff,
} from '@/lib/project-agent/execution-handoff'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  createProjectAgentExecutionSegment,
  projectAgentExecutionStartedIdempotencyKey,
} from '@/lib/project-agent/execution-segment'

const PREFIX = 'execution-segment-integration:'

async function settleApprovalHandoff(
  input: Omit<Parameters<typeof prepareProjectAgentApprovalExecutionHandoff>[0], 'executionSegmentId'> & {
    message: UIMessage
  },
) {
  const { message, ...prepareInput } = input
  const handoff = await prepareProjectAgentApprovalExecutionHandoff({
    ...prepareInput,
    executionSegmentId: `test-approval:${input.approvalId}`,
  })
  return await settleProjectAgentPreparedApprovalHandoff({
    executionFence: input.executionFence,
    handoff,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId,
    message,
  })
}

describe('Project Agent execution segment DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('resumes a consumed decision on the same Run without colliding with the initial user execution', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const runId = `${PREFIX}run`
    const { run: createdRun } = await createProjectAgentUserTurnRun({
      runId,
      requestId: `${PREFIX}request`,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: `${PREFIX}message`,
        role: 'user',
        parts: [{ type: 'text', text: 'start' }],
      },
    })
    const userSegment = createProjectAgentExecutionSegment({ kind: 'user_turn', runId })
    await appendProjectAgentEvents({
      scope: { projectId: project.id, userId: user.id, assistantId: 'workspace-command' },
      events: [{
        runFence: createProjectAgentRunFence(createdRun),
        idempotencyKey: projectAgentExecutionStartedIdempotencyKey(userSegment.id),
        event: {
          kind: 'run.execution_started',
          runId,
          executionSegmentId: userSegment.id,
          controlKind: userSegment.controlKind,
        },
      }],
    })

    const afterUserExecution = await getProjectAgentRun({
      projectId: project.id,
      userId: user.id,
      runId,
    })
    if (!afterUserExecution) throw new Error('EXPECTED_RUN')
    const suspension = await settleApprovalHandoff({
      executionFence: {
        runFence: createProjectAgentRunFence(afterUserExecution),
        signal: new AbortController().signal,
      },
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'generate_edit_style_previews',
      approvalId: `${PREFIX}approval`,
      toolCallId: `${PREFIX}tool`,
      runState: '{"checkpoint":"approval"}',
      message: {
        id: `${PREFIX}approval-message`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'approval required' }],
      },
    })
    if (suspension.kind !== 'approval') throw new Error('EXPECTED_APPROVAL_SUSPENSION')
    const interruptionId = suspension.interruptionId
    const consumed = await consumeProjectAgentApprovalInterruption({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      runId,
      interruptionId,
      response: { approved: true },
      visibleMessages: [{
        id: `${PREFIX}approval-visible-message`,
        role: 'user',
        parts: [{ type: 'text', text: 'approve' }],
      }],
    })
    expect(consumed?.id).toBe(interruptionId)

    const resumedRun = await getProjectAgentRun({
      projectId: project.id,
      userId: user.id,
      runId,
    })
    if (!resumedRun) throw new Error('EXPECTED_RESUMED_RUN')
    const decisionSegment = createProjectAgentExecutionSegment({
      kind: 'approval_response',
      interruptionId,
    })
    await appendProjectAgentEvents({
      scope: { projectId: project.id, userId: user.id, assistantId: 'workspace-command' },
      events: [{
        runFence: createProjectAgentRunFence(resumedRun),
        idempotencyKey: projectAgentExecutionStartedIdempotencyKey(decisionSegment.id),
        event: {
          kind: 'run.execution_started',
          runId,
          executionSegmentId: decisionSegment.id,
          controlKind: decisionSegment.controlKind,
        },
      }],
    })

    const [keys, consumedInterruption] = await Promise.all([
      prisma.projectAgentEvent.findMany({
        where: { runId, kind: 'run.execution_started' },
        orderBy: { id: 'asc' },
        select: { idempotencyKey: true },
      }),
      prisma.projectAgentInterruption.findUniqueOrThrow({
        where: { id: interruptionId },
        select: { status: true, runState: true },
      }),
    ])
    expect(keys).toEqual([
      { idempotencyKey: projectAgentExecutionStartedIdempotencyKey(userSegment.id) },
      { idempotencyKey: projectAgentExecutionStartedIdempotencyKey(decisionSegment.id) },
    ])
    expect(consumedInterruption).toEqual({ status: 'consumed', runState: null })
    const thread = await prisma.projectAssistantThread.findUniqueOrThrow({
      where: {
        projectId_userId_assistantId_scopeRef: {
          projectId: project.id,
          userId: user.id,
          assistantId: 'workspace-command',
          scopeRef: `project:${project.id}`,
        },
      },
    })
    expect(thread.messagesJson).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `${PREFIX}message` }),
      expect.objectContaining({ id: `${PREFIX}approval-message` }),
      expect.objectContaining({ id: `${PREFIX}approval-visible-message` }),
    ]))
  })

  it('rejects a durable replay of the same execution segment before model or tool execution can run twice', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const runId = `${PREFIX}segment-replay-run`
    const { run } = await createProjectAgentUserTurnRun({
      runId,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      requestId: `${PREFIX}segment-replay-request`,
      message: {
        id: `${PREFIX}segment-replay-message`,
        role: 'user',
        parts: [{ type: 'text', text: 'start' }],
      },
    })
    const segment = createProjectAgentExecutionSegment({ kind: 'user_turn', runId })
    const append = () => appendProjectAgentEvents({
      scope: { projectId: project.id, userId: user.id, assistantId: 'workspace-command' },
      events: [{
        runFence: createProjectAgentRunFence(run),
        idempotencyKey: projectAgentExecutionStartedIdempotencyKey(segment.id),
        event: {
          kind: 'run.execution_started' as const,
          runId,
          executionSegmentId: segment.id,
          controlKind: segment.controlKind,
        },
      }],
    })
    await append()
    await expect(append()).rejects.toThrow('PROJECT_AGENT_EXECUTION_SEGMENT_ALREADY_STARTED')
    expect(await prisma.projectAgentEvent.count({
      where: { runId, kind: 'run.execution_started' },
    })).toBe(1)
  })
})
