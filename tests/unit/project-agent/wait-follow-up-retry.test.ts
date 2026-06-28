import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(async () => 0),
  $queryRaw: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))
vi.mock('@/lib/project-agent/runs', () => ({
  safelyUpdateProjectAgentRunStatus: vi.fn(async () => undefined),
}))

import {
  PROJECT_AGENT_WAIT_FOLLOW_UP_MAX_ATTEMPTS,
  releaseProjectAgentWaitFollowUpForRetry,
} from '@/lib/project-agent/waits'

function readExecuteRawValues(callIndex: number): readonly unknown[] {
  const call = prismaMock.$executeRaw.mock.calls[callIndex]
  if (!call) throw new Error(`missing $executeRaw call at index ${callIndex}`)
  return call.slice(1)
}

describe('project agent wait follow-up retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$executeRaw.mockResolvedValue(0)
  })

  it('requeues a consumed resume_agent wait when the follow-up stream fails before max attempts', async () => {
    prismaMock.$executeRaw.mockResolvedValueOnce(1)

    const result = await releaseProjectAgentWaitFollowUpForRetry({
      runId: 'run-1',
      waitId: 'wait-1',
      projectId: 'project-1',
      userId: 'user-1',
      errorCode: 'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      errorMessage: 'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
    })

    expect(result).toEqual({ status: 'requeued' })
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    expect(readExecuteRawValues(0)).toEqual([
      'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      'wait-1',
      'run-1',
      'project-1',
      'user-1',
      PROJECT_AGENT_WAIT_FOLLOW_UP_MAX_ATTEMPTS,
    ])
  })

  it('records the follow-up failure after retry attempts are exhausted', async () => {
    prismaMock.$executeRaw
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)

    const result = await releaseProjectAgentWaitFollowUpForRetry({
      runId: 'run-1',
      waitId: 'wait-1',
      projectId: 'project-1',
      userId: 'user-1',
      errorCode: 'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      errorMessage: 'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      maxAttempts: PROJECT_AGENT_WAIT_FOLLOW_UP_MAX_ATTEMPTS,
    })

    expect(result).toEqual({ status: 'exhausted' })
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2)
    expect(readExecuteRawValues(1)).toEqual([
      'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      'PROJECT_AGENT_UI_STREAM_IDLE_TIMEOUT',
      'wait-1',
      'run-1',
      'project-1',
      'user-1',
      PROJECT_AGENT_WAIT_FOLLOW_UP_MAX_ATTEMPTS,
    ])
  })
})
