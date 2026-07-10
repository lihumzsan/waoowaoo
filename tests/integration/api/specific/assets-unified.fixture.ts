import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NextRequest } from 'next/server'

import { buildMockRequest } from '../../../helpers/request'

import type { AssetKind, AssetScope } from '@/lib/assets/contracts'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  requireProjectAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1' },
  })),
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const readAssetsMock = vi.hoisted(() => vi.fn())

const submitAssetGenerateTaskMock = vi.hoisted(() => vi.fn())

const executeProjectAgentOperationFromApiMock = vi.hoisted(() => vi.fn())

const planProjectAgentOperationFromApiMock = vi.hoisted(() => vi.fn())

const copyAssetFromGlobalMock = vi.hoisted(() => vi.fn())

const createAssetMock = vi.hoisted(() => vi.fn())

const updateAssetMock = vi.hoisted(() => vi.fn())

const removeAssetMock = vi.hoisted(() => vi.fn())

const updateAssetVariantMock = vi.hoisted(() => vi.fn())

const selectAssetRenderMock = vi.hoisted(() => vi.fn())

const revertAssetRenderMock = vi.hoisted(() => vi.fn())

const uploadProjectAssetRenderMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => authMock)

vi.mock('@/lib/assets/services/read-assets', () => ({
  readAssets: readAssetsMock,
}))

vi.mock('@/lib/assets/services/asset-actions', () => ({
  createAsset: createAssetMock,
  submitAssetGenerateTask: submitAssetGenerateTaskMock,
  planAssetGenerateTask: vi.fn(),
  copyAssetFromGlobal: copyAssetFromGlobalMock,
  updateAsset: updateAssetMock,
  removeAsset: removeAssetMock,
  updateAssetVariant: updateAssetVariantMock,
  submitAssetModifyTask: vi.fn(),
  planAssetModifyTask: vi.fn(),
  selectAssetRender: selectAssetRenderMock,
  revertAssetRender: revertAssetRenderMock,
}))

vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => ({
  executeProjectAgentOperationFromApi: executeProjectAgentOperationFromApiMock,
}))

vi.mock('@/lib/operations/planning', () => ({
  planProjectAgentOperationFromApi: planProjectAgentOperationFromApiMock,
}))

vi.mock('@/lib/assets/services/project-upload-render', () => ({
  uploadProjectAssetRender: uploadProjectAssetRenderMock,
}))

function buildFormRequest(path: string, formData: FormData) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Accept-Language': 'zh' },
    body: formData,
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readKind(value: unknown): AssetKind {
  if (value === 'character' || value === 'location' || value === 'prop') return value
  throw new Error('TEST_ASSET_KIND_REQUIRED')
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function omitKeys(input: Record<string, unknown>, keys: ReadonlyArray<string>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input }
  for (const key of keys) {
    delete output[key]
  }
  return output
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { NextRequest } from 'next/server'
export { buildMockRequest } from '../../../helpers/request'
export type { AssetKind, AssetScope } from '@/lib/assets/contracts'
export { asRecord, authMock, buildFormRequest, copyAssetFromGlobalMock, createAssetMock, executeProjectAgentOperationFromApiMock, omitKeys, planProjectAgentOperationFromApiMock, readAssetsMock, readKind, readString, removeAssetMock, revertAssetRenderMock, selectAssetRenderMock, submitAssetGenerateTaskMock, updateAssetMock, updateAssetVariantMock, uploadProjectAssetRenderMock }
