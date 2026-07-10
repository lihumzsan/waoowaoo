import {
  AUTH_REGISTER_RESULT_CODES,
  afterEach,
  bcryptMock,
  beforeEach,
  describe,
  executeRegister,
  expect,
  hashInviteCode,
  it,
  prismaMock,
  vi,
  type RegisterResult,
} from './auth-register.fixture'

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
