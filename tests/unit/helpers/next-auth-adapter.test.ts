import { beforeEach, describe, expect, it, vi } from 'vitest'

const baseAdapterMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserByAccount: vi.fn(),
  linkAccount: vi.fn(),
  createSession: vi.fn(),
  getSessionAndUser: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  unlinkAccount: vi.fn(),
  createVerificationToken: vi.fn(),
  useVerificationToken: vi.fn(),
}))

const prismaMock = vi.hoisted(() => {
  const tx = {
    user: {
      create: vi.fn(),
    },
    userBalance: {
      create: vi.fn(),
    },
  }

  return {
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    __tx: tx,
  }
})

vi.mock('@next-auth/prisma-adapter', () => ({
  PrismaAdapter: vi.fn(() => baseAdapterMock),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { createAuthAdapter } from '@/lib/auth/next-auth-adapter'

type UserCreateArgs = {
  data: {
    name: string
    email: string
    emailVerified: Date
    image: string | null
    password: null
  }
}

describe('createAuthAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock.__tx) => Promise<unknown>) => callback(prismaMock.__tx),
    )
    prismaMock.__tx.user.create.mockImplementation(async (args: UserCreateArgs) => ({
      id: 'user-1',
      name: args.data.name,
      email: args.data.email,
      emailVerified: args.data.emailVerified,
      image: args.data.image,
    }))
    prismaMock.__tx.userBalance.create.mockResolvedValue({
      userId: 'user-1',
      balance: 0,
      frozenAmount: 0,
      totalSpent: 0,
    })
  })

  it('[Google OAuth 首次登录] -> 创建用户时同步创建初始余额', async () => {
    const adapter = createAuthAdapter()
    if (!adapter.createUser) throw new Error('Expected createUser')

    const user = await adapter.createUser({
      name: 'Google User',
      email: 'User@Example.COM',
      emailVerified: null,
      image: 'https://example.com/avatar.png',
    })

    expect(user.emailVerified).toBeInstanceOf(Date)
    const createdEmailVerified = user.emailVerified
    if (!createdEmailVerified) throw new Error('Expected emailVerified')
    expect(user).toEqual({
      id: 'user-1',
      name: 'user@example.com',
      email: 'user@example.com',
      emailVerified: createdEmailVerified,
      image: 'https://example.com/avatar.png',
    })
    expect(prismaMock.__tx.user.create).toHaveBeenCalledWith({
      data: {
        name: 'user@example.com',
        email: 'user@example.com',
        emailVerified: createdEmailVerified,
        image: 'https://example.com/avatar.png',
        password: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
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
  })

  it('[Google OAuth 邮箱查找] -> 用归一化邮箱查询已有用户', async () => {
    const emailVerified = new Date('2026-01-01T00:00:00.000Z')
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'user@example.com',
      email: 'user@example.com',
      emailVerified,
      image: null,
    })

    const adapter = createAuthAdapter()
    if (!adapter.getUserByEmail) throw new Error('Expected getUserByEmail')

    await expect(adapter.getUserByEmail(' User@Example.COM ')).resolves.toEqual({
      id: 'user-1',
      name: 'user@example.com',
      email: 'user@example.com',
      emailVerified,
      image: null,
    })
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
      },
    })
  })
})
