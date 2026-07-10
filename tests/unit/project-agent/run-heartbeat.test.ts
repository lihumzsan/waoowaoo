import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runsMock = vi.hoisted(() => ({
  touchProjectAgentRunHeartbeat: vi.fn(async () => true),
}))

const lockMock = vi.hoisted(() => ({
  renewProjectAgentRunLock: vi.fn(async () => true),
}))

vi.mock('@/lib/project-agent/runs', () => ({
  PROJECT_AGENT_RUN_HEARTBEAT_INTERVAL_MS: 30_000,
  touchProjectAgentRunHeartbeat: runsMock.touchProjectAgentRunHeartbeat,
}))

vi.mock('@/lib/project-agent/run-lock', () => ({
  renewProjectAgentRunLock: lockMock.renewProjectAgentRunLock,
}))

vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({
    error: vi.fn(),
  }),
}))

import { startProjectAgentRunHeartbeat } from '@/lib/project-agent/run-heartbeat'

const runLock = {
  key: 'project-agent-run:scope',
  token: 'token-1',
  runId: 'run-1',
}

describe('project agent run heartbeat ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runsMock.touchProjectAgentRunHeartbeat.mockResolvedValue(true)
    lockMock.renewProjectAgentRunLock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports ownership loss when the run is no longer running', async () => {
    runsMock.touchProjectAgentRunHeartbeat.mockResolvedValueOnce(false)
    const onOwnershipLost = vi.fn()
    const heartbeat = startProjectAgentRunHeartbeat({
      runId: 'run-1',
      runLock,
      intervalMs: 60_000,
      onOwnershipLost,
    })

    await vi.waitFor(() => expect(onOwnershipLost).toHaveBeenCalledTimes(1))
    expect(onOwnershipLost.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      message: 'PROJECT_AGENT_RUN_OWNERSHIP_LOST runId=run-1 reason=run_not_running',
    }))
    expect(lockMock.renewProjectAgentRunLock).not.toHaveBeenCalled()
    await heartbeat.stop()
  })

  it('reports ownership loss when the Redis lock token is no longer owned', async () => {
    lockMock.renewProjectAgentRunLock.mockResolvedValueOnce(false)
    const onOwnershipLost = vi.fn()
    const heartbeat = startProjectAgentRunHeartbeat({
      runId: 'run-1',
      runLock,
      intervalMs: 60_000,
      onOwnershipLost,
    })

    await vi.waitFor(() => expect(onOwnershipLost).toHaveBeenCalledTimes(1))
    expect(onOwnershipLost.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      message: 'PROJECT_AGENT_RUN_OWNERSHIP_LOST runId=run-1 reason=lock_not_owned',
    }))
    await heartbeat.stop()
  })

  it('reports heartbeat infrastructure errors instead of continuing silently', async () => {
    runsMock.touchProjectAgentRunHeartbeat.mockRejectedValueOnce(new Error('DB_UNAVAILABLE'))
    const onOwnershipLost = vi.fn()
    const heartbeat = startProjectAgentRunHeartbeat({
      runId: 'run-1',
      runLock,
      intervalMs: 60_000,
      onOwnershipLost,
    })

    await vi.waitFor(() => expect(onOwnershipLost).toHaveBeenCalledTimes(1))
    expect(onOwnershipLost.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      message: 'PROJECT_AGENT_RUN_OWNERSHIP_LOST runId=run-1 reason=heartbeat_failed',
    }))
    await heartbeat.stop()
  })
})
