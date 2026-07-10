import {
  AUTH_REGISTER_RESULT_CODES,
  afterEach,
  bcryptMock,
  beforeEach,
  describe,
  executeRegister,
  expect,
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
})
