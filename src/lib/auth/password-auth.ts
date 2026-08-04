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
    logAuthAction('LOGIN', 'Password auth disabled', { success: false, provider: 'password' })
    return null
  }

  const name = normalizeUsername(input.username)
  const password = normalizePassword(input.password)
  if (!name || !password) {
    logAuthAction('LOGIN', 'Missing credentials', { success: false, provider: 'password' }, undefined, name || undefined)
    return null
  }

  const existingUser = await readPasswordUser(name)
  if (existingUser) {
    if (!existingUser.password || !await bcrypt.compare(password, existingUser.password)) {
      logAuthAction('LOGIN', 'Invalid password', { success: false, provider: 'password' }, existingUser.id, name)
      return null
    }

    logAuthAction('LOGIN', 'Password login succeeded', { success: true, provider: 'password' }, existingUser.id, name)
    return {
      id: existingUser.id,
      name: existingUser.name,
    }
  }

  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    logAuthAction('REGISTER', 'Password too short', { success: false, provider: 'password' }, undefined, name)
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
    logAuthAction('REGISTER', 'Password registration succeeded', { success: true, provider: 'password' }, user.id, name)
    return {
      id: user.id,
      name: user.name,
    }
  } catch (error) {
    if (getPrismaErrorCode(error) !== 'P2002') throw error

    const concurrentUser = await readPasswordUser(name)
    if (!concurrentUser?.password || !await bcrypt.compare(password, concurrentUser.password)) {
      logAuthAction('LOGIN', 'Concurrent registration conflict', { success: false, provider: 'password' }, undefined, name)
      return null
    }

    logAuthAction('LOGIN', 'Password login succeeded after concurrent registration', { success: true, provider: 'password' }, concurrentUser.id, name)
    return {
      id: concurrentUser.id,
      name: concurrentUser.name,
    }
  }
}
