import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

/**
 * Project whether a wallet payment has reached this user's local ledger.
 * Stripe state is deliberately not treated as spendable balance.
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
