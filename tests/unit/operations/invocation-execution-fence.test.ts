import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { EFFECTS_WRITE, makeTestOperation } from '../../helpers/project-agent-operations'

interface RunSnapshot {
  status: string
  runVersion: number
  eventSeq: bigint
}

interface BarrierTransaction {
  stageDomainWrite: () => void
}

const fenceState = vi.hoisted(() => ({
  run: {
    status: 'running',
    runVersion: 4,
    eventSeq: BigInt(12),
  } as RunSnapshot | null,
  committed: false,
  staged: false,
  authorizedWait: { id: 'wait-1' } as { id: string } | null,
  choiceInterruption: null as {
    activityId: string | null
    payload: unknown
  } | null,
  choiceActivity: null as { id: string } | null,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectAgentRun: {
      findUnique: vi.fn(async () => fenceState.run),
    },
    projectAgentWait: {
      findFirst: vi.fn(async () => fenceState.authorizedWait),
    },
    $transaction: vi.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      fenceState.staged = false
      const tx = {
        $queryRaw: vi.fn(async () => fenceState.run ? [fenceState.run] : []),
        stageDomainWrite: () => {
          fenceState.staged = true
        },
        projectAgentInterruption: {
          findFirst: vi.fn(async () => fenceState.choiceInterruption),
        },
        projectAgentActivity: {
          findFirst: vi.fn(async () => fenceState.choiceActivity),
        },
      } as unknown as Prisma.TransactionClient
      const result = await work(tx)
      fenceState.committed = fenceState.staged
      return result
    }),
  },
}))

vi.mock('@/lib/workspace-resource/resource-change-events', () => ({
  publishWorkspaceResourceChangedEventsFromWriteResult: vi.fn(async () => undefined),
}))

import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import {
  assertProjectAgentChoiceExecutionFenceAfterInvocation,
  assertProjectAgentOperationExecutionFenceInTransaction,
} from '@/lib/project-agent/operation-execution-fence'

function buildContext(controller: AbortController): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: {},
    source: 'assistant-panel',
    writer: null,
    toolCallId: 'tool-call-1',
    executionFence: {
      runFence: {
        runId: 'run-1',
        runVersion: 4,
        eventSeq: '12',
      },
      signal: controller.signal,
    },
  }
}

describe('Assistant operation execution fence', () => {
  beforeEach(() => {
    fenceState.run = {
      status: 'running',
      runVersion: 4,
      eventSeq: BigInt(12),
    }
    fenceState.committed = false
    fenceState.staged = false
    fenceState.authorizedWait = { id: 'wait-1' }
    fenceState.choiceInterruption = null
    fenceState.choiceActivity = null
  })

  it('rolls back a transactional domain write when ownership is lost after execute starts', async () => {
    const controller = new AbortController()
    const executeInTransaction = vi.fn(async (
      _context: ProjectAgentOperationContext,
      _input: Record<string, never>,
      tx: Prisma.TransactionClient,
    ) => {
      ;(tx as unknown as BarrierTransaction).stageDomainWrite()
      controller.abort(new Error('RUN_LOCK_LOST'))
      return { saved: true }
    })
    const operation = makeTestOperation({
      id: 'transactional_write',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({}),
      outputSchema: z.object({ saved: z.boolean() }),
      executeInTransaction,
    })

    await expect(invokeProjectAgentOperation({
      registry: { transactional_write: operation },
      channel: 'tool',
      operationId: 'transactional_write',
      context: buildContext(controller),
      input: {},
    })).rejects.toThrow('PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED runId=run-1 reason=aborted')

    expect(executeInTransaction).toHaveBeenCalledTimes(1)
    expect(fenceState.staged).toBe(true)
    expect(fenceState.committed).toBe(false)
  })

  it('rejects a stale Run generation before the operation executor can run', async () => {
    fenceState.run = {
      status: 'running',
      runVersion: 5,
      eventSeq: BigInt(13),
    }
    const execute = vi.fn(async () => ({ ok: true }))
    const operation = makeTestOperation({
      id: 'stale_write',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute,
    })

    await expect(invokeProjectAgentOperation({
      registry: { stale_write: operation },
      channel: 'tool',
      operationId: 'stale_write',
      context: buildContext(new AbortController()),
      input: {},
    })).rejects.toThrow('PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED runId=run-1 reason=stale_run_fence')

    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a continuation commit whose durable claim is no longer owned', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        status: 'running',
        runVersion: 4,
        eventSeq: BigInt(12),
      }])
      .mockResolvedValueOnce([{
        runId: 'run-1',
        status: 'claimed',
        followUpCommandId: 'command-1',
        claimId: 'another-owner',
        claimExpiresAt: new Date(Date.now() + 60_000),
        followedAt: null,
      }])
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient

    await expect(assertProjectAgentOperationExecutionFenceInTransaction(tx, {
      runFence: { runId: 'run-1', runVersion: 4, eventSeq: '12' },
      signal: new AbortController().signal,
      continuationClaim: {
        waitId: 'wait-1',
        commandId: 'command-1',
        claimOwner: 'owner-1',
      },
    })).rejects.toThrow(
      'PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED runId=run-1 reason=continuation_claim_lost',
    )

    expect(query).toHaveBeenCalledTimes(2)
  })

  it('accepts only this invocation\'s durable Choice transition after it advances the Run fence', async () => {
    fenceState.run = {
      status: 'awaiting_choice',
      runVersion: 5,
      eventSeq: BigInt(13),
    }
    fenceState.choiceInterruption = {
      activityId: 'activity-choice-1',
      payload: {
        schemaVersion: 1,
        card: {
          cardId: 'card-choice-1',
          runId: 'run-1',
          interruptionId: 'interruption-choice-1',
          toolCallId: 'tool-choice-1',
          choiceType: 'script_intake',
          replyMode: 'per_group',
          title: 'Refine story brief',
          groups: [],
          submitLabel: 'Continue',
          submit: { kind: 'submit_tool_output', decision: 'approve' },
        },
        reviewedResource: {
          kind: 'script_intake_prompt',
          fingerprint: 'a'.repeat(64),
        },
      },
    }
    fenceState.choiceActivity = { id: 'activity-choice-1' }

    await expect(assertProjectAgentChoiceExecutionFenceAfterInvocation({
      fence: {
        runFence: { runId: 'run-1', runVersion: 5, eventSeq: '13' },
        signal: new AbortController().signal,
        choiceExecutionOutcome: {
          interruptionId: 'interruption-choice-1',
          cardId: 'card-choice-1',
          toolCallId: 'tool-choice-1',
          choiceType: 'script_intake',
        },
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      operationId: 'request_script_intake_choice',
    })).resolves.toBeUndefined()
  })

  it('rejects an awaiting Choice that lacks this invocation\'s durable Interaction identity', async () => {
    fenceState.run = {
      status: 'awaiting_choice',
      runVersion: 5,
      eventSeq: BigInt(13),
    }

    await expect(assertProjectAgentChoiceExecutionFenceAfterInvocation({
      fence: {
        runFence: { runId: 'run-1', runVersion: 5, eventSeq: '13' },
        signal: new AbortController().signal,
        choiceExecutionOutcome: {
          interruptionId: 'foreign-interruption',
          cardId: 'foreign-card',
          toolCallId: 'foreign-tool',
          choiceType: 'script_intake',
        },
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      operationId: 'request_script_intake_choice',
    })).rejects.toThrow('PROJECT_AGENT_OPERATION_CHOICE_OUTCOME_INVALID:request_script_intake_choice')
  })

})
