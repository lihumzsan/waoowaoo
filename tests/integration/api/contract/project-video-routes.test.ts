import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const apiAdapterMock = vi.hoisted(() => ({
  executeProjectAgentOperationFromApi: vi.fn(),
}))

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

import { GET as videoProxyGet } from '@/app/api/projects/[projectId]/video-proxy/route'

describe('api contract - project video routes (operation adapter)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('GET /api/projects/[projectId]/video-proxy -> resolves via operation then fetches', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({
      fetchUrl: 'https://example.com/video.mp4',
    })

    globalThis.fetch = vi.fn(async () => new Response('ok', {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '2' },
    })) as unknown as typeof fetch

    const res = await videoProxyGet(
      buildMockRequest({
        path: '/api/projects/project-1/video-proxy',
        method: 'GET',
        query: { key: 'k' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'resolve_video_proxy',
      projectId: 'project-1',
      userId: 'user-1',
      input: expect.objectContaining({ key: 'k', expiresSeconds: 3600 }),
    }))
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/video.mp4')
  })
})
