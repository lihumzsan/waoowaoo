import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

type MockUserStylePreset = {
  id: string
  userId: string
  kind: string
  name: string
  summary: string | null
  config: string
  archivedAt: Date | null
}

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1', name: 'User 1' } },
    project: { id: 'project-1', userId: 'user-1', name: 'Project 1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(async () => ({
      id: 'project-1',
      analysisModel: 'llm::analysis',
      characterModel: 'img::character',
      locationModel: 'img::location',
      storyboardModel: 'img::storyboard',
      editModel: 'img::edit',
      videoModel: 'video::model',
      musicModel: 'google::lyria-3-pro-preview',
    })),
    update: vi.fn(async () => ({
      id: 'project-1',
      artStyle: 'realistic',
    })),
  },
  userPreference: {
    upsert: vi.fn(async () => ({ userId: 'user-1', artStyle: 'realistic' })),
  },
  userStylePreset: {
    findFirst: vi.fn(async (): Promise<MockUserStylePreset | null> => null),
  },
}))

const mediaAttachMock = vi.hoisted(() => ({
  attachMediaFieldsToProject: vi.fn(async (value: unknown) => value),
}))

const logMock = vi.hoisted(() => ({
  logProjectAction: vi.fn(),
}))

const modelConfigContractMock = vi.hoisted(() => ({
  composeModelKey: vi.fn((provider: string, modelId: string) => `${provider}::${modelId}`),
  parseModelKeyStrict: vi.fn(() => ({ provider: 'mock', modelId: 'mock-model' })),
}))

const capabilityLookupMock = vi.hoisted(() => ({
  registerBuiltinCapabilityCatalogEntries: vi.fn(),
  resolveBuiltinModelContext: vi.fn(() => null),
  getCapabilityOptionFields: vi.fn(() => ({})),
  validateCapabilitySelectionsPayload: vi.fn(() => []),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => mediaAttachMock)
vi.mock('@/lib/logging/semantic', () => logMock)
vi.mock('@/lib/ai-registry/selection', () => modelConfigContractMock)
vi.mock('@/lib/ai-registry/capabilities-catalog', () => capabilityLookupMock)

describe('api specific - project config art style validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects legacy artStyle and keeps user preference unchanged', async () => {
    const mod = await import('@/app/api/projects/[projectId]/config/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/config',
      method: 'PATCH',
      body: {
        artStyle: '  realistic  ',
      },
    })

    const res = await mod.PATCH(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.project.update).not.toHaveBeenCalled()
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('accepts musicModel and keeps user preference unchanged', async () => {
    const mod = await import('@/app/api/projects/[projectId]/config/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/config',
      method: 'PATCH',
      body: {
        musicModel: 'google::lyria-3-pro-preview',
      },
    })

    const res = await mod.PATCH(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(res.status).toBe(200)
    expect(prismaMock.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          musicModel: 'google::lyria-3-pro-preview',
        }),
      }),
    )
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('rejects legacy visual style preset refs', async () => {
    const mod = await import('@/app/api/projects/[projectId]/config/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/config',
      method: 'PATCH',
      body: {
        visualStylePreset: {
          presetSource: 'system',
          presetId: 'japanese-anime',
        },
      },
    })

    const res = await mod.PATCH(req, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.project.update).not.toHaveBeenCalled()
  })

})
