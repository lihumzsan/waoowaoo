import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { EFFECTS_BILLABLE, EFFECTS_NONE, EFFECTS_WRITE, makeTestOperation } from '../../helpers/project-agent-operations'

const invocationState = vi.hoisted(() => ({
  invokeApprovedOperationPlan: vi.fn(),
  publishResourceChanged: vi.fn(async () => undefined),
}))

vi.mock('@/lib/operations/planned-operation-invocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/operations/planned-operation-invocation')>()
  return {
    ...actual,
    invokeApprovedOperationPlan: invocationState.invokeApprovedOperationPlan,
  }
})

vi.mock('@/lib/workspace-resource/resource-change-events', () => ({
  publishWorkspaceResourceChangedEventsFromWriteResult: invocationState.publishResourceChanged,
}))

vi.mock('@/lib/project-agent/operation-execution-fence', () => ({
  assertProjectAgentOperationExecutionFenceCurrent: vi.fn(async () => undefined),
  requireProjectAgentSuspensionReceipt: vi.fn(() => ({
    kind: 'choice',
    runId: 'run-test',
    operationId: 'request_future_editorial_choice',
    activityId: 'activity-choice',
    interruptionId: 'interruption-choice',
    cardId: 'card-choice',
    toolCallId: 'tool-choice',
    choiceType: 'script_intake',
    card: {},
  })),
  assertProjectAgentOperationExecutionFenceInTransaction: vi.fn(async () => undefined),
  runWithProjectAgentOperationExecutionFence: vi.fn(async (
    _fence: unknown,
    work: () => Promise<unknown>,
  ) => await work()),
}))

import { invokeProjectAgentOperation } from '@/lib/operations/invocation'

function buildContext(episodeId?: string): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: episodeId ? { episodeId } : {},
    source: 'test',
    writer: null,
    toolCallId: null,
  }
}

function buildToolContext(episodeId?: string): ProjectAgentOperationContext {
  return {
    ...buildContext(episodeId),
    executionFence: {
      runFence: { runId: 'run-test', runVersion: 1, eventSeq: '1' },
      signal: new AbortController().signal,
    },
  }
}

