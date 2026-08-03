import { prisma } from '@/lib/prisma'
import { getBillingMode } from './mode'
import { InsufficientBalanceError } from './errors'
import { usableCredits } from './credit-pools'
import { ensureCurrentPeriodGranted } from './subscription-service'

/**
 * Pre-flight balance check for language-model work.
 *
 * Model usage is billed after the fact, once a day, because its price is only
 * knowable once the call has run. That leaves one gap the ledger cannot close
 * on its own: a user with nothing left could keep generating and the platform
 * would keep paying. This is the check that closes it.
 *
 * It is deliberately a floor, not a quote. It asks "does this user have any
 * credit at all", not "can they afford this turn" — the latter is unknowable
 * before the model runs, and pretending otherwise would mean inventing an
 * estimate and refusing work against it.
 */
export async function assertLlmSpendableBalance(userId: string): Promise<void> {
  if (await getBillingMode() !== 'ENFORCE') return

  // A user whose new period is due but ungranted has credits they paid for;
  // granting first means the gate never rejects on a stale pool.
  await ensureCurrentPeriodGranted(userId)

  const balance = await prisma.userBalance.findUnique({ where: { userId } })
  const available = balance
    ? usableCredits(
        {
          rechargeCredits: balance.balance,
          subscriptionCredits: balance.subscriptionCredits,
          subscriptionExpiresAt: balance.subscriptionExpiresAt,
        },
        new Date(),
      )
    : 0

  if (available <= 0) {
    throw new InsufficientBalanceError(1, available)
  }
}
