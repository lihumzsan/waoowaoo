import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/payments/stripe/wechat/status?paymentIntentId=pi_...
 *
 * Answers one question: have these credits landed in this user's balance yet?
 *
 * It reads our ledger rather than Stripe, because the ledger is what the user
 * is waiting on — Stripe reporting the payment succeeded is not the same fact
 * as the credits being spendable. The webhook remains the only thing that
 * credits; this is how the open QR dialog learns it happened.
 *
 * Scoped by user id, so one user cannot poll another's payment.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const paymentIntentId = request.nextUrl.searchParams.get('paymentIntentId')?.trim()
  if (!paymentIntentId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAYMENT_INTENT_ID_REQUIRED',
      field: 'paymentIntentId',
    })
  }

  // A WeChat payment buys either credits or a plan term, and each writes its
  // own ledger row under its own key. Checking only one of them leaves the
  // dialog spinning after a payment that actually succeeded.
  const applied = await prisma.balanceTransaction.findFirst({
    where: {
      userId: authResult.session.user.id,
      OR: [
        { type: 'recharge', idempotencyKey: `stripe:payment_intent:${paymentIntentId}` },
        { type: 'plan_purchase', idempotencyKey: `stripe:plan:${paymentIntentId}` },
      ],
    },
    select: { id: true, type: true, amount: true },
  })

  return NextResponse.json({
    success: true,
    credited: applied !== null,
    kind: applied?.type === 'plan_purchase' ? 'plan' : 'recharge',
    credits: applied?.amount ?? 0,
  })
})
