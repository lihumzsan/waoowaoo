import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const apiAdapterMock = vi.hoisted(() => ({
  executeProjectAgentOperationFromApi: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1' },
  })),
  isErrorResponse: () => false,
}))

vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => apiAdapterMock)

import { POST } from '@/app/api/projects/[projectId]/edit-script/assets/generate/route'

describe('edit script asset generation route approval grant contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValue({
      success: true,
      async: true,
      editScript: { id: 'script-1' },
      submittedTasks: [],
    })
  })

  it('rejects a request whose immutable plan approval identity was lost before the API boundary', async () => {
    const response = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/edit-script/assets/generate',
        method: 'POST',
        body: { episodeId: 'episode-1', editScriptId: 'script-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).not.toHaveBeenCalled()
  })

  it('forwards the ApprovalGrant and operation request identity to the unified operation adapter', async () => {
    const response = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/edit-script/assets/generate',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          editScriptId: 'script-1',
          approvalGrantId: 'grant-1',
          operationRequestId: 'request-1',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'generate_edit_script_assets',
        projectId: 'project-1',
        userId: 'user-1',
        context: { episodeId: 'episode-1' },
        input: {
          episodeId: 'episode-1',
          editScriptId: 'script-1',
          approvalGrantId: 'grant-1',
          operationRequestId: 'request-1',
        },
        source: 'project-ui',
      }),
    )
  })
})
