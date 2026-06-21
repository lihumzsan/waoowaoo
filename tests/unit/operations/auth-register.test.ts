import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { AUTH_REGISTER_RESULT_CODES } from '@/lib/auth/register-result-codes'
import { hashInviteCode } from '@/lib/billing/invite-codes'

const prismaMock = vi.hoisted(() => {
  const tx = {
    user: {
      create: vi.fn(),
    },
    userBalance: {
      create: vi.fn(),
      upsert: vi.fn(),
    },
    balanceTransaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    inviteCode: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    inviteRedemption: {
      create: vi.fn(),
    },
  }

  return {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    __tx: tx,
  }
})

const bcryptMock = vi.hoisted(() => ({
  hash: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('bcryptjs', () => ({ default: bcryptMock }))
vi.mock('@/lib/logging/semantic', () => ({ logAuthAction: vi.fn() }))

import { createAuthOperations } from '@/lib/operations/domains/auth/auth-ops'

type RegisterInput = {
  name?: unknown
  password?: unknown
  inviteCode?: unknown
}

type RegisterResult = {
  message: string
  user: {
    id: string
    name: string
  }
}

function buildContext() {
  return {
    request: new Request('http://localhost/api/auth/register') as unknown as NextRequest,
    userId: 'anonymous',
    projectId: 'system',
    context: {},
    source: 'auth',
    writer: null,
  }
}

async function executeRegister(input: RegisterInput | unknown) {
  const operation = createAuthOperations().auth_register_user
  return await operation.execute(buildContext(), input)
}

describe('auth register operation', () => {
  const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
  const originalProviderCredentialMode = process.env.PROVIDER_CREDENTIAL_MODE

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DEPLOYMENT_EDITION
    delete process.env.PROVIDER_CREDENTIAL_MODE
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.__tx.user.create.mockResolvedValue({ id: 'user-1', name: 'alice' })
    prismaMock.__tx.userBalance.create.mockResolvedValue({
      userId: 'user-1',
      balance: 0,
      frozenAmount: 0,
      totalSpent: 0,
    })
    prismaMock.__tx.userBalance.upsert.mockResolvedValue({
      userId: 'user-1',
      balance: 100,
      frozenAmount: 0,
      totalSpent: 0,
    })
    prismaMock.__tx.balanceTransaction.findFirst.mockResolvedValue(null)
    prismaMock.__tx.balanceTransaction.create.mockResolvedValue({ id: 'transaction-1' })
    prismaMock.__tx.inviteCode.findUnique.mockResolvedValue({
      id: 'invite-1',
      amount: 100,
      disabledAt: null,
      expiresAt: null,
      maxRedemptions: 5,
      redeemedCount: 0,
    })
    prismaMock.__tx.inviteCode.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.__tx.inviteRedemption.create.mockResolvedValue({ id: 'redemption-1' })
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock.__tx) => Promise<unknown>) => await callback(prismaMock.__tx),
    )
    bcryptMock.hash.mockResolvedValue('hashed-password')
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalProviderCredentialMode === undefined) {
      delete process.env.PROVIDER_CREDENTIAL_MODE
    } else {
      process.env.PROVIDER_CREDENTIAL_MODE = originalProviderCredentialMode
    }
  })

  it('[重复用户名注册] -> 返回稳定的 CONFLICT 业务码', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user' })

    const promise = executeRegister({ name: 'alice', password: 'secret1' })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      message: AUTH_REGISTER_RESULT_CODES.userExists,
      details: expect.objectContaining({
        code: AUTH_REGISTER_RESULT_CODES.userExists,
        message: AUTH_REGISTER_RESULT_CODES.userExists,
      }),
    })
    expect(prismaMock.$transaction.mock.calls).toEqual([])
  })

  it('[缺少用户名] -> 返回明确的用户名提示', async () => {
    const promise = executeRegister({ name: '   ', password: 'secret1' })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: AUTH_REGISTER_RESULT_CODES.missingName,
      details: expect.objectContaining({
        code: AUTH_REGISTER_RESULT_CODES.missingName,
        message: AUTH_REGISTER_RESULT_CODES.missingName,
      }),
    })
    expect(prismaMock.user.findUnique.mock.calls).toEqual([])
  })

  it('[注册请求体不是对象] -> 返回明确的注册表单提示', async () => {
    const promise = executeRegister(null)

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: AUTH_REGISTER_RESULT_CODES.invalidPayload,
      details: expect.objectContaining({
        code: AUTH_REGISTER_RESULT_CODES.invalidPayload,
        message: AUTH_REGISTER_RESULT_CODES.invalidPayload,
      }),
    })
    expect(prismaMock.user.findUnique.mock.calls).toEqual([])
  })

  it('[缺少密码] -> 返回明确的密码提示', async () => {
    const promise = executeRegister({ name: 'alice', password: '' })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: AUTH_REGISTER_RESULT_CODES.missingPassword,
      details: expect.objectContaining({
        code: AUTH_REGISTER_RESULT_CODES.missingPassword,
        message: AUTH_REGISTER_RESULT_CODES.missingPassword,
      }),
    })
    expect(prismaMock.user.findUnique.mock.calls).toEqual([])
  })

  it('[密码过短] -> 返回明确的长度提示', async () => {
    const promise = executeRegister({ name: 'alice', password: '12345' })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: AUTH_REGISTER_RESULT_CODES.passwordTooShort,
      details: expect.objectContaining({
        code: AUTH_REGISTER_RESULT_CODES.passwordTooShort,
        message: AUTH_REGISTER_RESULT_CODES.passwordTooShort,
      }),
    })
    expect(prismaMock.user.findUnique.mock.calls).toEqual([])
  })

  it('[并发唯一键冲突] -> 返回和重复用户名一致的友好错误', async () => {
    prismaMock.__tx.user.create.mockRejectedValue({ code: 'P2002', message: 'Unique constraint failed' })

    const promise = executeRegister({ name: 'alice', password: 'secret1' })

    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      message: AUTH_REGISTER_RESULT_CODES.userExists,
    })
    expect(bcryptMock.hash).toHaveBeenCalledWith('secret1', 12)
  })

  it('[有效注册] -> 归一化用户名并创建用户与初始余额', async () => {
    const result = await executeRegister({ name: ' alice ', password: 'secret1' })

    expect(result).toEqual({
      message: AUTH_REGISTER_RESULT_CODES.success,
      user: {
        id: 'user-1',
        name: 'alice',
      },
    })
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { name: 'alice' },
      select: { id: true },
    })
    expect(bcryptMock.hash).toHaveBeenCalledWith('secret1', 12)
    expect(prismaMock.__tx.user.create).toHaveBeenCalledWith({
      data: {
        name: 'alice',
        password: 'hashed-password',
      },
      select: {
        id: true,
        name: true,
      },
    })
    expect(prismaMock.__tx.userBalance.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0,
      },
    })
    expect(prismaMock.__tx.inviteRedemption.create.mock.calls).toEqual([])
  })

  it('[cloud 公开注册] -> 不需要邀请码也能创建用户和初始余额', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'

    const result = await executeRegister({ name: 'alice', password: 'secret1' }) as RegisterResult

    expect(result).toEqual({
      message: AUTH_REGISTER_RESULT_CODES.success,
      user: {
        id: 'user-1',
        name: 'alice',
      },
    })
    expect(prismaMock.__tx.user.create).toHaveBeenCalledWith({
      data: {
        name: 'alice',
        password: 'hashed-password',
      },
      select: {
        id: true,
        name: true,
      },
    })
    expect(prismaMock.__tx.userBalance.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0,
      },
    })
    expect(prismaMock.__tx.inviteCode.findUnique.mock.calls).toEqual([])
    expect(prismaMock.__tx.inviteCode.updateMany.mock.calls).toEqual([])
    expect(prismaMock.__tx.inviteRedemption.create.mock.calls).toEqual([])
    expect(prismaMock.__tx.balanceTransaction.create.mock.calls).toEqual([])
  })

  it('[cloud 注册带可选邀请码] -> 注册事务内兑换邀请码并入账', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'

    const result = await executeRegister({ name: 'alice', password: 'secret1', inviteCode: ' beta-1 ' }) as RegisterResult

    expect(result).toEqual({
      message: AUTH_REGISTER_RESULT_CODES.success,
      user: {
        id: 'user-1',
        name: 'alice',
      },
    })
    expect(prismaMock.__tx.user.create).toHaveBeenCalledWith({
      data: {
        name: 'alice',
        password: 'hashed-password',
      },
      select: {
        id: true,
        name: true,
      },
    })
    expect(prismaMock.__tx.inviteCode.findUnique).toHaveBeenCalledWith({
      where: { codeHash: hashInviteCode('beta-1') },
    })
    expect(prismaMock.__tx.inviteCode.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite-1',
        disabledAt: null,
        redeemedCount: { lt: 5 },
      },
      data: {
        redeemedCount: { increment: 1 },
      },
    })
    expect(prismaMock.__tx.inviteRedemption.create).toHaveBeenCalledWith({
      data: {
        inviteCodeId: 'invite-1',
        userId: 'user-1',
        amount: 100,
      },
    })
    expect(prismaMock.__tx.userBalance.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', balance: 100, frozenAmount: 0, totalSpent: 0 },
      update: { balance: { increment: 100 } },
    })
    expect(prismaMock.__tx.balanceTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'adjust',
        amount: 100,
        balanceAfter: 100,
        relatedId: 'invite-1',
        freezeId: null,
        operatorId: 'invite-code',
        externalOrderId: 'invite-1',
        idempotencyKey: 'invite:invite-1:user-1',
      }),
    })
  })

  it('[cloud 注册带无效可选邀请码] -> 显式失败且不静默注册入账', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    prismaMock.__tx.inviteCode.findUnique.mockResolvedValue(null)

    const promise = executeRegister({ name: 'alice', password: 'secret1', inviteCode: 'missing-code' })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'INVITE_CODE_INVALID',
        field: 'inviteCode',
      }),
    })
    expect(prismaMock.__tx.inviteCode.findUnique).toHaveBeenCalledWith({
      where: { codeHash: hashInviteCode('missing-code') },
    })
    expect(prismaMock.__tx.inviteCode.updateMany.mock.calls).toEqual([])
    expect(prismaMock.__tx.inviteRedemption.create.mock.calls).toEqual([])
    expect(prismaMock.__tx.userBalance.upsert.mock.calls).toEqual([])
    expect(prismaMock.__tx.balanceTransaction.create.mock.calls).toEqual([])
  })
})
