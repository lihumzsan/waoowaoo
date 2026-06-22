import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
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
            id: 'user-payment-1',
            email: 'billing@example.test',
          },
        },
      }
    },
  }
})

function setPaymentEnv(): void {
  process.env.DEPLOYMENT_EDITION = 'cloud'
  process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
  process.env.BILLING_MODE = 'ENFORCE'
  process.env.PAYMENT_MIN_CREDITS = '5'
  process.env.PAYMENT_MAX_CREDITS = '1000'
  process.env.PAYMENT_CNY_TO_HKD_RATE = '1'
  process.env.PAYMENT_PUBLIC_BASE_URL = 'https://demo.example.test'
  process.env.STRIPE_SECRET_KEY = 'sk_test_payment_route'
}

function clearPaymentEnv(): void {
  delete process.env.DEPLOYMENT_EDITION
  delete process.env.PROVIDER_CREDENTIAL_MODE
  delete process.env.BILLING_MODE
  delete process.env.PAYMENT_MIN_CREDITS
  delete process.env.PAYMENT_MAX_CREDITS
  delete process.env.PAYMENT_CNY_TO_HKD_RATE
  delete process.env.PAYMENT_PUBLIC_BASE_URL
  delete process.env.STRIPE_SECRET_KEY
}

function readFormBody(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body
  if (!(body instanceof URLSearchParams)) {
    throw new Error('Expected URLSearchParams body')
  }
  return body
}

describe('api contract - payment routes', () => {
  beforeEach(() => {
    authState.authenticated = true
    setPaymentEnv()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    clearPaymentEnv()
  })

  it('GET /api/payments/recharge/config returns cloud recharge settings for authenticated users', async () => {
    const mod = await import('@/app/api/payments/recharge/config/route')
    const req = buildMockRequest({
      path: '/api/payments/recharge/config',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })
    const json = await res.json() as {
      success: boolean
      recharge: {
        enabled: boolean
        minCredits: number
        maxCredits: number
        cnyToHkdRate: number
      }
    }

    expect(res.status).toBe(200)
    expect(json.recharge).toMatchObject({
      enabled: true,
      minCredits: 5,
      maxCredits: 1000,
      cnyToHkdRate: 1,
    })
  })

  it('GET /api/payments/recharge/config reports missing payment env explicitly', async () => {
    delete process.env.PAYMENT_MIN_CREDITS

    const mod = await import('@/app/api/payments/recharge/config/route')
    const req = buildMockRequest({
      path: '/api/payments/recharge/config',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })
    const json = await res.json() as {
      error: {
        code: string
        details: {
          code: string
        }
      }
    }

    expect(res.status).toBe(400)
    expect(json.error.code).toBe('MISSING_CONFIG')
    expect(json.error.details.code).toBe('PAYMENT_MIN_CREDITS_REQUIRED')
  })

  it('POST /api/payments/stripe/checkout creates a Checkout session with HKD settlement metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        id: 'cs_test_payment_route',
        url: 'https://checkout.stripe.test/cs_test_payment_route',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/payments/stripe/checkout/route')
    const req = buildMockRequest({
      path: '/api/payments/stripe/checkout',
      method: 'POST',
      headers: { 'accept-language': 'zh-CN' },
      body: { credits: 10 },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    const json = await res.json() as {
      success: boolean
      sessionId: string
      url: string
      quote: {
        credits: number
        settlementAmount: number
        settlementUnitAmount: number
      }
    }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      sessionId: 'cs_test_payment_route',
      url: 'https://checkout.stripe.test/cs_test_payment_route',
      quote: {
        credits: 10,
        settlementAmount: 10,
        settlementUnitAmount: 1000,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const body = readFormBody(init)
    expect(body.get('mode')).toBe('payment')
    expect(body.get('automatic_payment_methods[enabled]')).toBe('true')
    expect(body.get('line_items[0][price_data][currency]')).toBe('hkd')
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1000')
    expect(body.get('line_items[0][price_data][product_data][name]')).toBe('WaooAI 额度')
    expect(body.get('metadata[waoowaoo_kind]')).toBe('credit_recharge')
    expect(body.get('metadata[user_id]')).toBe('user-payment-1')
    expect(body.get('metadata[credits]')).toBe('10.00')
    expect(body.get('metadata[settlement_currency]')).toBe('hkd')
    expect(body.get('payment_intent_data[metadata][credits]')).toBe('10.00')
    expect(body.get('success_url')).toBe('https://demo.example.test/zh/profile?section=billing&payment=success&session_id={CHECKOUT_SESSION_ID}')
  })

  it('POST /api/payments/stripe/checkout rejects unauthenticated users before creating Stripe sessions', async () => {
    authState.authenticated = false
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/payments/stripe/checkout/route')
    const req = buildMockRequest({
      path: '/api/payments/stripe/checkout',
      method: 'POST',
      body: { credits: 10 },
    })

    const res = await mod.POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})
