import bcrypt from 'bcryptjs'
import { createAuthUser } from '@/lib/auth/account-onboarding'
import { readPasswordAuthMode, type PasswordAuthMode } from '@/lib/auth/password-auth-contract'
import { AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth/password-policy'
import { maskPhoneNumber, normalizePhoneNumber } from '@/lib/auth/phone-number'
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

async function readUsernamePasswordUser(name: string) {
  return await prisma.user.findUnique({
    where: { name },
    select: {
      id: true,
      name: true,
      password: true,
    },
  })
}

async function readPhonePasswordUser(phoneNumber: string) {
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'phone',
        providerAccountId: phoneNumber,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          password: true,
        },
      },
    },
  })
  return account?.user ?? null
}

function toPasswordAuthUser(user: PasswordAuthUser): PasswordAuthUser {
  return {
    id: user.id,
    name: user.name,
  }
}

async function verifyPasswordUser(input: {
  user: Awaited<ReturnType<typeof readUsernamePasswordUser>>
  password: string
  identityForLog: string
}): Promise<PasswordAuthUser | null> {
  if (!input.user?.password || !await bcrypt.compare(input.password, input.user.password)) {
    logAuthAction(
      'LOGIN',
      'Invalid password credentials',
      { success: false, provider: 'password' },
      input.user?.id,
      input.identityForLog,
    )
    return null
  }

  logAuthAction(
    'LOGIN',
    'Password login succeeded',
    { success: true, provider: 'password' },
    input.user.id,
    input.identityForLog,
  )
  return toPasswordAuthUser(input.user)
}

async function authorizeUsernamePassword(input: {
  identity: unknown
  password: unknown
  mode: PasswordAuthMode
}): Promise<PasswordAuthUser | null> {
  const name = normalizeUsername(input.identity)
  if (!name) {
    logAuthAction(input.mode === 'register' ? 'REGISTER' : 'LOGIN', 'Missing username', {
      success: false,
      provider: 'password',
    })
    return null
  }

  const password = normalizePassword(input.password)
  if (input.mode === 'login') {
    return await verifyPasswordUser({
      user: await readUsernamePasswordUser(name),
      password,
      identityForLog: name,
    })
  }

  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    logAuthAction('REGISTER', 'Password too short', { success: false, provider: 'password' }, undefined, name)
    return null
  }

  const hashedPassword = await bcrypt.hash(password, 12)
  try {
    const user = await prisma.$transaction(async (tx) => (
      await createAuthUser(tx, {
        name,
        password: hashedPassword,
      })
    ))
    logAuthAction('REGISTER', 'Password registration succeeded', { success: true, provider: 'password' }, user.id, name)
    return toPasswordAuthUser(user)
  } catch (error) {
    if (getPrismaErrorCode(error) !== 'P2002') throw error
    logAuthAction('REGISTER', 'Username already registered', {
      success: false,
      provider: 'password',
    }, undefined, name)
    return null
  }
}

async function authorizePhonePassword(input: {
  identity: unknown
  password: unknown
  mode: PasswordAuthMode
}): Promise<PasswordAuthUser | null> {
  const phoneNumber = normalizePhoneNumber(input.identity)
  const password = normalizePassword(input.password)
  const maskedPhone = phoneNumber ? maskPhoneNumber(phoneNumber) : undefined
  if (!phoneNumber) {
    logAuthAction(input.mode === 'register' ? 'REGISTER' : 'LOGIN', 'Invalid phone identity', {
      success: false,
      provider: 'password',
    })
    return null
  }

  if (input.mode === 'login') {
    return await verifyPasswordUser({
      user: await readPhonePasswordUser(phoneNumber),
      password,
      identityForLog: maskedPhone ?? 'invalid-phone',
    })
  }

  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    logAuthAction('REGISTER', 'Password too short', {
      success: false,
      provider: 'password',
    }, undefined, maskedPhone)
    return null
  }

  if (await readPhonePasswordUser(phoneNumber)) {
    logAuthAction('REGISTER', 'Phone identity already registered', {
      success: false,
      provider: 'password',
    }, undefined, maskedPhone)
    return null
  }

  const hashedPassword = await bcrypt.hash(password, 12)
  try {
    const user = await prisma.$transaction(async (tx) => (
      await createAuthUser(tx, {
        name: phoneNumber,
        password: hashedPassword,
        account: {
          type: 'credentials',
          provider: 'phone',
          providerAccountId: phoneNumber,
        },
      })
    ))
    logAuthAction('REGISTER', 'Phone password registration succeeded', {
      success: true,
      provider: 'password',
    }, user.id, maskedPhone)
    return toPasswordAuthUser(user)
  } catch (error) {
    if (getPrismaErrorCode(error) !== 'P2002') throw error
    logAuthAction('REGISTER', 'Phone registration conflict', {
      success: false,
      provider: 'password',
    }, undefined, maskedPhone)
    return null
  }
}

export async function authorizePasswordIdentity(input: {
  identity: unknown
  password: unknown
  mode: unknown
}): Promise<PasswordAuthUser | null> {
  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.enablePasswordAuth) {
    logAuthAction('LOGIN', 'Password auth disabled', { success: false, provider: 'password' })
    return null
  }

  const mode = readPasswordAuthMode(input.mode)
  if (!mode) {
    logAuthAction('LOGIN', 'Password auth mode invalid', { success: false, provider: 'password' })
    return null
  }

  return features.passwordAuthIdentity === 'phone'
    ? await authorizePhonePassword({ ...input, mode })
    : await authorizeUsernamePassword({ ...input, mode })
}
