import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'
import { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (work: (transaction: Record<string, never>) => Promise<unknown>) => await work({})),
  },
}))
vi.mock('@/lib/project-agent/operation-execution-fence', () => ({
  assertProjectAgentOperationExecutionFenceCurrent: vi.fn(async () => undefined),
  requireProjectAgentSuspensionReceipt: vi.fn(() => ({
    kind: 'choice',
    runId: 'run-test',
    operationId: 'choice_op',
    activityId: 'activity-choice',
    interruptionId: 'interruption-choice',
    cardId: 'card-choice',
    toolCallId: 'tool-choice',
    choiceType: 'script_intake',
    card: {},
  })),
  assertProjectAgentOperationExecutionFenceInTransaction: vi.fn(async () => undefined),
  runWithProjectAgentOperationExecutionFence: vi.fn(
    async (_fence: unknown, work: () => Promise<unknown>) => await work(),
  ),
}))

import { executeProjectAgentOperationFromTool as executeAuthority } from '@/lib/adapters/tools/execute-project-agent-operation'

type ToolInvocation = Parameters<typeof executeAuthority>[0]

async function executeOperation(params: Omit<ToolInvocation, 'executionFence'>) {
  return await executeAuthority({
    ...params,
    executionFence: {
      runFence: { runId: 'run-test', runVersion: 1, eventSeq: '1' },
      signal: new AbortController().signal,
    },
  })
}

function buildWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: vi.fn(),
  } as unknown as UIMessageStreamWriter<UIMessage>
}

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

describe('executeProjectAgentOperationFromTool permission gates', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  it('[auto write without operation confirmation requirement] -> allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      writes_op: makeTestOperation({
        id: 'writes_op',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: { kind: 'none', required: false },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        executeInTransaction: async () => await execute(),
      }),
    }

    const result = await executeOperation({
      request: buildRequest(),
      operationId: 'writes_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('[ask non-billable destructive operation] -> executes without inventing a boolean approval protocol', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_op: makeTestOperation({
        id: 'confirm_op',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: { kind: 'destructive', required: true },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        executeInTransaction: async () => await execute(),
      }),
    }

    const result = await executeOperation({
      request: buildRequest(),
      operationId: 'confirm_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('[ask low-risk read operation without approval] -> allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      reads_op: makeTestOperation({
        id: 'reads_op',
        intent: 'query',
        effects: EFFECTS_NONE,
        confirmation: { kind: 'none', required: false },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeOperation({
      request: buildRequest(),
      operationId: 'reads_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('[ask choice-card operation without approval] -> allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const operationId = EDIT_FIRST_CHOICE_TOOL_IDS.bible_review
    registryState.registry = {
      [operationId]: makeTestOperation({
        id: operationId,
        intent: 'query',
        effects: EFFECTS_NONE,
        confirmation: { kind: 'none', required: false },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeOperation({
      request: buildRequest(),
      operationId,
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
