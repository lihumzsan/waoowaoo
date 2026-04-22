import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaState = vi.hoisted(() => ({
  panel: { id: 'panel-1', imageModel: 'comfyui::baseimage/图片生成/Flux2Klein文生图' } as { id: string; imageModel: string | null } | null,
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(async () => prismaState.panel),
  },
}))

const configMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    storyboardModel: 'comfyui::baseimage/图片生成/ZImageTurbo造相',
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({
    resolution: '1536x864',
  })),
}))

const submitTaskMock = vi.hoisted(() => vi.fn(async (input: { payload: Record<string, unknown> }) => ({
  success: true,
  async: true,
  taskId: 'task-panel-image',
  status: 'queued',
  deduped: false,
  payload: input.payload,
})))

const resolveModelSelectionMock = vi.hoisted(() => vi.fn(async () => ({
  modelKey: 'ok',
})))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/api-config', () => ({ resolveModelSelection: resolveModelSelectionMock }))
vi.mock('@/lib/api-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-errors')>('@/lib/api-errors')
  return actual
})
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ mode: 'default' })),
}))
vi.mock('@/lib/task/has-output', () => ({
  hasPanelImageOutput: vi.fn(async () => false),
}))

async function invokeRoute(body: Record<string, unknown>) {
  const mod = await import('@/app/api/novel-promotion/[projectId]/regenerate-panel-image/route')
  const req = buildMockRequest({
    path: '/api/novel-promotion/project-1/regenerate-panel-image',
    method: 'POST',
    body,
  })
  return mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('api specific - regenerate panel image route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.panel = {
      id: 'panel-1',
      imageModel: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
    }
  })

  it('prefers request imageModel when provided', async () => {
    const res = await invokeRoute({
      panelId: 'panel-1',
      imageModel: 'comfyui::baseimage/图片生成/ZImageTurbo造相',
    })

    expect(res.status).toBe(200)
    expect(resolveModelSelectionMock).toHaveBeenCalledWith(
      'user-1',
      'comfyui::baseimage/图片生成/ZImageTurbo造相',
      'image',
    )
    expect(configMock.resolveProjectModelCapabilityGenerationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        modelKey: 'comfyui::baseimage/图片生成/ZImageTurbo造相',
      }),
    )
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        imageModel: 'comfyui::baseimage/图片生成/ZImageTurbo造相',
      }),
    }))
  })

  it('falls back to panel imageModel when request body omits imageModel', async () => {
    const res = await invokeRoute({
      panelId: 'panel-1',
    })

    expect(res.status).toBe(200)
    expect(resolveModelSelectionMock).toHaveBeenCalledWith(
      'user-1',
      'comfyui::baseimage/图片生成/Flux2Klein文生图',
      'image',
    )
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        imageModel: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
      }),
    }))
  })
})
