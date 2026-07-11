import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const state = vi.hoisted(() => ({
  handoff: null as Record<string, unknown> | null,
  checkpoint: null as Record<string, unknown> | null,
  wait: {
    id: 'wait-1', activityId: 'waiting-task-activity-1', runId: 'run-1', projectId: 'project-1', userId: 'user-1', episodeId: 'episode-1',
    assistantId: 'workspace-command', scopeRef: 'episode:episode-1', operationId: 'plan_chapters',
    status: 'claimed', followUpCommandId: 'command-1', claimId: 'claim-1',
    claimExpiresAt: new Date(Date.now() + 60_000), followedAt: null,
  } as Record<string, unknown>,
  run: { id: 'run-1', runVersion: 2, eventSeq: BigInt(10) } as Record<string, unknown>,
  appendReplacement: vi.fn(async () => []),
  appendMessage: vi.fn(async () => undefined),
  appendEvents: vi.fn(async () => undefined),
  assertChoiceCurrent: vi.fn(async () => undefined),
  buildChoiceOffer: vi.fn((input: {
    runId: string
    interruptionId: string
    card: Record<string, unknown>
    reviewedResource: Record<string, unknown>
  }) => ({
    schemaVersion: 1 as const,
    card: { ...input.card, runId: input.runId, interruptionId: input.interruptionId },
    reviewedResource: input.reviewedResource,
  })),
  recordChoice: vi.fn(),
  recordSuspension: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => await work({
      $queryRaw: vi.fn(async () => [{ id: 'wait-1' }]),
      projectAgentExecutionHandoff: {
        findUnique: vi.fn(async () => state.handoff),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.handoff = data
          return data
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      projectAgentContinuationCheckpoint: {
        findUnique: vi.fn(async () => state.checkpoint),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.checkpoint = { ...(state.checkpoint ?? {}), ...data }
          return { count: 1 }
        }),
      },
      projectAgentWait: { findUnique: vi.fn(async () => state.wait) },
      projectAgentRun: { findUnique: vi.fn(async () => state.run) },
    } as unknown as Prisma.TransactionClient)),
  },
}))

vi.mock('@/lib/project-agent/operation-execution-fence', () => ({
  assertProjectAgentOperationExecutionFenceInTransaction: vi.fn(async () => undefined),
  assertProjectAgentOperationExecutionFenceSignal: vi.fn(),
  recordProjectAgentChoiceHandoffReceipt: state.recordChoice,
  recordProjectAgentSuspensionReceipt: state.recordSuspension,
}))

vi.mock('@/lib/project-agent/interruptions', () => ({
  appendProjectAgentInterruptionReplacementInTransaction: state.appendReplacement,
}))

vi.mock('@/lib/project-agent/persistence', () => ({
  buildProjectAssistantScopeRef: ({ projectId, episodeId }: { projectId: string; episodeId?: string | null }) =>
    episodeId ? `episode:${episodeId}` : `project:${projectId}`,
  appendProjectAssistantThreadMessagesInTransaction: state.appendMessage,
}))

vi.mock('@/lib/project-agent/event', () => ({
  appendProjectAgentEventsInTransaction: state.appendEvents,
}))

vi.mock('@/lib/project-agent/choice-offer', () => ({
  assertProjectAgentChoiceOfferCurrent: state.assertChoiceCurrent,
  buildProjectAgentChoiceOffer: state.buildChoiceOffer,
}))

import {
  prepareProjectAgentChoiceExecutionHandoff,
  prepareProjectAgentApprovalExecutionHandoff,
  settleProjectAgentContinuationTerminalHandoff,
  settleProjectAgentPreparedApprovalHandoff,
  settleProjectAgentPreparedChoiceHandoff,
} from '@/lib/project-agent/execution-handoff'

function buildFence() {
  return {
    runFence: { runId: 'run-1', runVersion: 2, eventSeq: '10' },
    signal: new AbortController().signal,
  }
}

function buildCard() {
  return {
    cardId: 'card-choice-1',
    toolCallId: 'tool-choice-1',
    choiceType: 'script_intake' as const,
    replyMode: 'per_group' as const,
    title: 'Refine story brief',
    groups: [],
    submitLabel: 'Continue',
    submit: { kind: 'submit_tool_output' as const, decision: 'approve' as const },
  }
}

