import { beforeEach, describe, expect, it, vi } from 'vitest'

type ClaimMockResult = Awaited<ReturnType<
  (typeof import('@/lib/project-agent/waits'))['claimProjectAgentWaitContinuation']
>>

const waitMock = vi.hoisted(() => ({
  claimProjectAgentWaitContinuation: vi.fn(async (): Promise<ClaimMockResult> => ({
    status: 'claimed' as const,
    projectId: 'project-1',
    userId: 'user-1',
    episodeId: 'episode-1',
    followUp: {
      runId: 'run-1', activityId: 'activity-1', followUpActivityId: 'outbox-1',
      waitId: 'wait-1', followUpKey: 'follow-up-key-1', followUpMode: 'resume_agent',
      operationId: 'plan_chapters', taskIds: ['task-1'], failedTaskIds: [], canceledTaskIds: [],
      failedTasks: [], terminalStatus: 'completed', total: 1, successCount: 1,
      failedCount: 0, canceledCount: 0, claimId: 'owner-1', commandId: 'outbox-1',
    },
  })),
  startProjectAgentWaitFollowUp: vi.fn(async (input: { commandId: string; claimOwner: string }) => ({
    runId: 'run-1', activityId: 'activity-1', followUpActivityId: input.commandId,
    waitId: 'wait-1', followUpKey: 'follow-up-key-1', followUpMode: 'resume_agent',
    operationId: 'plan_chapters', taskIds: ['task-1'], failedTaskIds: [], canceledTaskIds: [],
    failedTasks: [], terminalStatus: 'completed', total: 1, successCount: 1,
    failedCount: 0, canceledCount: 0, claimId: input.claimOwner, commandId: input.commandId,
  })),
  beginProjectAgentWaitContinuationExecution: vi.fn(async (): Promise<'started' | 'already_started' | 'settled'> => 'started'),
  loadProjectAgentWaitContinuationCheckpoint: vi.fn(async (): Promise<{
    commandId: string
    waitId: string
    runId: string
    outcome: 'completed'
    messageId: string
  } | null> => null),
  checkpointProjectAgentWaitFollowUp: vi.fn(async (input: {
    commandId: string
    outcome: 'completed' | 'outcome_unknown' | 'delivery_exhausted'
    message: { id: string }
  }) => ({
    commandId: input.commandId,
    waitId: 'wait-1',
    runId: 'run-1',
    outcome: input.outcome,
    messageId: input.message.id,
  })),
  finalizeProjectAgentWaitFollowUp: vi.fn(async () => undefined),
  releaseProjectAgentWaitContinuationClaim: vi.fn(async () => true),
  extendProjectAgentWaitContinuationClaim: vi.fn(async () => true),
}))

const runMock = vi.hoisted(() => ({
  getProjectAgentRun: vi.fn(async () => ({
    id: 'run-1', projectId: 'project-1', userId: 'user-1', assistantId: 'workspace-command',
    scopeRef: 'episode:episode-1', episodeId: 'episode-1', requestId: 'request-1',
    status: 'awaiting_task', controlKind: 'user_turn', runVersion: 1, eventSeq: BigInt(1),
    heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
  })),
}))

const runtimeMock = vi.hoisted(() => ({
  createProjectAgentChatResponse: vi.fn(async (input: {
    request: Request
    ownershipSignal?: AbortSignal | null
    continuationClaim?: {
      waitId: string
      commandId: string
      claimOwner: string
    } | null
    settleTaskFollowUp?: (settlement: {
      outcome: 'completed'
      message: { id: string; role: 'assistant'; parts: Array<{ type: 'text'; text: string }> }
    }) => Promise<void>
  }) => {
    await input.settleTaskFollowUp?.({
      outcome: 'completed',
      message: {
        id: 'workspace-assistant-run:user_turn:run-1:outbox-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }],
      },
    })
    return new Response('ok')
  }),
}))

vi.mock('@/lib/project-agent/waits', () => waitMock)
vi.mock('@/lib/project-agent/runs', () => runMock)
vi.mock('@/lib/project-agent/run-lock', () => ({
  acquireProjectAgentRunLock: vi.fn(async () => ({ key: 'lock-key', token: 'lock-token', runId: 'run-1' })),
  safelyReleaseProjectAgentRunLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/project-agent/persistence', () => ({
  loadProjectAssistantThread: vi.fn(async () => ({ messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'start' }] }] })),
}))
vi.mock('@/lib/project-agent/runtime', () => runtimeMock)
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn() })) }))

import {
  runProjectAgentWaitContinuationCommand,
  settleProjectAgentWaitContinuationDeliveryExhausted,
} from '@/lib/project-agent/server-follow-up'

