import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { handleStripeWebhook } from '@/lib/payments/stripe-webhook'
import { readRequestBufferWithLimit } from '@/lib/http/body-limits'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const rawBody = (await readRequestBufferWithLimit(request, 1024 * 1024, 'Stripe webhook')).toString('utf8')
  const result = await handleStripeWebhook(rawBody, request.headers.get('stripe-signature'))
  return NextResponse.json(result)
})
