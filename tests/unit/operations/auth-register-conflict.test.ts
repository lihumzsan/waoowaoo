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

  it('[并发唯一键冲突] -> 返回和重复用户名一致的友好错误', async () => {
    prismaMock.__tx.user.create.mockRejectedValue({ code: 'P2002', message: 'Unique constraint failed' })

    const promise = executeRegister({ name: 'alice', password: 'secret1' })

    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      message: AUTH_REGISTER_RESULT_CODES.userExists,
    })
    expect(bcryptMock.hash).toHaveBeenCalledWith('secret1', 12)
  })
})
