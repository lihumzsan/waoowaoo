import { describeUnknownError } from '@/lib/errors/normalize'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import {
  handleStripeWebhook,
  isPermanentStripeWebhookRejection,
  readStripeWebhookErrorCode,
} from '@/lib/payments/stripe-webhook'
import { readRequestBufferWithLimit } from '@/lib/http/body-limits'

export const runtime = 'nodejs'

const logger = createScopedLogger({
  module: 'payments.stripe_webhook',
})

export const POST = apiHandler(async (request: NextRequest) => {
  const rawBody = (await readRequestBufferWithLimit(request, 1024 * 1024, 'Stripe webhook')).toString('utf8')
  try {
    const result = await handleStripeWebhook(rawBody, request.headers.get('stripe-signature'))
    logger.info({
      action: 'stripe_webhook.handled',
      message: 'stripe webhook handled',
      details: { ...result },
    })
    // Stripe only reads the status code; ledger details stay out of its event log.
    return NextResponse.json({ received: true })
  } catch (error) {
    const code = readStripeWebhookErrorCode(error)
    const errorDetails = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'UnknownError', message: describeUnknownError(error) }
    if (isPermanentStripeWebhookRejection(error)) {
      logger.error({
        action: 'stripe_webhook.rejected',
        message: 'stripe webhook permanently rejected; stripe will stop redelivery',
        details: { code },
        error: errorDetails,
      })
      return NextResponse.json({ received: false, code }, { status: 400 })
    }
    logger.error({
      action: 'stripe_webhook.retryable_failure',
      message: 'stripe webhook processing failed; stripe will redeliver',
      details: { code },
      error: errorDetails,
    })
    return NextResponse.json({ received: false }, { status: 500 })
  }
})