describe('project agent durable server follow-up', () => {
  beforeEach(() => vi.clearAllMocks())

  it('settles the claimed wait only through the runtime persistence settlement callback', async () => {
    await runProjectAgentWaitContinuationCommand({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')

    expect(runtimeMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        headers: expect.objectContaining({}),
      }),
      control: expect.objectContaining({ kind: 'task_follow_up' }),
      ownershipSignal: expect.any(AbortSignal),
      continuationClaim: {
        waitId: 'wait-1',
        commandId: 'outbox-1',
        claimOwner: expect.any(String),
      },
      settleTaskFollowUp: expect.any(Function),
    }))
    const runtimeInput = runtimeMock.createProjectAgentChatResponse.mock.calls[0]?.[0]
    expect(runtimeInput?.request.headers.get('x-request-id')).toBe('outbox-1')
    expect(waitMock.finalizeProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1', commandId: 'outbox-1',
    }))
    expect(waitMock.checkpointProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1', commandId: 'outbox-1', outcome: 'completed',
      message: expect.objectContaining({ id: 'workspace-assistant-run:user_turn:run-1:outbox-1' }),
    }))
    expect(waitMock.checkpointProjectAgentWaitFollowUp.mock.invocationCallOrder[0])
      .toBeLessThan(waitMock.finalizeProjectAgentWaitFollowUp.mock.invocationCallOrder[0])
    expect(waitMock.releaseProjectAgentWaitContinuationClaim).not.toHaveBeenCalled()
  })

  it('replays a durable checkpoint directly into settlement without invoking the model', async () => {
    waitMock.loadProjectAgentWaitContinuationCheckpoint.mockResolvedValueOnce({
      commandId: 'outbox-1',
      waitId: 'wait-1',
      runId: 'run-1',
      outcome: 'completed',
      messageId: 'workspace-assistant-run:user_turn:run-1:outbox-1',
    })

    await runProjectAgentWaitContinuationCommand({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')

    expect(runtimeMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    expect(waitMock.finalizeProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1', commandId: 'outbox-1',
    }))
  })

  it('does not invoke the model again when a previous continuation execution has an unknown outcome', async () => {
    waitMock.beginProjectAgentWaitContinuationExecution.mockResolvedValueOnce('already_started')

    await runProjectAgentWaitContinuationCommand({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')

    expect(runtimeMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    expect(waitMock.checkpointProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1', commandId: 'outbox-1', outcome: 'outcome_unknown',
      message: expect.objectContaining({
        id: 'workspace-continuation-outcome-unknown:outbox-1',
      }),
    }))
    expect(waitMock.finalizeProjectAgentWaitFollowUp).toHaveBeenCalledTimes(1)
  })

  it('settles an exhausted delivery through the same checkpoint and finalize authority without invoking the model', async () => {
    await expect(settleProjectAgentWaitContinuationDeliveryExhausted({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')).resolves.toBe('settled')

    expect(runtimeMock.createProjectAgentChatResponse).not.toHaveBeenCalled()
    expect(waitMock.startProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1', commandId: 'outbox-1',
    }))
    expect(waitMock.checkpointProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1',
      commandId: 'outbox-1',
      outcome: 'delivery_exhausted',
      message: expect.objectContaining({
        id: 'workspace-continuation-delivery-exhausted:outbox-1',
      }),
    }))
    expect(waitMock.finalizeProjectAgentWaitFollowUp).toHaveBeenCalledTimes(1)
  })

  it('preserves outcome_unknown when delivery exhausts after continuation execution already started', async () => {
    waitMock.beginProjectAgentWaitContinuationExecution.mockResolvedValueOnce('already_started')

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')).resolves.toBe('settled')

    expect(waitMock.checkpointProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'outcome_unknown',
      message: expect.objectContaining({ id: 'workspace-continuation-outcome-unknown:outbox-1' }),
    }))
  })

  it('finalizes an existing settled checkpoint without replacing its outcome', async () => {
    waitMock.beginProjectAgentWaitContinuationExecution.mockResolvedValueOnce('settled')

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')).resolves.toBe('settled')

    expect(waitMock.checkpointProjectAgentWaitFollowUp).not.toHaveBeenCalled()
    expect(waitMock.finalizeProjectAgentWaitFollowUp).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['already_followed', 'already_settled'],
    ['abandoned', 'not_applicable'],
    ['stale_or_not_claimable', 'not_applicable'],
  ] as const)('does not alter a %s continuation while settling exhausted delivery', async (status, result) => {
    waitMock.claimProjectAgentWaitContinuation.mockResolvedValueOnce({ status })

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')).resolves.toBe(result)

    expect(waitMock.startProjectAgentWaitFollowUp).not.toHaveBeenCalled()
    expect(waitMock.checkpointProjectAgentWaitFollowUp).not.toHaveBeenCalled()
    expect(waitMock.finalizeProjectAgentWaitFollowUp).not.toHaveBeenCalled()
  })

  it('rejects dead-letter settlement while another continuation claim is still active', async () => {
    waitMock.claimProjectAgentWaitContinuation.mockResolvedValueOnce({ status: 'busy' })

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')).rejects.toThrow('PROJECT_AGENT_CONTINUATION_DELIVERY_SETTLEMENT_BUSY:wait-1')

    expect(waitMock.checkpointProjectAgentWaitFollowUp).not.toHaveBeenCalled()
    expect(waitMock.finalizeProjectAgentWaitFollowUp).not.toHaveBeenCalled()
  })
})
