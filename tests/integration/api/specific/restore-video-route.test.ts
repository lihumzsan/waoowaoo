import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

type PanelRecord = {
  id: string
  storyboardId: string
  panelIndex: number
  videoUrl: string | null
}

type TaskRecord = {
  id: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
}

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const routeState = vi.hoisted(() => ({
  panel: {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    videoUrl: 'images/current.mp4',
  } as PanelRecord | null,
  tasks: [] as TaskRecord[],
}))

const panelUpdateMock = vi.hoisted(() => vi.fn(async () => ({})))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findFirst: vi.fn(async () => routeState.panel),
    update: panelUpdateMock,
  },
  task: {
    findMany: vi.fn(async () => routeState.tasks),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

async function invokeRoute(body: Record<string, unknown>): Promise<Response> {
  const mod = await import('@/app/api/novel-promotion/[projectId]/restore-video/route')
  const req = buildMockRequest({
    path: '/api/novel-promotion/project-1/restore-video',
    method: 'POST',
    body,
  })
  return await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('api specific - restore video route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeState.panel = {
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      videoUrl: 'images/current.mp4',
    }
    routeState.tasks = [
      {
        id: 'task-current',
        payload: null,
        result: { videoUrl: 'images/current.mp4' },
      },
      {
        id: 'task-previous',
        payload: {
          firstLastFrame: {
            lastFrameStoryboardId: 'storyboard-1',
            lastFramePanelIndex: 1,
          },
        },
        result: { videoUrl: 'images/previous.mp4' },
      },
    ]
  })

  it('restores the latest prior distinct video and clears lip sync derivatives', async () => {
    const res = await invokeRoute({
      panelId: 'panel-1',
    })

    const json = await res.json() as {
      success: boolean
      videoUrl: string
      videoGenerationMode: string
      restoredFromTaskId: string
    }

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.videoUrl).toBe('images/previous.mp4')
    expect(json.videoGenerationMode).toBe('firstlastframe')
    expect(json.restoredFromTaskId).toBe('task-previous')
    expect(panelUpdateMock).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        videoUrl: 'images/previous.mp4',
        videoGenerationMode: 'firstlastframe',
        videoMediaId: null,
        lipSyncTaskId: null,
        lipSyncVideoUrl: null,
        lipSyncVideoMediaId: null,
      },
    })
  })

  it('returns CONFLICT when no previous video exists', async () => {
    routeState.tasks = [
      {
        id: 'task-current',
        payload: null,
        result: { videoUrl: 'images/current.mp4' },
      },
    ]

    const res = await invokeRoute({
      panelId: 'panel-1',
    })

    const json = await res.json() as { error: { code: string; message: string } }
    expect(res.status).toBe(409)
    expect(json.error.code).toBe('CONFLICT')
    expect(json.error.message).toBe('VIDEO_PREVIOUS_NOT_FOUND')
    expect(panelUpdateMock).not.toHaveBeenCalled()
  })
})
