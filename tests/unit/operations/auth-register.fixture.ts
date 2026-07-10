import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NextRequest } from 'next/server'

import { ApiError } from '@/lib/api-errors'

import { AUTH_REGISTER_RESULT_CODES } from '@/lib/auth/register-result-codes'

import { hashInviteCode } from '@/lib/billing/invite-codes'

const prismaMock = vi.hoisted(() => {
  const tx = {
    user: {
      create: vi.fn(),
    },
    userBalance: {
      create: vi.fn(),
      upsert: vi.fn(),
    },
    balanceTransaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    inviteCode: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    inviteRedemption: {
      create: vi.fn(),
    },
  }

  return {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    __tx: tx,
  }
})

const bcryptMock = vi.hoisted(() => ({
  hash: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('bcryptjs', () => ({ default: bcryptMock }))

vi.mock('@/lib/logging/semantic', () => ({ logAuthAction: vi.fn() }))

import { createAuthOperations } from '@/lib/operations/domains/auth/auth-ops'

type RegisterInput = {
  name?: unknown
  password?: unknown
  inviteCode?: unknown
}

type RegisterResult = {
  message: string
  user: {
    id: string
    name: string
  }
}

function buildContext() {
  return {
    request: new Request('http://localhost/api/auth/register') as unknown as NextRequest,
    userId: 'anonymous',
    projectId: 'system',
    context: {},
    source: 'auth',
    writer: null,
  }
}

async function executeRegister(input: RegisterInput | unknown) {
  const operation = createAuthOperations().auth_register_user
  return await operation.execute(buildContext(), input)
}

export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export type { NextRequest } from 'next/server'
export { ApiError } from '@/lib/api-errors'
export { AUTH_REGISTER_RESULT_CODES } from '@/lib/auth/register-result-codes'
export { hashInviteCode } from '@/lib/billing/invite-codes'
export { createAuthOperations } from '@/lib/operations/domains/auth/auth-ops'
export { bcryptMock, buildContext, executeRegister, prismaMock }
export type { RegisterInput, RegisterResult }
