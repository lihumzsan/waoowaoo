import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { hashInviteCode } from '@/lib/billing/invite-codes'
import { addBalanceWithTransaction } from '@/lib/billing/ledger'
import { toMoneyNumber } from '@/lib/billing/money'

export interface AuthAccountIdentityInput {
  type: 'credentials' | 'oauth'
  provider: 'phone'
  providerAccountId: string
}

export interface CreateAuthUserInput {
  name: string
  password?: string | null
  email?: string | null
  emailVerified?: Date | null
  image?: string | null
  account?: AuthAccountIdentityInput
  inviteCode?: string | null
}

export interface CreatedAuthUser {
  id: string
  name: string
  email: string | null
  emailVerified: Date | null
  image: string | null
}

export type AuthOnboardingTx = Prisma.TransactionClient

function readInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

async function claimRegistrationInviteCode(tx: AuthOnboardingTx, userId: string, rawCode: string): Promise<void> {
  const codeHash = hashInviteCode(rawCode)
  const inviteCode = await tx.inviteCode.findUnique({
    where: { codeHash },
  })

  if (!inviteCode) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_INVALID',
      field: 'inviteCode',
    })
  }

  if (inviteCode.disabledAt) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_DISABLED',
      field: 'inviteCode',
    })
  }

  if (inviteCode.expiresAt && inviteCode.expiresAt.getTime() < Date.now()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_EXPIRED',
      field: 'inviteCode',
    })
  }

  if (inviteCode.maxRedemptions !== null && inviteCode.redeemedCount >= inviteCode.maxRedemptions) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_EXHAUSTED',
      field: 'inviteCode',
    })
  }

  const amount = toMoneyNumber(inviteCode.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_AMOUNT_INVALID',
      field: 'inviteCode',
    })
  }

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
      field: 'inviteCode',
    })
  }

  await tx.inviteRedemption.create({
    data: {
      inviteCodeId: inviteCode.id,
      userId,
      amount,
    },
  })

  await addBalanceWithTransaction(tx, userId, amount, {
    type: 'adjust',
    reason: 'registration invite code',
    operatorId: 'invite-code',
    externalOrderId: inviteCode.id,
    idempotencyKey: `invite:${inviteCode.id}:${userId}`,
  })
}

export function readSignupInviteInput(input: { inviteCode?: unknown }): string | null {
  const features = getDeploymentFeatures(getDeploymentConfig())
  const inviteCode = readInviteCode(input.inviteCode)

  if (inviteCode) return inviteCode

  if (!features.requireInviteCodeOnSignup) return null
  throw new ApiError('INVALID_PARAMS', {
    code: 'INVITE_CODE_REQUIRED',
    field: 'inviteCode',
  })
}

export async function createAuthUser(
  tx: AuthOnboardingTx,
  input: CreateAuthUserInput,
): Promise<CreatedAuthUser> {
  const inviteCode = readInviteCode(input.inviteCode)

  const user = await tx.user.create({
    data: {
      name: input.name,
      password: input.password ?? null,
      email: input.email ?? null,
      emailVerified: input.emailVerified ?? null,
      image: input.image ?? null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
    },
  })

  await tx.userBalance.create({
    data: {
      userId: user.id,
      balance: 0,
      frozenAmount: 0,
      totalSpent: 0,
    },
  })

  if (inviteCode) {
    await claimRegistrationInviteCode(tx, user.id, inviteCode)
  }

  if (input.account) {
    await tx.account.create({
      data: {
        userId: user.id,
        type: input.account.type,
        provider: input.account.provider,
        providerAccountId: input.account.providerAccountId,
      },
    })
  }

  return user
}
