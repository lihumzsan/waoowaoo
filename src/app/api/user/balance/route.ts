import { NextResponse } from 'next/server'
import { getBalance } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { ensureCurrentPeriodGranted, getSubscriptionSnapshot } from '@/lib/billing/subscription-service'
import {
    daysUntilPlanEnds,
    isPlanExpiringSoon,
    LOW_BALANCE_THRESHOLD_CREDITS,
    referenceClipsRemaining,
    resolveBalanceHealth,
} from '@/lib/billing/low-balance'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * GET /api/user/balance
 *
 * Reports the two pools a balance is made of, plus the subscription that funds
 * one of them. The current period is granted here first: the scheduled sweep
 * is the normal driver, but a user opening the app must never see a month they
 * paid for as missing because a job did not run.
 */
export const GET = apiHandler(async () => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    await ensureCurrentPeriodGranted(session.user.id)
    const [balance, subscription] = await Promise.all([
        getBalance(session.user.id),
        getSubscriptionSnapshot(session.user.id),
    ])

    return NextResponse.json({
        success: true,
        currency: BILLING_CURRENCY,
        balance: balance.balance,
        rechargeCredits: balance.rechargeCredits,
        subscriptionCredits: balance.subscriptionCredits,
        subscriptionExpiresAt: balance.subscriptionExpiresAt?.toISOString() ?? null,
        frozenAmount: balance.frozenAmount,
        totalSpent: balance.totalSpent,
        health: resolveBalanceHealth(balance.balance),
        lowBalanceThreshold: LOW_BALANCE_THRESHOLD_CREDITS,
        referenceClipsRemaining: referenceClipsRemaining(balance.balance),
        subscription: subscription
            ? {
                planId: subscription.planId,
                interval: subscription.interval,
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
                daysLeft: daysUntilPlanEnds(subscription.currentPeriodEnd),
                expiringSoon: isPlanExpiringSoon(subscription.currentPeriodEnd),
            }
            : null,
    })
})
