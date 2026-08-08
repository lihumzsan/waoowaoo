import { randomBytes } from 'node:crypto'
import { createAuthUser } from '@/lib/auth/account-onboarding'
import {
  readWechatOfficialConfig,
  WECHAT_OFFICIAL_RESULT_CODES,
  WechatOfficialError,
} from '@/lib/auth/wechat-official-config'
import { prisma } from '@/lib/prisma'
import { getPrismaErrorCode } from '@/lib/prisma-error'

export const WECHAT_OFFICIAL_ACCOUNT_PROVIDER = 'wechat-official'

function providerAccountId(appId: string, openId: string): string {
  return `${appId}:${openId}`
}

function createInitialDisplayName(): string {
  return `wx-${randomBytes(8).toString('hex')}`
}

async function findWechatAccount(identity: string) {
  return await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
        providerAccountId: identity,
      },
    },
    select: { userId: true },
  })
}

async function resolveLoginIdentity(identity: string): Promise<string> {
  const existing = await findWechatAccount(identity)
  if (existing) return existing.userId

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const user = await prisma.$transaction(async (tx) => await createAuthUser(tx, {
        name: createInitialDisplayName(),
        account: {
          type: 'oauth',
          provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
          providerAccountId: identity,
        },
      }))
      return user.id
    } catch (error) {
      if (getPrismaErrorCode(error) !== 'P2002') throw error
      const raced = await findWechatAccount(identity)
      if (raced) return raced.userId
    }
  }
  throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.providerUnavailable)
}

async function resolveBindingIdentity(identity: string, targetUserId: string): Promise<string> {
  const existing = await findWechatAccount(identity)
  if (existing) {
    if (existing.userId !== targetUserId) {
      throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.identityConflict)
    }
    return targetUserId
  }

  try {
    await prisma.account.create({
      data: {
        userId: targetUserId,
        type: 'oauth',
        provider: WECHAT_OFFICIAL_ACCOUNT_PROVIDER,
        providerAccountId: identity,
      },
    })
    return targetUserId
  } catch (error) {
    if (getPrismaErrorCode(error) !== 'P2002') throw error
    const raced = await findWechatAccount(identity)
    if (raced?.userId === targetUserId) return targetUserId
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.identityConflict, error)
  }
}

export async function resolveWechatOfficialIdentity(input: {
  openId: string
  mode: 'login' | 'bind'
  targetUserId: string | null
}): Promise<string> {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(input.openId)) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.callbackInvalid)
  }
  const config = readWechatOfficialConfig()
  const identity = providerAccountId(config.appId, input.openId)
  if (input.mode === 'bind') {
    if (!input.targetUserId) {
      throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid)
    }
    return await resolveBindingIdentity(identity, input.targetUserId)
  }
  return await resolveLoginIdentity(identity)
}
