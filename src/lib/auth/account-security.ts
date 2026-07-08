import bcrypt from 'bcryptjs'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const ACCOUNT_SECURITY_PASSWORD_MIN_LENGTH = 6

export const ACCOUNT_SECURITY_RESULT_CODES = {
  bodyParseFailed: 'ACCOUNT_SECURITY_BODY_PARSE_FAILED',
  passwordPayloadInvalid: 'ACCOUNT_SECURITY_PASSWORD_PAYLOAD_INVALID',
  passwordTooShort: 'ACCOUNT_SECURITY_PASSWORD_TOO_SHORT',
  passwordAlreadySet: 'ACCOUNT_SECURITY_PASSWORD_ALREADY_SET',
  currentPasswordRequired: 'ACCOUNT_SECURITY_CURRENT_PASSWORD_REQUIRED',
  currentPasswordInvalid: 'ACCOUNT_SECURITY_CURRENT_PASSWORD_INVALID',
  userNotFound: 'ACCOUNT_SECURITY_USER_NOT_FOUND',
} as const

export type AccountSecurityResultCode =
  typeof ACCOUNT_SECURITY_RESULT_CODES[keyof typeof ACCOUNT_SECURITY_RESULT_CODES]

export type AccountSecuritySnapshot = {
  email: string | null
  displayName: string
  hasPassword: boolean
  providers: {
    google: {
      linked: boolean
    }
  }
}

function trimOptional(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function throwInvalidParams(code: AccountSecurityResultCode): never {
  throw new ApiError('INVALID_PARAMS', { code, message: code })
}

function throwConflict(code: AccountSecurityResultCode): never {
  throw new ApiError('CONFLICT', { code, message: code })
}

function throwNotFound(code: AccountSecurityResultCode): never {
  throw new ApiError('NOT_FOUND', { code, message: code })
}

export function validateInitialPassword(password: string): void {
  if (password.length < ACCOUNT_SECURITY_PASSWORD_MIN_LENGTH) {
    throwInvalidParams(ACCOUNT_SECURITY_RESULT_CODES.passwordTooShort)
  }
}

export async function getAccountSecurity(userId: string): Promise<AccountSecuritySnapshot> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      password: true,
      accounts: {
        select: {
          provider: true,
        },
      },
    },
  })

  if (!user) {
    throwNotFound(ACCOUNT_SECURITY_RESULT_CODES.userNotFound)
  }

  const email = trimOptional(user.email)
  const displayName = email || user.name
  const googleLinked = user.accounts.some((account) => account.provider === 'google')

  return {
    email,
    displayName,
    hasPassword: user.password !== null,
    providers: {
      google: {
        linked: googleLinked,
      },
    },
  }
}

export async function setInitialPassword(input: {
  userId: string
  password: string
}): Promise<AccountSecuritySnapshot> {
  validateInitialPassword(input.password)

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      password: true,
    },
  })

  if (!user) {
    throwNotFound(ACCOUNT_SECURITY_RESULT_CODES.userNotFound)
  }

  if (user.password !== null) {
    throwConflict(ACCOUNT_SECURITY_RESULT_CODES.passwordAlreadySet)
  }

  const hashedPassword = await bcrypt.hash(input.password, 12)
  const updated = await prisma.user.updateMany({
    where: {
      id: input.userId,
      password: null,
    },
    data: {
      password: hashedPassword,
    },
  })

  if (updated.count !== 1) {
    throwConflict(ACCOUNT_SECURITY_RESULT_CODES.passwordAlreadySet)
  }

  return await getAccountSecurity(input.userId)
}

export async function setAccountPassword(input: {
  userId: string
  password: string
  currentPassword?: string
}): Promise<AccountSecuritySnapshot> {
  validateInitialPassword(input.password)

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      password: true,
    },
  })

  if (!user) {
    throwNotFound(ACCOUNT_SECURITY_RESULT_CODES.userNotFound)
  }

  if (user.password === null) {
    return await setInitialPassword({
      userId: input.userId,
      password: input.password,
    })
  }

  if (!input.currentPassword) {
    throwInvalidParams(ACCOUNT_SECURITY_RESULT_CODES.currentPasswordRequired)
  }

  const currentPasswordValid = await bcrypt.compare(input.currentPassword, user.password)
  if (!currentPasswordValid) {
    throwInvalidParams(ACCOUNT_SECURITY_RESULT_CODES.currentPasswordInvalid)
  }

  const hashedPassword = await bcrypt.hash(input.password, 12)
  await prisma.user.update({
    where: {
      id: input.userId,
    },
    data: {
      password: hashedPassword,
    },
  })

  return await getAccountSecurity(input.userId)
}
