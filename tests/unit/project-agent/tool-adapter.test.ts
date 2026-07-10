import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'
import { TASK_TYPE } from '@/lib/task/types'
import type { OperationPlan } from '@/lib/operations/planning'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))

import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
const originalBillingMode = process.env.BILLING_MODE

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

describe('executeProjectAgentOperationFromTool', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalBillingMode === undefined) {
      delete process.env.BILLING_MODE
    } else {
      process.env.BILLING_MODE = originalBillingMode
    }
  })

  it('[invalid input] -> returns structured error with issues', async () => {
    registryState.registry = {
      test_op: makeTestOperation({
        id: 'test_op',
        summary: 'test',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({ name: z.string().min(1) }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ ok: true })),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'test_op',
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
    expect(result.error.code).toBe('OPERATION_INPUT_INVALID')
    expect(result.error.issues).toBeDefined()
  })

  it('[approval required without SDK approval] -> returns a defensive error without executing', async () => {
    const writer = buildWriter()
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_op: makeTestOperation({
        id: 'confirm_op',
        summary: 'confirm',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: {
          kind: 'billable_media',
          required: true,
          summary: 'needs confirm',
          budget: {
            key: 'assistant-budget',
            estimatedCostUnits: 3,
          },
        },
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
      writer,
      input: {},
      toolCallId: 'tool-call-1',
    })

    expect(writer.write).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONFIRMATION_REQUIRED')
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_APPROVAL_REQUIRED')
    expect(result.error.details).toEqual({ approval: 'ai-sdk-tool-approval' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('[confirmed input] -> executes operation when confirmation required', async () => {
    const writer = buildWriter()
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_ok_op: makeTestOperation({
        id: 'confirm_ok_op',
        summary: 'confirm ok',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: {
          kind: 'destructive',
          required: true,
          summary: 'needs confirm',
        },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'confirm_ok_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer,
      input: { confirmed: true },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.any(Object), { confirmed: true })
  })

  it('[planned non-approval media operation] -> writes a quote preview and commits the same plan', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.BILLING_MODE = 'ENFORCE'
    const writer = buildWriter()
    const plan: OperationPlan = {
      kind: 'task_submission',
      operationId: 'music_preview_op',
      projectId: 'project-1',
      userId: 'user-1',
      tasks: [{
        id: 'music-task-1',
        taskType: TASK_TYPE.MUSIC_GENERATE,
        target: {
          targetType: 'Project',
          targetId: 'project-1',
        },
        payload: {
          prompt: 'quiet cue',
          durationSeconds: 30,
        },
        billingInfo: {
          billable: true,
          source: 'task',
          taskType: TASK_TYPE.MUSIC_GENERATE,
          apiType: 'music',
          model: 'music-model',
          quantity: 1,
          unit: 'call',
          maxFrozenCost: 2.5,
          action: TASK_TYPE.MUSIC_GENERATE,
          status: 'quoted',
        },
        locale: 'zh',
      }],
    }
    const planMock = vi.fn(async () => plan)
    const commitMock = vi.fn(async () => ({ ok: true, taskCount: plan.tasks.length }))
    const execute = vi.fn(async () => ({ ok: false, taskCount: 0 }))
    registryState.registry = {
      music_preview_op: makeTestOperation({
        id: 'music_preview_op',
        summary: 'music preview',
        intent: 'act',
        effects: {
          ...EFFECTS_WRITE,
          billable: true,
          externalSideEffects: true,
          longRunning: true,
        },
        confirmation: { kind: 'none', required: false },
        inputSchema: z.object({ prompt: z.string().min(1) }),
        outputSchema: z.object({ ok: z.boolean(), taskCount: z.number().int() }),
        plan: planMock,
        commit: commitMock,
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'music_preview_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer,
      input: { prompt: 'quiet cue' },
      toolCallId: 'tool-call-music',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ ok: true, taskCount: 1 })
    expect(planMock).toHaveBeenCalledTimes(1)
    expect(commitMock).toHaveBeenCalledWith(expect.any(Object), { prompt: 'quiet cue' }, plan)
    expect(execute).not.toHaveBeenCalled()
    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-agent-operation-plan-preview',
      data: expect.objectContaining({
        operationId: 'music_preview_op',
        toolCallId: 'tool-call-music',
        operationPlan: expect.objectContaining({
          quote: expect.objectContaining({
            billable: true,
            mediaTaskCount: 1,
            totalMaxFrozenCost: 2.5,
          }),
        }),
      }),
    })
  })

  it('[execution error] -> returns structured error', async () => {
    registryState.registry = {
      fail_op: makeTestOperation({
        id: 'fail_op',
        summary: 'fail',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new Error('boom')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_op',
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
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('boom')
  })

  it('[execution ApiError] -> preserves structured details for the model', async () => {
    registryState.registry = {
      forbidden_op: makeTestOperation({
        id: 'forbidden_op',
        summary: 'forbidden',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new ApiError('FORBIDDEN', {
            code: 'TASK_MODEL_MANAGED_BY_CONFIG',
            field: 'videoModel',
            message: 'video model is managed by system configuration',
          })
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'forbidden_op',
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
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('video model is managed by system configuration')
    expect(result.error.details).toEqual(expect.objectContaining({
      apiErrorCode: 'FORBIDDEN',
      httpStatus: 403,
      code: 'TASK_MODEL_MANAGED_BY_CONFIG',
      reasonCode: 'TASK_MODEL_MANAGED_BY_CONFIG',
      field: 'videoModel',
      message: 'video model is managed by system configuration',
    }))
  })

  it('[interrupting operation error] -> marks the failed interaction boundary in details', async () => {
    registryState.registry = {
      choice_op: makeTestOperation({
        id: 'choice_op',
        summary: 'choice',
        intent: 'query',
        effects: EFFECTS_NONE,
        confirmation: { kind: 'none', required: false },
        agentFlow: { interruptsFor: 'choice' },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new Error('choice setup failed')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'choice_op',
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
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.details).toEqual({ interruptsFor: 'choice' })
  })

  it('[execution throws undefined] -> returns fallback message', async () => {
    registryState.registry = {
      fail_undefined: makeTestOperation({
        id: 'fail_undefined',
        summary: 'fail undefined',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw undefined
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_undefined',
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
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_FAILED')
  })

  it('[execution throws symbol] -> returns fallback message', async () => {
    registryState.registry = {
      fail_symbol: makeTestOperation({
        id: 'fail_symbol',
        summary: 'fail symbol',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw Symbol('boom')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_symbol',
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
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_FAILED')
  })

  it('[execution throws function] -> returns fallback message', async () => {
    registryState.registry = {
      fail_function: makeTestOperation({
        id: 'fail_function',
        summary: 'fail function',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw (() => 'boom')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_function',
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
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_FAILED')
  })

  it('[output schema mismatch] -> returns structured error', async () => {
    registryState.registry = {
      output_op: makeTestOperation({
        id: 'output_op',
        summary: 'output',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ missing: true } as unknown as { ok: boolean })),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'output_op',
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
    expect(result.error.code).toBe('OPERATION_OUTPUT_INVALID')
    expect(result.error.issues).toBeDefined()
  })

  it('[success] -> wraps output in ok data', async () => {
    registryState.registry = {
      ok_op: makeTestOperation({
        id: 'ok_op',
        summary: 'ok',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ ok: true })),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'ok_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result).toEqual({
      ok: true,
      data: { ok: true },
    })
  })
})
