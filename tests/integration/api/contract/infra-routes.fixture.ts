import fs from 'node:fs/promises'

import path from 'node:path'

import { NextRequest } from 'next/server'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROUTE_CATALOG } from '../../../contracts/route-catalog'

import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: false,
}))

const loggingMock = vi.hoisted(() => ({
  readAllLogs: vi.fn(async () => 'worker log line 1\nworker log line 2'),
}))

const storageMock = vi.hoisted(() => ({
  getSignedObjectUrl: vi.fn(async (key: string, ttl: number) => `https://signed.example/${key}?expires=${ttl}`),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
  }
})

vi.mock('@/lib/logging/file-writer', () => loggingMock)

vi.mock('@/lib/storage', () => storageMock)

export { default as fs } from 'node:fs/promises'
export { default as path } from 'node:path'
export { NextRequest } from 'next/server'
export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export { ROUTE_CATALOG } from '../../../contracts/route-catalog'
export { buildMockRequest } from '../../../helpers/request'
export { authState, loggingMock, storageMock }
