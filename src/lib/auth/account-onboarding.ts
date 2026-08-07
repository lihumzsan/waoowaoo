import type { Prisma } from '@prisma/client'
import { addBalanceWithTransaction } from '@/lib/billing/ledger'
import { resolveSignupGrantCredits } from '@/lib/billing/signup-grant'

export interface AuthAccountIdentityInput {
  type: 'credentials' | 'oauth'
  provider: 'phone' | 'wechat-official'
  providerAccountId: string
}

export interface CreateAuthUserInput {
  name: string
  password?: string | null
  email?: string | null
  emailVerified?: Date | null
  image?: string | null
  account?: AuthAccountIdentityInput
}

export interface CreatedAuthUser {
  id: string
  name: string
  email: string | null
  emailVerified: Date | null
  image: string | null
}

export type AuthOnboardingTx = Prisma.TransactionClient


export async function createAuthUser(
  tx: AuthOnboardingTx,
  input: CreateAuthUserInput,
): Promise<CreatedAuthUser> {
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
      subscriptionCredits: 0,
      subscriptionExpiresAt: null,
      frozenAmount: 0,
      totalSpent: 0,
    },
  })

  // New accounts start with enough credit to run one real generation end to
  // end. Nobody buys a plan before seeing the product work once, and a signup
  // that lands on an empty balance cannot show them.
  const signupGrant = resolveSignupGrantCredits()
  if (signupGrant > 0) {
    await addBalanceWithTransaction(tx, user.id, signupGrant, {
      type: 'adjust',
      reason: 'signup welcome credits',
      operatorId: 'signup-grant',
      idempotencyKey: `signup:${user.id}`,
    })
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
