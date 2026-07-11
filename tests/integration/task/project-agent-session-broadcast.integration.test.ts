import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'

const TEST_KEY_PREFIX = 'session-broadcast-integration:'
const createdEventIds: string[] = []

describe('Project Agent Session broadcast DB integration', () => {
  beforeEach(async () => {
    await prisma.outboxCommand.deleteMany({
      where: { idempotencyKey: { startsWith: TEST_KEY_PREFIX } },
    })
    await resetBillingState()
  })

  afterEach(async () => {
    if (createdEventIds.length > 0) {
      await prisma.outboxCommand.deleteMany({
        where: {
          aggregateType: 'project_agent_event',
          aggregateId: { in: createdEventIds.splice(0) },
        },
      })
    }
  })

  it('atomically creates one broadcast responsibility for every committed ProjectAgentEvent', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const runId = `${TEST_KEY_PREFIX}run-1`
    await createProjectAgentUserTurnRun({
      runId,
      requestId: `${TEST_KEY_PREFIX}request-1`,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: `${TEST_KEY_PREFIX}message-1`,
        role: 'user',
        parts: [{ type: 'text', text: '开始' }],
      },
    })
    const events = await prisma.projectAgentEvent.findMany({
      where: { runId },
      select: { id: true },
    })
    const eventIds = events.map((event) => event.id.toString())
    createdEventIds.push(...eventIds)
    const commands = await prisma.outboxCommand.findMany({
      where: {
        aggregateType: 'project_agent_event',
        aggregateId: { in: eventIds },
      },
    })
    expect(events.length).toBeGreaterThan(0)
    expect(commands).toHaveLength(events.length)
    expect(commands.map((command) => command.aggregateId).sort()).toEqual(eventIds.sort())
    expect(commands.every((command) => command.kind === 'project_agent.session_broadcast')).toBe(true)
  })

  it('rolls back both the event and broadcast responsibility when reduction fails', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const idempotencyKey = `${TEST_KEY_PREFIX}rollback-event`
    const commandCountBefore = await prisma.outboxCommand.count({
      where: { aggregateType: 'project_agent_event' },
    })
    await expect(appendProjectAgentEvents({
      scope: {
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
      },
      events: [{
        idempotencyKey,
        runFence: { runId: `${TEST_KEY_PREFIX}missing-run`, runVersion: 0, eventSeq: '0' },
        event: {
          kind: 'run.completed',
          runId: `${TEST_KEY_PREFIX}missing-run`,
        },
      }],
    })).rejects.toThrow()
    expect(await prisma.projectAgentEvent.count({ where: { idempotencyKey } })).toBe(0)
    expect(await prisma.outboxCommand.count({
      where: { aggregateType: 'project_agent_event' },
    })).toBe(commandCountBefore)
  })
})
