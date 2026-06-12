import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))

import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'

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

  it('[prerequisite episodeId required + input includes episodeId] -> allows execution', async () => {
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
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: { episodeId: 'ep-1' },
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

  it('[prerequisite episodeId forbidden + input includes episodeId] -> returns OPERATION_PREREQUISITE_MISSING', async () => {
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

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_PREREQUISITE_MISSING')
    expect(execute).not.toHaveBeenCalled()
  })

  it('[auto write without operation confirmation requirement] -> allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      writes_op: makeTestOperation({
        id: 'writes_op',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: { required: false },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
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

  it('[ask confirmation-marked operation without approval] -> returns CONFIRMATION_REQUIRED and does not execute', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_op: makeTestOperation({
        id: 'confirm_op',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: { required: true },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
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

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.confirmationRequired).toBe(true)
    expect(result.error.code).toBe('CONFIRMATION_REQUIRED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('[ask low-risk read operation without approval] -> allows execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      reads_op: makeTestOperation({
        id: 'reads_op',
        intent: 'query',
        effects: EFFECTS_NONE,
        confirmation: { required: false },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
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
    registryState.registry = {
      request_edit_first_choice: makeTestOperation({
        id: 'request_edit_first_choice',
        intent: 'query',
        effects: EFFECTS_NONE,
        confirmation: { required: false },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'request_edit_first_choice',
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
