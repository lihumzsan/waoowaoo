import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'
import { ACCOUNT_SECURITY_RESULT_CODES } from '@/lib/auth/account-security'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}))

const bcryptMock = vi.hoisted(() => ({
  hash: vi.fn(),
  compare: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('bcryptjs', () => ({ default: bcryptMock }))

import {
  setAccountPassword,
  getAccountSecurity,
  setInitialPassword,
  validateInitialPassword,
} from '@/lib/auth/account-security'

describe('account security helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bcryptMock.hash.mockResolvedValue('hashed-password')
    bcryptMock.compare.mockResolvedValue(false)
  })

  it('[OAuth 用户] -> 使用登录邮箱作为展示名并标记 Google 已绑定', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      name: 'google-user',
      email: ' user@example.com ',
      password: null,
      accounts: [{ provider: 'google' }],
    })

    await expect(getAccountSecurity('user-1')).resolves.toEqual({
      email: 'user@example.com',
      displayName: 'user@example.com',
      hasPassword: false,
      providers: {
        google: {
          linked: true,
        },
      },
    })
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
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
  })

  it('[已有密码] -> 禁止覆盖密码', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'existing-hash',
    })

    const promise = setInitialPassword({
      userId: 'user-1',
      password: 'secret1',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      message: ACCOUNT_SECURITY_RESULT_CODES.passwordAlreadySet,
    })
    expect(bcryptMock.hash.mock.calls).toEqual([])
    expect(prismaMock.user.updateMany.mock.calls).toEqual([])
  })

  it('[首次设置密码] -> 只更新 password:null 的当前用户', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        password: null,
      })
      .mockResolvedValueOnce({
        name: 'user@example.com',
        email: 'user@example.com',
        password: 'hashed-password',
        accounts: [{ provider: 'google' }],
      })
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 })

    const result = await setInitialPassword({
      userId: 'user-1',
      password: 'secret1',
    })

    expect(result.hasPassword).toBe(true)
    expect(bcryptMock.hash).toHaveBeenCalledWith('secret1', 12)
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        password: null,
      },
      data: {
        password: 'hashed-password',
      },
    })
  })

  it('[并发设置密码] -> updateMany 未命中时返回冲突', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: null,
    })
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 })

    const promise = setInitialPassword({
      userId: 'user-1',
      password: 'secret1',
    })

    await expect(promise).rejects.toMatchObject({
      code: 'CONFLICT',
      message: ACCOUNT_SECURITY_RESULT_CODES.passwordAlreadySet,
    })
  })

  it('[短密码] -> 返回明确的账号安全错误码', () => {
    expect(() => validateInitialPassword('12345')).toThrow(ApiError)
    expect(() => validateInitialPassword('12345')).toThrow(ACCOUNT_SECURITY_RESULT_CODES.passwordTooShort)
  })

  it('[修改已有密码缺少当前密码] -> 返回明确的当前密码必填错误', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'existing-hash',
    })

    const promise = setAccountPassword({
      userId: 'user-1',
      password: 'secret2',
    })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: ACCOUNT_SECURITY_RESULT_CODES.currentPasswordRequired,
    })
    expect(bcryptMock.hash.mock.calls).toEqual([])
    expect(prismaMock.user.update.mock.calls).toEqual([])
  })

  it('[修改已有密码当前密码错误] -> 拒绝更新密码', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: 'existing-hash',
    })
    bcryptMock.compare.mockResolvedValue(false)

    const promise = setAccountPassword({
      userId: 'user-1',
      currentPassword: 'wrong-password',
      password: 'secret2',
    })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: ACCOUNT_SECURITY_RESULT_CODES.currentPasswordInvalid,
    })
    expect(bcryptMock.compare).toHaveBeenCalledWith('wrong-password', 'existing-hash')
    expect(bcryptMock.hash.mock.calls).toEqual([])
    expect(prismaMock.user.update.mock.calls).toEqual([])
  })

  it('[修改已有密码当前密码正确] -> 更新当前用户密码', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        password: 'existing-hash',
      })
      .mockResolvedValueOnce({
        name: 'user@example.com',
        email: 'user@example.com',
        password: 'new-hash',
        accounts: [{ provider: 'google' }],
      })
    bcryptMock.compare.mockResolvedValue(true)
    bcryptMock.hash.mockResolvedValue('new-hash')
    prismaMock.user.update.mockResolvedValue({ id: 'user-1' })

    const result = await setAccountPassword({
      userId: 'user-1',
      currentPassword: 'secret1',
      password: 'secret2',
    })

    expect(result.hasPassword).toBe(true)
    expect(bcryptMock.compare).toHaveBeenCalledWith('secret1', 'existing-hash')
    expect(bcryptMock.hash).toHaveBeenCalledWith('secret2', 12)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
      },
      data: {
        password: 'new-hash',
      },
    })
  })
})
