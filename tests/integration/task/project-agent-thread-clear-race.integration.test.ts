import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { clearProjectAssistantThread } from '@/lib/project-agent/thread-clear'
import { appendProjectAssistantThreadMessages } from '@/lib/project-agent/persistence'
import { listLatestProjectAgentSessionChangedEvent } from '@/lib/project-agent/session-event'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'

describe('Project Agent Thread clear versus new Run DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('serializes DELETE and POST scope ownership so a new Run message is never deleted', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command' as const,
    }
    const [clearResult, createResult] = await Promise.allSettled([
      clearProjectAssistantThread(scope),
      createProjectAgentUserTurnRun({
        ...scope,
        runId: 'thread-clear-race-run',
        requestId: 'thread-clear-race-request',
        message: {
          id: 'thread-clear-race-message',
          role: 'user',
          parts: [{ type: 'text', text: 'new command' }],
        },
      }),
    ])

    expect(createResult.status).toBe('fulfilled')
    if (clearResult.status === 'rejected') {
      expect(String(clearResult.reason)).toContain('PROJECT_AGENT_THREAD_ACTIVE:thread-clear-race-run')
    }
    const [thread, run] = await Promise.all([
      prisma.projectAssistantThread.findUnique({
        where: {
          projectId_userId_assistantId_scopeRef: {
            projectId: project.id,
            userId: user.id,
            assistantId: 'workspace-command',
            scopeRef: `project:${project.id}`,
          },
        },
      }),
      prisma.projectAgentRun.findUnique({ where: { id: 'thread-clear-race-run' } }),
    ])
    expect(run?.status).toBe('running')
    expect(thread?.messagesJson).toEqual([
      expect.objectContaining({ id: 'thread-clear-race-message', role: 'user' }),
    ])
  })

  it('commits Thread deletion, replayable session fact, and broadcast responsibility atomically', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const scope = {
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command' as const,
    }
    await appendProjectAssistantThreadMessages({
      ...scope,
      messages: [{
        id: 'thread-to-clear',
        role: 'user',
        parts: [{ type: 'text', text: 'clear me' }],
      }],
    })

    const result = await clearProjectAssistantThread(scope)
    const eventId = BigInt(result.eventWatermark)
    const [thread, event, outbox, replay] = await Promise.all([
      prisma.projectAssistantThread.findUnique({
        where: {
          projectId_userId_assistantId_scopeRef: {
            projectId: project.id,
            userId: user.id,
            assistantId: 'workspace-command',
            scopeRef: `project:${project.id}`,
          },
        },
      }),
      prisma.projectAgentEvent.findUnique({ where: { id: eventId } }),
      prisma.outboxCommand.findUnique({
        where: { idempotencyKey: `project-agent-session-broadcast:${result.eventWatermark}` },
      }),
      listLatestProjectAgentSessionChangedEvent({
        ...scope,
        episodeId: null,
        afterEventId: '0',
      }),
    ])

    expect(thread).toBeNull()
    expect(event).toEqual(expect.objectContaining({
      id: eventId,
      runId: null,
      activityId: null,
      kind: 'thread.cleared',
      payload: { kind: 'thread.cleared' },
    }))
    expect(outbox).toEqual(expect.objectContaining({
      kind: 'project_agent.session_broadcast',
      aggregateType: 'project_agent_event',
      aggregateId: result.eventWatermark,
    }))
    expect(replay).toEqual([expect.objectContaining({
      id: `agent:${result.eventWatermark}`,
      agentEventId: result.eventWatermark,
      scopeRef: `project:${project.id}`,
    })])
  })
})
