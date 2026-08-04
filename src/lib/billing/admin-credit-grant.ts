import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { addBalanceWithTransaction } from './ledger'
import { assertCreditAmount } from './credits'

/**
 * Hand credits to a user by operator action.
 *
 * The only way credits enter a balance without a payment. It goes through the
 * same ledger writer as everything else so the grant is an ordinary, auditable
 * row rather than a direct balance edit, and it carries an idempotency key so
 * a retried operator request cannot double-grant.
 */
export async function grantUserCredits(input: {
  userId?: string | null
  userName?: string | null
  amount: number
  operatorId: string
  reason: string
  idempotencyKey?: string | null
}) {
  const amount = assertCreditAmount(Math.floor(input.amount), 'amount')
  if (amount <= 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ADMIN_CREDIT_GRANT_AMOUNT_INVALID',
      field: 'amount',
    })
  }

  await prisma.$transaction(async (tx) => {
    const userSelector = input.userId
      ? { id: input.userId }
      : input.userName
        ? { name: input.userName }
        : null

    if (!userSelector) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'ADMIN_CREDIT_GRANT_USER_REQUIRED',
        field: 'userId',
      })
    }

    const user = await tx.user.findUnique({
      where: userSelector,
      select: { id: true },
    })
    if (!user) {
      throw new ApiError('NOT_FOUND')
    }

    await addBalanceWithTransaction(tx, user.id, amount, {
      type: 'adjust',
      reason: input.reason,
      operatorId: input.operatorId,
      externalOrderId: input.idempotencyKey || undefined,
      idempotencyKey: input.idempotencyKey || `manual:${input.operatorId}:${user.id}:${amount}:${input.reason}`,
    })
  })

  return { success: true, amount }
}
