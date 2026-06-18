import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { handleStripeWebhook } from '@/lib/payments/stripe-webhook'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const rawBody = await request.text()
  const result = await handleStripeWebhook(rawBody, request.headers.get('stripe-signature'))
  return NextResponse.json(result)
})
