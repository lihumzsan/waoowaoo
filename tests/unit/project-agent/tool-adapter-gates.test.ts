import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { makeTestOperation, EFFECTS_NONE } from '../../helpers/project-agent-operations'
const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (work: (transaction: Record<string, never>) => Promise<unknown>) =>
      await work({})),
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
  runWithProjectAgentOperationExecutionFence: vi.fn(async (
    _fence: unknown,
    work: () => Promise<unknown>,
  ) => await work()),
}))

import {
  executeProjectAgentOperationFromTool as executeProjectAgentOperationFromToolAuthority,
} from '@/lib/adapters/tools/execute-project-agent-operation'

type ToolInvocation = Parameters<typeof executeProjectAgentOperationFromToolAuthority>[0]

async function executeProjectAgentOperationFromTool(
  params: Omit<ToolInvocation, 'executionFence'>,
) {
  return await executeProjectAgentOperationFromToolAuthority({
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

describe('executeProjectAgentOperationFromTool gates', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  it('[prerequisite episodeId required] -> returns OPERATION_PREREQUISITE_MISSING and does not execute', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      needs_episode: makeTestOperation({
        id: 'needs_episode',
        intent: 'query',
        prerequisites: { episodeId: 'required' },
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'needs_episode',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_PREREQUISITE_MISSING')
    expect(execute).not.toHaveBeenCalled()
  })

  it('[api-only operation through tool] -> returns OPERATION_NOT_ALLOWED before parsing or execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      api_only_op: makeTestOperation({
        id: 'api_only_op',
        channels: { tool: false, api: true },
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({ requiredValue: z.string() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'api_only_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_NOT_ALLOWED')
    expect(result.error.details).toEqual(expect.objectContaining({ channel: 'tool' }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('[prerequisite episodeId required + context includes episodeId] -> allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      needs_episode: makeTestOperation({
        id: 'needs_episode',
        intent: 'query',
        prerequisites: { episodeId: 'required' },
        effects: EFFECTS_NONE,
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'needs_episode',
      projectId: 'project-1',
      userId: 'user-1',
      context: { episodeId: 'ep-1' },
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('[prerequisite episodeId forbidden] -> returns OPERATION_PREREQUISITE_MISSING and does not execute', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      forbids_episode: makeTestOperation({
        id: 'forbids_episode',
        intent: 'query',
        prerequisites: { episodeId: 'forbidden' },
        effects: EFFECTS_NONE,
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'forbids_episode',
      projectId: 'project-1',
      userId: 'user-1',
      context: { episodeId: 'ep-1' },
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_PREREQUISITE_MISSING')
    expect(execute).not.toHaveBeenCalled()
  })

  it('[prerequisite episodeId forbidden + input includes episodeId] -> strips model-supplied environment input and allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      forbids_episode: makeTestOperation({
        id: 'forbids_episode',
        intent: 'query',
        prerequisites: { episodeId: 'forbidden' },
        effects: EFFECTS_NONE,
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'forbids_episode',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: { episodeId: 'ep-1' },
    })

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect((execute.mock.calls[0] as unknown[] | undefined)?.[1]).toEqual({})
  })


})
