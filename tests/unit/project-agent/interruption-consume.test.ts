import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectAgentInterruption: {
    findFirst: vi.fn(),
  },
}))

const eventMock = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/event', () => eventMock)

import {
  consumeProjectAgentApprovalInterruption,
  consumeProjectAgentChoiceInterruption,
} from '@/lib/project-agent/interruptions'

const scope = {
  projectId: 'project-1',
  userId: 'user-1',
  episodeId: 'episode-1',
  assistantId: 'workspace-command' as const,
  runId: 'run-1',
  interruptionId: 'interruption-1',
  response: { approved: true },
}

describe('project agent interruption consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns conflict semantics when a concurrent approval consumer wins the status CAS', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'generate_edit_style_previews',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
      runState: 'serialized-run-state',
    })
    eventMock.appendProjectAgentEvents.mockRejectedValueOnce(new Error(
      'PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=interruption-1 runId=run-1',
    ))

    await expect(consumeProjectAgentApprovalInterruption(scope)).resolves.toBeNull()
    expect(eventMock.appendProjectAgentEvents).toHaveBeenCalledWith(expect.objectContaining({
      events: [{
        event: expect.objectContaining({
          kind: 'interruption.resolved',
          interruptionId: 'interruption-1',
          outcome: 'consumed',
        }),
      }],
    }))
  })

  it('returns conflict semantics when a concurrent choice consumer wins the status CAS', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'request_edit_bible_review_choice',
      approvalId: 'choice-1',
      toolCallId: 'tool-1',
      payload: { choiceType: 'bible_review' },
      runState: null,
    })
    eventMock.appendProjectAgentEvents.mockRejectedValueOnce(new Error(
      'PROJECT_AGENT_INTERRUPTION_TRANSITION_RACED interruptionId=interruption-1 runId=run-1',
    ))

    await expect(consumeProjectAgentChoiceInterruption(scope)).resolves.toBeNull()
  })

  it('does not hide infrastructure failures as a duplicate decision', async () => {
    prismaMock.projectAgentInterruption.findFirst.mockResolvedValueOnce({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-1',
      status: 'pending',
      operationId: 'request_edit_bible_review_choice',
      approvalId: 'choice-1',
      toolCallId: 'tool-1',
      payload: { choiceType: 'bible_review' },
      runState: null,
    })
    eventMock.appendProjectAgentEvents.mockRejectedValueOnce(new Error('DB_UNAVAILABLE'))

    await expect(consumeProjectAgentChoiceInterruption(scope)).rejects.toThrow('DB_UNAVAILABLE')
  })
})
