import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
  },
}))

const getServerSessionMock = vi.hoisted(() => vi.fn(async () => ({
  user: { id: 'user-1', name: 'Tester' },
})))

vi.mock('next-auth/next', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/config-service', () => ({
  extractModelKey: vi.fn((value: string | null | undefined) => value ?? null),
}))

vi.mock('@/lib/logging/context', () => ({
  getLogContext: vi.fn(() => ({ requestId: null })),
  setLogContext: vi.fn(),
}))

import { requireProjectAuth, requireUserAuth } from '@/lib/api-auth'

describe('requireProjectAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'tester@example.com', email: null })
    prismaMock.user.findFirst.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', name: 'tester@example.com' },
    })
  })

  it('loads project with requested includes and returns flattened projectData', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project One',
      analysisModel: 'llm::analysis',
      characters: [{ name: 'Hero' }],
    })

    const result = await requireProjectAuth('project-1', {
      include: { characters: true },
    })

    expect(result).not.toBeInstanceOf(NextResponse)
    if (result instanceof NextResponse) {
      throw new Error('Expected auth context')
    }

    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      include: { characters: true },
    })
    expect(result.projectData).toEqual(expect.objectContaining({
      id: 'project-1',
      analysisModel: 'llm::analysis',
      characters: [{ name: 'Hero' }],
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
    }))
  })

  it('returns not found when project data is missing', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null)

    const result = await requireProjectAuth('project-1')

    expect(result).toBeInstanceOf(NextResponse)
    if (!(result instanceof NextResponse)) {
      throw new Error('Expected error response')
    }

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual(expect.objectContaining({
      code: 'NOT_FOUND',
      message: 'Project not found',
    }))
  })
})

describe('requireUserAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findFirst.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', name: 'tester@example.com' },
    })
  })

  it('returns the session only after the session user exists in the database', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'tester@example.com', email: null })

    const result = await requireUserAuth()

    expect(result).not.toBeInstanceOf(NextResponse)
    if (result instanceof NextResponse) {
      throw new Error('Expected auth context')
    }

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, name: true, email: true },
    })
    expect(result.session.user.id).toBe('user-1')
  })

  it('normalizes a stale session id to the database user matched by login name', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'stale-user-id', name: 'tester@example.com' },
    })
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'tester@example.com',
      email: null,
    })

    const result = await requireUserAuth()

    expect(result).not.toBeInstanceOf(NextResponse)
    if (result instanceof NextResponse) {
      throw new Error('Expected auth context')
    }

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { name: { in: ['tester@example.com'] } },
      select: { id: true, name: true, email: true },
    })
    expect(result.session.user.id).toBe('user-1')
  })

  it('normalizes project auth through the same database user identity', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'stale-user-id', name: 'tester@example.com' },
    })
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'tester@example.com',
      email: null,
    })
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project One',
      analysisModel: null,
    })

    const result = await requireProjectAuth('project-1')

    expect(result).not.toBeInstanceOf(NextResponse)
    if (result instanceof NextResponse) {
      throw new Error('Expected auth context')
    }

    expect(result.session.user.id).toBe('user-1')
    expect(result.project.userId).toBe('user-1')
  })

  it('rejects an unresolvable stale session user before user-owned writes can hit foreign keys', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: 'stale-user-id', name: 'missing@example.com' },
    })
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.findFirst.mockResolvedValue(null)

    const result = await requireUserAuth()

    expect(result).toBeInstanceOf(NextResponse)
    if (!(result instanceof NextResponse)) {
      throw new Error('Expected error response')
    }

    expect(result.status).toBe(401)
    expect(prismaMock.project.findUnique).not.toHaveBeenCalled()
    await expect(result.json()).resolves.toEqual(expect.objectContaining({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    }))
  })
})
