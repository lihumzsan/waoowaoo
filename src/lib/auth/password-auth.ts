import bcrypt from 'bcryptjs'
import { createAuthUser, readSignupInviteInput } from '@/lib/auth/account-onboarding'
import { AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth/password-policy'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { logAuthAction } from '@/lib/logging/semantic'
import { prisma } from '@/lib/prisma'
import { getPrismaErrorCode } from '@/lib/prisma-error'

export interface PasswordAuthUser {
  id: string
  name: string
}

function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePassword(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function readPasswordUser(name: string) {
  return await prisma.user.findUnique({
    where: { name },
    select: {
      id: true,
      name: true,
      password: true,
    },
  })
}

export async function authorizePasswordIdentity(input: {
  username: unknown
  password: unknown
}): Promise<PasswordAuthUser | null> {
  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.enablePasswordAuth) {
    logAuthAction('LOGIN', 'password', { error: 'Password auth disabled' })
    return null
  }

  const name = normalizeUsername(input.username)
  const password = normalizePassword(input.password)
  if (!name || !password) {
    logAuthAction('LOGIN', name || 'unknown', { error: 'Missing credentials' })
    return null
  }

  const existingUser = await readPasswordUser(name)
  if (existingUser) {
    if (!existingUser.password || !await bcrypt.compare(password, existingUser.password)) {
      logAuthAction('LOGIN', name, { error: 'Invalid password' })
      return null
    }

    logAuthAction('LOGIN', name, { userId: existingUser.id, success: true })
    return {
      id: existingUser.id,
      name: existingUser.name,
    }
  }

  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    logAuthAction('REGISTER', name, { error: 'Password too short' })
    return null
  }

  const hashedPassword = await bcrypt.hash(password, 12)
  const inviteCode = readSignupInviteInput({})
  try {
    const user = await prisma.$transaction(async (tx) => (
      await createAuthUser(tx, {
        name,
        password: hashedPassword,
        inviteCode,
      })
    ))
    logAuthAction('REGISTER', name, { userId: user.id, success: true })
    return {
      id: user.id,
      name: user.name,
    }
  } catch (error) {
    if (getPrismaErrorCode(error) !== 'P2002') throw error

    const concurrentUser = await readPasswordUser(name)
    if (!concurrentUser?.password || !await bcrypt.compare(password, concurrentUser.password)) {
      logAuthAction('LOGIN', name, { error: 'Concurrent registration conflict' })
      return null
    }

    logAuthAction('LOGIN', name, { userId: concurrentUser.id, success: true })
    return {
      id: concurrentUser.id,
      name: concurrentUser.name,
    }
  }
}
