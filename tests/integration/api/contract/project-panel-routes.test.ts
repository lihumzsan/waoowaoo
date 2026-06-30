import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import {
  PATCH as panelPatch,
} from '@/app/api/projects/[projectId]/panel/route'
import { POST as panelSelectCandidatePost } from '@/app/api/projects/[projectId]/panel/select-candidate/route'

describe('api contract - project panel routes (operation adapter)', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('PATCH /api/projects/[projectId]/panel -> uses update_storyboard_panel_prompt', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({ success: true })

    const res = await panelPatch(
      buildMockRequest({
        path: '/api/projects/project-1/panel',
        method: 'PATCH',
        body: { panelId: 'panel-1', imagePrompt: 'image prompt', videoPrompt: 'video prompt', actingNotes: 'focused' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'update_storyboard_panel_prompt',
      input: { panelId: 'panel-1', imagePrompt: 'image prompt', videoPrompt: 'video prompt', actingNotes: 'focused' },
    }))
  })

  it('POST /api/projects/[projectId]/panel/select-candidate cancel -> uses cancel_storyboard_panel_candidates', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({ success: true })

    const res = await panelSelectCandidatePost(
      buildMockRequest({
        path: '/api/projects/project-1/panel/select-candidate',
        method: 'POST',
        body: { panelId: 'panel-1', action: 'cancel' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'cancel_storyboard_panel_candidates',
      input: { panelId: 'panel-1' },
    }))
  })

  it('POST /api/projects/[projectId]/panel/select-candidate select -> uses select_storyboard_panel_candidate', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({ success: true, imageUrl: 'https://example.com/image.png' })

    const res = await panelSelectCandidatePost(
      buildMockRequest({
        path: '/api/projects/project-1/panel/select-candidate',
        method: 'POST',
        body: { panelId: 'panel-1', selectedImageUrl: 'https://example.com/source.png' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'select_storyboard_panel_candidate',
      input: { panelId: 'panel-1', selectedImageUrl: 'https://example.com/source.png' },
    }))
  })

})
