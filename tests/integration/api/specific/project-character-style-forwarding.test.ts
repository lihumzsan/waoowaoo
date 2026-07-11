import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    projectData: { id: 'project-data-1' },
  })),
  requireProjectAuthLight: vi.fn(),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  projectCharacter: {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'character-1' })),
    findUnique: vi.fn(async () => ({ id: 'character-1', appearances: [] })),
  },
  characterAppearance: {
    create: vi.fn(async () => ({ id: 'appearance-1' })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api specific - novel promotion character style forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (transaction: typeof prismaMock) => unknown) =>
      await callback(prismaMock),
    )
  })

  it('does not auto-generate images when creating by text prompt', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/projects/[projectId]/character/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/character',
      method: 'POST',
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      body: {
        name: 'Hero',
        description: '主角设定',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects legacy combined reference generation before creating records', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/projects/[projectId]/character/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/character',
      method: 'POST',
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      body: {
        name: 'Hero',
        description: '主角设定',
        referenceImageUrl: 'https://example.com/ref.png',
        generateFromReference: true,
        count: 4,
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.details).toMatchObject({
      code: 'PROJECT_CHARACTER_REFERENCE_GENERATION_SEPARATE_OPERATION_REQUIRED',
      field: 'referenceImageUrl',
    })
    expect(prismaMock.projectCharacter.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects explicit artStyle override when creating from reference', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/projects/[projectId]/character/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/character',
      method: 'POST',
      body: {
        name: 'Hero',
        description: '主角设定',
        referenceImageUrl: 'https://example.com/ref.png',
        generateFromReference: true,
        artStyle: 'realistic',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid artStyle before creating character', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const mod = await import('@/app/api/projects/[projectId]/character/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/character',
      method: 'POST',
      body: {
        name: 'Hero',
        description: '主角设定',
        artStyle: 'anime',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.projectCharacter.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
