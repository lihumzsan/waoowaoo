import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'

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
