import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authState = vi.hoisted(() => ({
  authenticated: true,
  userId: 'user-1',
}))

const billingMock = vi.hoisted(() => ({
  grantUserCredits: vi.fn(),
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
      return { session: { user: { id: authState.userId } } }
    },
  }
})

vi.mock('@/lib/billing/invite-codes', () => billingMock)

import { POST } from '@/app/api/admin/credits/grant/route'

function buildRequest(body: unknown, token = 'secret-token'): NextRequest {
  return new NextRequest('http://localhost/api/admin/credits/grant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-credit-token': token,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/credits/grant', () => {
  const originalAdminToken = process.env.ADMIN_CREDIT_TOKEN
  const originalAdminUserIds = process.env.ADMIN_USER_IDS

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_CREDIT_TOKEN = 'secret-token'
    process.env.ADMIN_USER_IDS = 'admin-1'
    authState.authenticated = true
    authState.userId = 'user-1'
    billingMock.grantUserCredits.mockResolvedValue({ success: true, amount: 5 })
  })

  afterEach(() => {
    if (originalAdminToken === undefined) {
      delete process.env.ADMIN_CREDIT_TOKEN
    } else {
      process.env.ADMIN_CREDIT_TOKEN = originalAdminToken
    }
    if (originalAdminUserIds === undefined) {
      delete process.env.ADMIN_USER_IDS
    } else {
      process.env.ADMIN_USER_IDS = originalAdminUserIds
    }
  })

  it('rejects a non-admin user even with the static grant token', async () => {
    const response = await POST(buildRequest({
      userId: 'target-user',
      amount: 5,
      reason: 'test grant',
    }), { params: Promise.resolve({}) })

    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.details.code).toBe('ADMIN_USER_REQUIRED')
    expect(billingMock.grantUserCredits.mock.calls).toEqual([])
  })

  it('uses the authenticated admin id as the operator id', async () => {
    authState.userId = 'admin-1'

    const response = await POST(buildRequest({
      userId: 'target-user',
      amount: 5,
      reason: 'test grant',
      operatorId: 'spoofed-user',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(billingMock.grantUserCredits).toHaveBeenCalledWith({
      userId: 'target-user',
      amount: 5,
      reason: 'test grant',
      operatorId: 'admin-1',
    })
  })
})
