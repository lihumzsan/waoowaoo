import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  eval: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  redis: redisMock,
}))

import {
  acquireProjectAgentRunLock,
  releaseProjectAgentRunLock,
  releaseProjectAgentRunLockForRun,
  renewProjectAgentRunLock,
} from '@/lib/project-agent/run-lock'

describe('project agent run lock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.set.mockResolvedValue('OK')
    redisMock.get.mockResolvedValue(null)
    redisMock.eval.mockResolvedValue(1)
  })

  it('acquires a scope lock owned by the run id', async () => {
    const lock = await acquireProjectAgentRunLock({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      runId: 'run-1',
    })

    expect(lock).toEqual(expect.objectContaining({
      key: 'project-agent-run:project-1:user-1:workspace-command:episode:episode-1',
      runId: 'run-1',
      token: expect.any(String) as string,
    }))
    expect(redisMock.set).toHaveBeenCalledWith(
      'project-agent-run:project-1:user-1:workspace-command:episode:episode-1',
      expect.stringMatching(/^run-1:/),
      'PX',
      75000,
      'NX',
    )
  })

  it('renews and releases only the matching owner token', async () => {
    const lock = { key: 'lock-key', runId: 'run-1', token: 'token-1' }

    await expect(renewProjectAgentRunLock(lock)).resolves.toBe(true)
    await releaseProjectAgentRunLock(lock)

    expect(redisMock.eval).toHaveBeenNthCalledWith(1, expect.any(String), 1, 'lock-key', 'run-1:token-1', 75000)
    expect(redisMock.eval).toHaveBeenNthCalledWith(2, expect.any(String), 1, 'lock-key', 'run-1:token-1')
  })

  it('releases stale locks only when the stored owner run matches', async () => {
    await expect(releaseProjectAgentRunLockForRun({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      runId: 'run-stale',
    })).resolves.toBe(true)

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'project-agent-run:project-1:user-1:workspace-command:episode:episode-1',
      'run-stale:',
    )
  })
})
