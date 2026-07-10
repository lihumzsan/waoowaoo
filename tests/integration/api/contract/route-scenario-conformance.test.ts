import { describe, expect, it, vi } from 'vitest'
import { ROUTE_FILES } from '../../../contracts/route-catalog'
import { ROUTE_SCENARIO_REGISTRY } from '../../../contracts/route-scenario-registry'
import { createScenarioExecutionLedger } from '../../../harness/behavior-scenario'

const unauthorized = () => new Response(
  JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
  { status: 401, headers: { 'content-type': 'application/json' } },
)

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireUserAuth: async () => unauthorized(),
  requireProjectAuth: async () => unauthorized(),
  requireProjectAuthLight: async () => unauthorized(),
}))

vi.mock('@/lib/media/storage-access-policy', () => ({
  authorizeStorageObjectRead: async () => unauthorized(),
}))

vi.mock('@/lib/payments/stripe-webhook', () => ({
  handleStripeWebhook: async () => ({ received: true }),
}))

vi.mock('@/lib/rate-limit', () => ({
  AUTH_LOGIN_LIMIT: { limit: 10, windowSeconds: 60 },
  AUTH_REGISTER_LIMIT: { limit: 10, windowSeconds: 60 },
  checkRateLimit: async () => ({ limited: false, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}))

vi.mock('next-auth', () => ({
  default: () => async () => new Response(JSON.stringify({ session: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
}))

describe('route executable scenario registry', () => {
  it('invokes every route and records every declared scenario exactly once', async () => {
    const expectedIds = ROUTE_SCENARIO_REGISTRY.map((scenario) => scenario.id)
    const ledger = createScenarioExecutionLedger(expectedIds)

    for (const scenario of ROUTE_SCENARIO_REGISTRY) {
      await scenario.execute(ledger)
    }

    expect(ROUTE_SCENARIO_REGISTRY).toHaveLength(ROUTE_FILES.length)
    expect(() => ledger.assertExact()).not.toThrow()
  }, 120_000)
})
