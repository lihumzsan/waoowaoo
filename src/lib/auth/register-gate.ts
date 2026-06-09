import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { hashInviteCode } from '@/lib/billing/invite-codes'

export interface RegisterUserInput {
  name: string
  hashedPassword: string
  inviteCode?: string | null
}

export interface RegisteredUserResult {
  id: string
  name: string
}

type RegistrationTx = Prisma.TransactionClient

function readInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

async function claimRegistrationInviteCode(tx: RegistrationTx, userId: string, rawCode: string): Promise<void> {
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
      amount: 0,
    },
  })
}

export function assertRegistrationInviteInput(input: { inviteCode?: unknown }): string | null {
  const deployment = getDeploymentConfig()
  if (deployment.edition !== 'cloud') return null

  const inviteCode = readInviteCode(input.inviteCode)
  if (!inviteCode) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVITE_CODE_REQUIRED',
      field: 'inviteCode',
    })
  }
  return inviteCode
}

export async function createRegisteredUser(tx: RegistrationTx, input: RegisterUserInput): Promise<RegisteredUserResult> {
  const inviteCode = assertRegistrationInviteInput({ inviteCode: input.inviteCode })

  const user = await tx.user.create({
    data: {
      name: input.name,
      password: input.hashedPassword,
    },
    select: {
      id: true,
      name: true,
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

  return {
    id: user.id,
    name: user.name,
  }
}