describe('invokeProjectAgentOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes the same direct operation contract through API and tool channels', async () => {
    const execute = vi.fn(async (_context, input: { title: string }) => ({ title: input.title.toUpperCase() }))
    const registry: ProjectAgentOperationRegistry = {
      shared_op: makeTestOperation({
        id: 'shared_op',
        channels: { api: true, tool: true },
        effects: EFFECTS_NONE,
        inputSchema: z.object({ title: z.string().min(1) }),
        outputSchema: z.object({ title: z.string() }),
        execute,
      }),
    }

    const apiResult = await invokeProjectAgentOperation({
      registry,
      channel: 'api',
      operationId: 'shared_op',
      context: buildContext(),
      input: { title: 'same' },
    })
    const toolResult = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'shared_op',
      context: buildToolContext(),
      input: { title: 'same', projectId: 'model-cannot-override-scope' },
    })

    expect(apiResult).toMatchObject({ kind: 'executed', data: { title: 'SAME' } })
    expect(toolResult).toMatchObject({ kind: 'executed', data: { title: 'SAME' } })
    expect(execute).toHaveBeenNthCalledWith(1, expect.any(Object), { title: 'same' })
    expect(execute).toHaveBeenNthCalledWith(2, expect.any(Object), { title: 'same' })
  })

  it('requires the declared Choice protocol receipt for a future Choice identity without an invocation branch', async () => {
    const execute = vi.fn(async () => ({
      emitted: true,
      choiceType: 'script_intake',
      cardId: 'card-1',
      workflowStage: 'ready_to_ingest_script',
    }))
    const operation = makeTestOperation({
      id: 'request_future_editorial_choice',
      channels: { tool: true, api: false },
      agentFlow: { suspendsFor: 'choice' },
      effects: EFFECTS_NONE,
      inputSchema: z.object({}),
      outputSchema: z.object({
        emitted: z.literal(true),
        choiceType: z.literal('script_intake'),
        cardId: z.string(),
        workflowStage: z.string(),
      }),
      execute,
    })

    await expect(invokeProjectAgentOperation({
      registry: { request_future_editorial_choice: operation },
      channel: 'tool',
      operationId: 'request_future_editorial_choice',
      context: buildToolContext('episode-1'),
      input: {},
    })).resolves.toMatchObject({ kind: 'executed' })

    const fence = await import('@/lib/project-agent/operation-execution-fence')
    expect(fence.requireProjectAgentSuspensionReceipt).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'request_future_editorial_choice',
      kind: 'choice',
    }))
  })

  it('returns an explicit approval edge without executing a billable operation', async () => {
    const registry: ProjectAgentOperationRegistry = {
      billable_op: makeTestOperation({
        id: 'billable_op',
        effects: EFFECTS_BILLABLE,
        confirmation: { kind: 'billable_media', required: true },
        inputSchema: z.object({ prompt: z.string() }),
        outputSchema: z.object({ taskId: z.string() }),
        plan: vi.fn(async () => ({
          kind: 'task_submission' as const,
          operationId: 'billable_op',
          projectId: 'project-1',
          userId: 'user-1',
          tasks: [],
        })),
        commit: vi.fn(async () => ({ taskId: 'unused' })),
      }),
    }

    const result = await invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'billable_op',
      context: buildToolContext(),
      input: { prompt: 'image' },
      returnApprovalRequired: true,
    })

    expect(result.kind).toBe('approval_required')
    expect(invocationState.invokeApprovedOperationPlan).not.toHaveBeenCalled()
  })

  it('invokes an approved billable plan with normalized input and validates its output', async () => {
    invocationState.invokeApprovedOperationPlan.mockResolvedValueOnce({ taskId: 'task-1' })
    const operation = makeTestOperation({
      id: 'billable_op',
      effects: EFFECTS_BILLABLE,
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ taskId: z.string() }),
      plan: vi.fn(async () => ({
        kind: 'task_submission' as const,
        operationId: 'billable_op',
        projectId: 'project-1',
        userId: 'user-1',
        tasks: [],
      })),
      commit: vi.fn(async () => ({ taskId: 'unused' })),
    })

    const result = await invokeProjectAgentOperation({
      registry: { billable_op: operation },
      channel: 'api',
      operationId: 'billable_op',
      context: buildContext(),
      input: {
        prompt: 'image',
        approvalGrantId: 'grant-1',
        operationRequestId: 'request-1',
      },
    })

    expect(result).toMatchObject({ kind: 'executed', data: { taskId: 'task-1' } })
    expect(invocationState.invokeApprovedOperationPlan).toHaveBeenCalledWith(expect.objectContaining({
      operation,
      normalizedInput: { prompt: 'image' },
      invocation: { approvalGrantId: 'grant-1', requestId: 'request-1' },
    }))
  })

  it('rejects approval provenance on a direct operation instead of silently ignoring it', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const registry: ProjectAgentOperationRegistry = {
      direct_op: makeTestOperation({
        id: 'direct_op',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    await expect(invokeProjectAgentOperation({
      registry,
      channel: 'api',
      operationId: 'direct_op',
      context: buildContext(),
      input: { approvalGrantId: 'grant-1', operationRequestId: 'request-1' },
    })).rejects.toMatchObject({
      details: expect.objectContaining({ code: 'APPROVAL_GRANT_NOT_APPLICABLE' }),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an undeclared ordinary Tool write before its executor runs', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const operation = makeTestOperation({
      id: 'unsafe_write',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute,
    })

    await expect(invokeProjectAgentOperation({
      registry: { unsafe_write: operation },
      channel: 'tool',
      operationId: 'unsafe_write',
      context: buildToolContext(),
      input: {},
    })).rejects.toThrow('PROJECT_AGENT_OPERATION_TOOL_WRITE_AUTHORITY_REQUIRED:unsafe_write')

    expect(execute).not.toHaveBeenCalled()
  })

  it('requires the atomic Task batch binding before a Task-authority executor runs', async () => {
    const execute = vi.fn(async () => ({ taskId: 'task-1' }))
    const operation = makeTestOperation({
      id: 'task_write',
      intent: 'act',
      effects: EFFECTS_WRITE,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      inputSchema: z.object({}),
      outputSchema: z.object({ taskId: z.string() }),
      execute,
    })

    await expect(invokeProjectAgentOperation({
      registry: { task_write: operation },
      channel: 'tool',
      operationId: 'task_write',
      context: buildToolContext(),
      input: {},
    })).rejects.toThrow('PROJECT_AGENT_OPERATION_TASK_BATCH_BINDING_REQUIRED:task_write')

    expect(execute).not.toHaveBeenCalled()
  })
})
