import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { toMoneyNumber } from './money'
import { addBalanceWithTransaction } from './ledger'

const INVITE_CODE_NORMALIZE_PATTERN = /\s+/g

function normalizeInviteCode(code: string): string {
  return code.trim().replace(INVITE_CODE_NORMALIZE_PATTERN, '').toUpperCase()
}

export function hashInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code)
  if (!normalized) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_REQUIRED',
      field: 'code',
    })
  }
  return createHash('sha256').update(normalized).digest('hex')
}

function normalizePositiveAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_AMOUNT_INVALID',
      field: 'amount',
    })
  }
  return Math.round(amount * 1_000_000) / 1_000_000
}

export async function createInviteCode(input: {
  code: string
  amount: number
  maxRedemptions?: number | null
  expiresAt?: Date | null
  description?: string | null
  createdBy?: string | null
}) {
  const amount = normalizePositiveAmount(input.amount)
  const maxRedemptions = input.maxRedemptions === undefined || input.maxRedemptions === null
    ? null
    : Math.max(1, Math.floor(input.maxRedemptions))

  const inviteCode = await prisma.inviteCode.create({
    data: {
      codeHash: hashInviteCode(input.code),
      amount,
      maxRedemptions,
      expiresAt: input.expiresAt ?? null,
      description: input.description ?? null,
      createdBy: input.createdBy ?? null,
    },
  })

  return {
    id: inviteCode.id,
    amount: toMoneyNumber(inviteCode.amount),
    maxRedemptions: inviteCode.maxRedemptions,
    expiresAt: inviteCode.expiresAt,
    disabledAt: inviteCode.disabledAt,
    redeemedCount: inviteCode.redeemedCount,
  }
}

export async function redeemInviteCode(input: {
  userId: string
  code: string
}) {
  const codeHash = hashInviteCode(input.code)

  try {
    return await prisma.$transaction(async (tx) => {
      const inviteCode = await tx.inviteCode.findUnique({
        where: { codeHash },
      })

      if (!inviteCode) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'INVITE_CODE_INVALID',
          field: 'code',
        })
      }

      if (inviteCode.disabledAt) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'INVITE_CODE_DISABLED',
          field: 'code',
        })
      }

      if (inviteCode.expiresAt && inviteCode.expiresAt.getTime() < Date.now()) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'INVITE_CODE_EXPIRED',
          field: 'code',
        })
      }

      if (inviteCode.maxRedemptions !== null && inviteCode.redeemedCount >= inviteCode.maxRedemptions) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'INVITE_CODE_EXHAUSTED',
          field: 'code',
        })
      }

      const amount = toMoneyNumber(inviteCode.amount)
      const claimed = await tx.inviteCode.updateMany({
        where: {
          id: inviteCode.id,
          disabledAt: null,
          ...(inviteCode.expiresAt ? { expiresAt: { gt: new Date() } } : {}),
          ...(inviteCode.maxRedemptions === null ? {} : { redeemedCount: { lt: inviteCode.maxRedemptions } }),
        },
        data: {
          redeemedCount: { increment: 1 },
        },
      })

      if (claimed.count === 0) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'INVITE_CODE_UNAVAILABLE',
          field: 'code',
        })
      }

      const redemption = await tx.inviteRedemption.create({
        data: {
          inviteCodeId: inviteCode.id,
          userId: input.userId,
          amount,
        },
      })

      await addBalanceWithTransaction(tx, input.userId, amount, {
        type: 'adjust',
        reason: 'invite code redemption',
        operatorId: 'invite-code',
        externalOrderId: inviteCode.id,
        idempotencyKey: `invite:${inviteCode.id}:${input.userId}`,
      })

      return {
        success: true,
        amount,
        redemptionId: redemption.id,
      }
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'INVITE_CODE_ALREADY_REDEEMED',
        field: 'code',
      })
    }
    throw error
  }
}

export async function grantUserCredits(input: {
  userId?: string | null
  userName?: string | null
  amount: number
  operatorId: string
  reason: string
  idempotencyKey?: string | null
}) {
  const amount = normalizePositiveAmount(input.amount)
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
