import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAgentInterruption: {
    findUnique: vi.fn(),
  },
}))

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/event', () => eventMock)

import { reopenProjectAgentInterruption } from '@/lib/project-agent/interruptions'

describe('project agent interruption reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keys each reopen to the exact consumed generation', async () => {
    prismaMock.projectAgentInterruption.findUnique.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      status: 'consumed',
      consumedAt: new Date('2026-07-10T12:00:00.000Z'),
    })

    await reopenProjectAgentInterruption('interruption-1')

    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledWith(expect.objectContaining({
      events: [{
        idempotencyKey: 'interruption-reopened:interruption-1:2026-07-10T12:00:00.000Z',
        event: expect.objectContaining({
          kind: 'interruption.reopened',
          runId: 'run-1',
          interruptionId: 'interruption-1',
        }),
      }],
    }))
  })

  it('fails explicitly instead of pretending a non-consumed interruption was reopened', async () => {
    prismaMock.projectAgentInterruption.findUnique.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      status: 'pending',
      consumedAt: null,
    })

    await expect(reopenProjectAgentInterruption('interruption-1'))
      .rejects.toThrow('PROJECT_AGENT_INTERRUPTION_NOT_CONSUMED')
    expect(eventMock.appendProjectAgentEvents).not.toHaveBeenCalled()
  })
})
