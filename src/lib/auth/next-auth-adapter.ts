import { PrismaAdapter } from '@next-auth/prisma-adapter'
import type { Adapter, AdapterUser } from 'next-auth/adapters'
import { createAuthUser } from '@/lib/auth/account-onboarding'
import { prisma } from '@/lib/prisma'

interface AuthUserRecord {
  id: string
  name: string | null
  email: string | null
  emailVerified: Date | null
  image: string | null
}

interface GoogleAccountImageInput {
  providerAccountId: string
  image: string
}

function normalizeOAuthEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!normalized) {
    throw new Error('GOOGLE_OAUTH_EMAIL_MISSING')
  }
  return normalized
}

function toAdapterUser(user: AuthUserRecord): AdapterUser {
  if (!user.email) {
    throw new Error(`AUTH_ADAPTER_USER_EMAIL_MISSING:${user.id}`)
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
  }
}

export async function syncLinkedGoogleAccountImage(input: GoogleAccountImageInput): Promise<void> {
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'google',
        providerAccountId: input.providerAccountId,
      },
    },
    select: {
      userId: true,
      user: {
        select: { image: true },
      },
    },
  })

  if (!account) {
    throw new Error('GOOGLE_ACCOUNT_LINK_MISSING')
  }
  if (account.user.image === input.image) return

  await prisma.user.update({
    where: { id: account.userId },
    data: { image: input.image },
  })
}

export function createAuthAdapter(): Adapter {
  const baseAdapter = PrismaAdapter(prisma) as Adapter

  return {
    ...baseAdapter,
    async getUserByEmail(email) {
      const normalizedEmail = normalizeOAuthEmail(email)
      const user = await prisma.user.findFirst({
        where: { email: normalizedEmail },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
        },
      })

      return user ? toAdapterUser(user) : null
    },
    createUser: async (user: Omit<AdapterUser, 'id'>): Promise<AdapterUser> => {
      const email = normalizeOAuthEmail(user.email)
      const created = await prisma.$transaction(async (tx) => {
        const emailVerified = user.emailVerified ?? new Date()
        return await createAuthUser(tx, {
          name: email,
          email,
          emailVerified,
          image: user.image ?? null,
        })
      })

      return toAdapterUser(created)
    },
  }
}
