import {
  authState,
  beforeEach,
  buildMockRequest,
  compressionState,
  describe,
  expect,
  it,
  vi,
  waitsPost,
} from './project-assistant-routes.fixture'

describe('project assistant chat route', () => {
  beforeEach(() => {
    authState.authenticated = true
    compressionState.shouldCompress = false
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/assistant/waits -> rejects legacy manual follow-up marking', async () => {
    const response = await waitsPost(
      buildMockRequest({
        path: '/api/projects/project-1/assistant/waits',
        method: 'POST',
        body: { waitId: 'wait-1', claimId: 'claim-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        details: expect.objectContaining({ code: 'INVALID_WAIT_FOLLOW_UP_ACTION' }),
      }),
    }))
  })
})
