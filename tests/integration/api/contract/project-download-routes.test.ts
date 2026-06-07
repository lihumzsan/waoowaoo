import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const apiAdapterMock = vi.hoisted(() => ({
  executeProjectAgentOperationFromApi: vi.fn(),
}))

const storageMock = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(async () => Buffer.from('x')),
}))

class FakeArchiver {
  private listeners: Record<string, Array<(arg?: unknown) => void>> = {}

  on(event: string, cb: (arg?: unknown) => void) {
    this.listeners[event] = this.listeners[event] || []
    this.listeners[event].push(cb)
    return this
  }

  append(_body: Buffer, _params: { name: string }) {
    return this
  }

  async finalize() {
    queueMicrotask(() => {
      for (const cb of this.listeners.data || []) cb(new Uint8Array([1, 2, 3]))
      for (const cb of this.listeners.end || []) cb()
    })
  }
}

vi.mock('archiver', () => ({
  default: vi.fn(() => new FakeArchiver()),
}))

vi.mock('@/lib/storage', () => storageMock)

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1', name: 'Project' },
      }
    },
  }
})

vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => apiAdapterMock)

import { GET as downloadImagesGet } from '@/app/api/projects/[projectId]/download-images/route'
import { POST as downloadVideosPost } from '@/app/api/projects/[projectId]/download-videos/route'

describe('api contract - project download routes (operation adapter)', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('GET /api/projects/[projectId]/download-images -> uses list_download_images plan', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({
      projectName: 'Project',
      files: [{ fileName: '001_a.png', storageKey: 'k.png' }],
    })

    const res = await downloadImagesGet(
      buildMockRequest({ path: '/api/projects/project-1/download-images', method: 'GET' }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'list_download_images',
      projectId: 'project-1',
      userId: 'user-1',
    }))
    expect(storageMock.getObjectBuffer).toHaveBeenCalledWith('k.png')
  })

  it('POST /api/projects/[projectId]/download-videos -> uses list_download_videos plan', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({
      projectName: 'Project',
      files: [{ fileName: '001_a.mp4', storageKey: 'k.mp4' }],
    })

    const res = await downloadVideosPost(
      buildMockRequest({ path: '/api/projects/project-1/download-videos', method: 'POST', body: {} }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'list_download_videos',
      projectId: 'project-1',
      userId: 'user-1',
    }))
    expect(storageMock.getObjectBuffer).toHaveBeenCalledWith('k.mp4')
  })

})