describe('project agent execution handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.handoff = null
    state.checkpoint = null
    state.wait = {
      id: 'wait-1', activityId: 'waiting-task-activity-1', runId: 'run-1', projectId: 'project-1', userId: 'user-1', episodeId: 'episode-1',
      assistantId: 'workspace-command', scopeRef: 'episode:episode-1', operationId: 'plan_chapters',
      status: 'claimed', followUpCommandId: 'command-1', claimId: 'claim-1',
      claimExpiresAt: new Date(Date.now() + 60_000), followedAt: null,
    }
  })

  it('prepares a Choice without creating a visible Interaction or changing the Run', async () => {
    const prepared = await prepareProjectAgentChoiceExecutionHandoff({
      executionFence: buildFence(),
      executionSegmentId: 'user-turn:run-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      operationId: 'request_script_intake_choice',
      toolCallId: 'tool-choice-1',
      card: buildCard(),
      reviewedResource: { kind: 'script_intake_prompt', fingerprint: 'fingerprint-1' },
    })

    expect(prepared).toMatchObject({
      kind: 'choice',
      executionSegmentId: 'user-turn:run-1',
      operationId: 'request_script_intake_choice',
    })
    expect(state.recordChoice).toHaveBeenCalledWith(prepared)
    expect(state.appendReplacement).not.toHaveBeenCalled()
    expect(state.handoff).toMatchObject({ kind: 'choice', status: 'prepared' })
  })

  it('commits the prepared Choice, assistant message, and visible Interaction through one transaction', async () => {
    const prepared = await prepareProjectAgentChoiceExecutionHandoff({
      executionFence: buildFence(),
      executionSegmentId: 'user-turn:run-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      operationId: 'request_script_intake_choice',
      toolCallId: 'tool-choice-1',
      card: buildCard(),
      reviewedResource: { kind: 'script_intake_prompt', fingerprint: 'fingerprint-1' },
    })

    const receipt = await settleProjectAgentPreparedChoiceHandoff({
      executionFence: buildFence(),
      handoff: prepared,
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      message: { id: 'assistant-choice-message', role: 'assistant', parts: [{ type: 'text', text: 'Choose.' }] },
    })

    expect(receipt).toMatchObject({ kind: 'choice', operationId: 'request_script_intake_choice' })
    expect(state.appendReplacement).toHaveBeenCalledTimes(1)
    expect(state.appendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      messages: [expect.objectContaining({ id: 'assistant-choice-message' })],
    }))
    expect(state.recordSuspension).toHaveBeenCalledWith(receipt)
  })

  it('commits an Approval message and Interaction through the same settlement transaction', async () => {
    const handoff = await prepareProjectAgentApprovalExecutionHandoff({
      executionFence: buildFence(),
      executionSegmentId: 'user-turn:run-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      operationId: 'generate_edit_style_previews',
      approvalId: 'approval-1',
      toolCallId: 'tool-approval-1',
      runState: 'serialized-state',
    })
    expect(handoff).toMatchObject({ kind: 'approval', executionSegmentId: 'user-turn:run-1' })
    expect(state.appendReplacement).not.toHaveBeenCalled()
    const receipt = await settleProjectAgentPreparedApprovalHandoff({
      executionFence: buildFence(),
      handoff,
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      message: { id: 'assistant-approval-message', role: 'assistant', parts: [{ type: 'text', text: 'Approve.' }] },
    })

    expect(receipt).toMatchObject({ kind: 'approval', approvalId: 'approval-1' })
    expect(state.appendReplacement).toHaveBeenCalledTimes(1)
    expect(state.appendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      messages: [expect.objectContaining({ id: 'assistant-approval-message' })],
    }))
    expect(state.recordSuspension).toHaveBeenCalledWith(receipt)
  })

  it('atomically settles a terminal Task continuation without a checkpoint/finalize split', async () => {
    state.checkpoint = {
      commandId: 'command-1', waitId: 'wait-1', runId: 'run-1', status: 'running',
    }

    const checkpoint = await settleProjectAgentContinuationTerminalHandoff({
      runId: 'run-1',
      waitId: 'wait-1',
      commandId: 'command-1',
      claimOwner: 'claim-1',
      projectId: 'project-1',
      userId: 'user-1',
      outcome: 'completed',
      message: { id: 'assistant-terminal-message', role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] },
    })

    expect(checkpoint).toMatchObject({ outcome: 'completed', messageId: 'assistant-terminal-message' })
    expect(state.checkpoint).toMatchObject({ status: 'settled', outcome: 'completed' })
    expect(state.appendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      messages: [expect.objectContaining({ id: 'assistant-terminal-message' })],
    }))
    expect(state.appendEvents).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      events: expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ kind: 'wait.followed' }) }),
        expect.objectContaining({ event: expect.objectContaining({ kind: 'run.completed' }) }),
      ]),
    }))
  })
})
