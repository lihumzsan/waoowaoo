import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { makeTestOperation, EFFECTS_BILLABLE, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'
import { TASK_TYPE } from '@/lib/task/types'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
  createProjectAgentOperationRegistryForApi: () => registryState.registry,
}))

import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

function buildBillablePlan() {
  return {
    kind: 'task_submission' as const,
    operationId: 'planned_billable_op',
    projectId: 'project-1',
    userId: 'user-1',
    tasks: [{
      id: 'planned-task-1',
      taskType: TASK_TYPE.IMAGE_PANEL,
      target: { targetType: 'ProjectPanel', targetId: 'panel-1' },
      payload: {},
      billingInfo: {
        billable: true as const,
        source: 'task' as const,
        taskType: TASK_TYPE.IMAGE_PANEL,
        apiType: 'image' as const,
        model: 'image-model',
        quantity: 1,
        unit: 'image' as const,
        maxFrozenCost: 1,
        action: TASK_TYPE.IMAGE_PANEL,
        status: 'quoted' as const,
      },
      locale: 'zh' as const,
    }],
  }
}

describe('executeProjectAgentOperationFromApi', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  it('[operation not found] -> throws ApiError NOT_FOUND with operation id', async () => {
    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'missing_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: expect.objectContaining({
        message: 'operation not found: missing_op',
      }),
    })
  })

  it('[input schema mismatch] -> throws ApiError INVALID_PARAMS with zod issues', async () => {
    registryState.registry = {
      input_guard_op: makeTestOperation({
        id: 'input_guard_op',
        summary: 'input guard',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({ projectId: z.string().min(1) }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ ok: true })),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'input_guard_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        message: 'INVALID_PARAMS',
        issues: expect.any(Array),
      }),
    })
  })

  it('[output schema mismatch] -> throws ApiError EXTERNAL_ERROR with output-invalid code', async () => {
    registryState.registry = {
      output_guard_op: makeTestOperation({
        id: 'output_guard_op',
        summary: 'output guard',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ value: 'unexpected-shape' } as unknown as { ok: boolean })),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'output_guard_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      details: expect.objectContaining({
        code: 'OPERATION_OUTPUT_INVALID',
        message: 'operation output schema mismatch: output_guard_op',
      }),
    })
  })

  it('[execution throws not found-like message] -> infers ApiError NOT_FOUND', async () => {
    registryState.registry = {
      infer_not_found_op: makeTestOperation({
        id: 'infer_not_found_op',
        summary: 'infer not found',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new Error('resource not found')
        }),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'infer_not_found_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: expect.objectContaining({
        message: 'resource not found',
      }),
    })
  })

  it('[requiresConfirmation sideEffects] -> does not enforce confirmed gate', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_semantics_op: makeTestOperation({
        id: 'confirm_semantics_op',
        summary: 'confirm semantics',
        intent: 'act',
        effects: EFFECTS_WRITE,
        confirmation: {
          kind: 'destructive',
          required: true,
          summary: 'requires explicit confirmation',
        },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'confirm_semantics_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    expect(result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.any(Object), {})
  })

  it('[planned billable operation without confirmation] -> rejects before commit and execute', async () => {
    const commit = vi.fn(async () => ({ ok: true }))
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      planned_billable_op: makeTestOperation({
        id: 'planned_billable_op',
        summary: 'planned billable operation',
        intent: 'act',
        effects: EFFECTS_BILLABLE,
        confirmation: { kind: 'billable_media', required: true },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        plan: vi.fn(async () => buildBillablePlan()),
        commit,
        execute,
      }),
    }

    await expect(executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'planned_billable_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })).rejects.toMatchObject({
      details: expect.objectContaining({ code: 'OPERATION_CONFIRMATION_REQUIRED' }),
    })
    expect(commit).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('[planned billable operation with confirmation] -> commits the exact plan without calling execute', async () => {
    const plan = vi.fn(async () => buildBillablePlan())
    const commit = vi.fn(async () => ({ ok: true }))
    const execute = vi.fn(async () => ({ ok: false }))
    registryState.registry = {
      planned_billable_op: makeTestOperation({
        id: 'planned_billable_op',
        summary: 'planned billable operation',
        intent: 'act',
        effects: EFFECTS_BILLABLE,
        confirmation: { kind: 'billable_media', required: true },
        inputSchema: z.object({ confirmed: z.boolean(), confirmedMaxCost: z.number() }),
        outputSchema: z.object({ ok: z.boolean() }),
        plan,
        commit,
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'planned_billable_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: { confirmed: true, confirmedMaxCost: 1 },
      source: 'project-ui',
    })

    expect(result).toEqual({ ok: true })
    expect(plan).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(expect.any(Object), { confirmed: true, confirmedMaxCost: 1 }, expect.objectContaining({
      operationId: 'planned_billable_op',
    }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('[execution throws undefined] -> throws ApiError EXTERNAL_ERROR with fallback message', async () => {
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

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'fail_undefined',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      details: expect.objectContaining({
        code: 'OPERATION_EXECUTION_FAILED',
        message: 'OPERATION_FAILED',
      }),
    })
  })

  it('[execution throws ApiError] -> preserves structured operation details', async () => {
    registryState.registry = {
      api_forbidden_op: makeTestOperation({
        id: 'api_forbidden_op',
        summary: 'api forbidden',
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

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'api_forbidden_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'TASK_MODEL_MANAGED_BY_CONFIG',
        field: 'videoModel',
        message: 'video model is managed by system configuration',
      }),
    })
  })

  it('[execution throws prisma missing column] -> throws ApiError EXTERNAL_ERROR with schema-mismatch code', async () => {
    registryState.registry = {
      prisma_schema_mismatch: makeTestOperation({
        id: 'prisma_schema_mismatch',
        summary: 'prisma schema mismatch',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw {
            code: 'P2022',
            meta: {
              column: 'visualStylePresetId',
            },
          }
        }),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'prisma_schema_mismatch',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      details: expect.objectContaining({
        code: 'DATABASE_SCHEMA_MISMATCH',
        field: 'visualStylePresetId',
        message: 'database schema mismatch: missing column visualStylePresetId; run the latest Prisma migration before starting the app',
      }),
    })
  })
})
