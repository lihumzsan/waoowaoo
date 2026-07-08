import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCOUNT_SECURITY_RESULT_CODES } from '@/lib/auth/account-security'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const accountSecurityMock = vi.hoisted(() => ({
  getAccountSecurity: vi.fn(),
  setInitialPassword: vi.fn(),
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
      return {
        session: {
          user: {
            id: 'user-1',
            name: 'user@example.com',
            email: 'user@example.com',
          },
        },
      }
    },
  }
})

vi.mock('@/lib/auth/account-security', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account-security')>('@/lib/auth/account-security')
  return {
    ...actual,
    getAccountSecurity: accountSecurityMock.getAccountSecurity,
    setInitialPassword: accountSecurityMock.setInitialPassword,
  }
})

import { GET, POST } from '@/app/api/user/security/route'

function buildRequest(method: 'GET' | 'POST', body?: string): NextRequest {
  return new NextRequest('http://localhost/api/user/security', {
    method,
    ...(body === undefined ? {} : {
      body,
      headers: {
        'content-type': 'application/json',
      },
    }),
  })
}

const routeContext = { params: Promise.resolve({}) }

const securitySnapshot = {
  email: 'user@example.com',
  displayName: 'user@example.com',
  hasPassword: false,
  providers: {
    google: {
      linked: true,
    },
  },
}

describe('/api/user/security', () => {
  const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'cloud'
    authState.authenticated = true
    accountSecurityMock.getAccountSecurity.mockResolvedValue(securitySnapshot)
    accountSecurityMock.setInitialPassword.mockResolvedValue({
      ...securitySnapshot,
      hasPassword: true,
    })
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
  })

  it('GET rejects unauthenticated requests', async () => {
    authState.authenticated = false

    const response = await GET(buildRequest('GET'), routeContext)

    expect(response.status).toBe(401)
    expect(accountSecurityMock.getAccountSecurity.mock.calls).toEqual([])
  })

  it('GET returns the current user account security snapshot', async () => {
    const response = await GET(buildRequest('GET'), routeContext)
    const body = await response.json() as {
      success: boolean
      security: typeof securitySnapshot
    }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      security: securitySnapshot,
    })
    expect(accountSecurityMock.getAccountSecurity).toHaveBeenCalledWith('user-1')
  })

  it('GET rejects self-hosted deployments before exposing account security', async () => {
    process.env.DEPLOYMENT_EDITION = 'self-hosted'

    const response = await GET(buildRequest('GET'), routeContext)
    const body = await response.json() as {
      error: {
        details: {
          code: string
        }
      }
    }

    expect(response.status).toBe(404)
    expect(body.error.details.code).toBe('ACCOUNT_SECURITY_FEATURE_DISABLED')
    expect(accountSecurityMock.getAccountSecurity.mock.calls).toEqual([])
  })

  it('POST rejects invalid JSON before writing password', async () => {
    const response = await POST(buildRequest('POST', '{'), routeContext)
    const body = await response.json() as {
      error: {
        details: {
          code: string
        }
      }
    }

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe(ACCOUNT_SECURITY_RESULT_CODES.bodyParseFailed)
    expect(accountSecurityMock.setInitialPassword.mock.calls).toEqual([])
  })

  it('POST validates password payload before writing password', async () => {
    const response = await POST(buildRequest('POST', JSON.stringify({ password: '' })), routeContext)
    const body = await response.json() as {
      error: {
        details: {
          code: string
        }
      }
    }

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe(ACCOUNT_SECURITY_RESULT_CODES.passwordPayloadInvalid)
    expect(accountSecurityMock.setInitialPassword.mock.calls).toEqual([])
  })

  it('POST sets the current user initial password', async () => {
    const response = await POST(buildRequest('POST', JSON.stringify({ password: 'secret1' })), routeContext)
    const body = await response.json() as {
      success: boolean
      security: {
        hasPassword: boolean
      }
    }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      security: {
        ...securitySnapshot,
        hasPassword: true,
      },
    })
    expect(accountSecurityMock.setInitialPassword).toHaveBeenCalledWith({
      userId: 'user-1',
      password: 'secret1',
    })
  })
})
