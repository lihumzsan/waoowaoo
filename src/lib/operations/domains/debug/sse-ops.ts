import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  buildTaskLifecycleEventPayload,
  getProjectChannel,
  listEventsAfter,
  listRecentTerminalLifecycleEvents,
} from '@/lib/task/publisher'
import {
  TASK_EVENT_TYPE,
  TASK_STATUS,
  isTaskType,
} from '@/lib/task/types'
import {
  TASK_SSE_EVENT_TYPE,
  type TaskSSEEvent,
} from '@/lib/sse/events'
import { coerceTaskIntent } from '@/lib/task/intent'
import { getTaskDefinition } from '@/lib/task/definition'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { parseWorkspaceSseCursor } from '@/lib/sse/protocol'
function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function uniqueTaskEvents(events: TaskSSEEvent[]): TaskSSEEvent[] {
  const eventsById = new Map<string, TaskSSEEvent>()
  for (const event of events) {
    eventsById.set(event.id, event)
  }
  return Array.from(eventsById.values())
}

async function listActiveLifecycleSnapshot(params: {
  projectId: string
  userId: string
  limit?: number
}): Promise<TaskSSEEvent[]> {
  const limit = params.limit || 500
  const rows = await prisma.task.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      status: {
        in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING],
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      targetType: true,
      targetId: true,
      userId: true,
      status: true,
      progress: true,
      payload: true,
      updatedAt: true,
    },
  })

  return rows.map((row): TaskSSEEvent => {
    if (!isTaskType(row.type)) {
      throw new Error(`TASK_DEFINITION_MISSING:${row.type}`)
    }
    const payload = asObject(row.payload)
    const payloadUi = asObject(payload?.ui)
    const lifecycleType = row.status === TASK_STATUS.QUEUED
      ? TASK_EVENT_TYPE.CREATED
      : TASK_EVENT_TYPE.PROCESSING
    const eventPayload = buildTaskLifecycleEventPayload({
      taskId: row.id,
      projectId: params.projectId,
      lifecycleType,
      taskType: row.type,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: {
        ...(payload || {}),
        lifecycleType,
        intent: coerceTaskIntent(payloadUi?.intent ?? payload?.intent, row.type),
        progress: typeof row.progress === 'number' ? row.progress : null,
      },
      coveragePayload: payload,
      ...(lifecycleType === TASK_EVENT_TYPE.CREATED
        ? {
            affectedResources: resolveWorkspaceResourceRefs({
              impact: getTaskDefinition(row.type).terminalResourceImpact,
              projectId: params.projectId,
            }),
          }
        : {}),
    })

    return {
      id: `snapshot:${row.id}:${row.updatedAt.getTime()}`,
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: row.id,
      projectId: params.projectId,
      userId: row.userId,
      ts: row.updatedAt.toISOString(),
      taskType: row.type,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: eventPayload,
    }
  })
}

async function listRecoverableTaskSnapshot(params: {
  projectId: string
  userId: string
  activeLimit?: number
  terminalLimit?: number
}): Promise<TaskSSEEvent[]> {
  const [terminalEvents, activeEvents] = await Promise.all([
    listRecentTerminalLifecycleEvents({
      projectId: params.projectId,
      userId: params.userId,
      limit: params.terminalLimit ?? 200,
    }),
    listActiveLifecycleSnapshot({
      projectId: params.projectId,
      userId: params.userId,
      limit: params.activeLimit ?? 500,
    }),
  ])

  return uniqueTaskEvents([
    ...terminalEvents,
    ...activeEvents,
  ]).sort((left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id))
}

export function createSseOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_sse_bootstrap: defineOperation({
      id: 'get_sse_bootstrap',
      summary: 'Compute SSE bootstrap payload (replay missed events or active lifecycle snapshot).',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({
        lastEventId: z.string().optional().nullable(),
        includeRecoverableSnapshot: z.boolean().optional(),
        replayLimit: z.number().int().positive().max(5000).optional(),
        snapshotLimit: z.number().int().positive().max(2000).optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const channel = getProjectChannel(ctx.projectId)
        const cursor = parseWorkspaceSseCursor(input.lastEventId || null)
        const includeRecoverableSnapshot = input.includeRecoverableSnapshot !== false

        if (cursor.taskEventId > 0) {
          const replayLimit = input.replayLimit ?? 5000
          const taskEvents = await listEventsAfter(
            ctx.projectId,
            cursor.taskEventId,
            replayLimit,
          )
          const userTaskEvents = taskEvents.filter((event) => event.userId === ctx.userId)
          const recoverableTaskEvents = includeRecoverableSnapshot
            ? await listRecoverableTaskSnapshot({
                projectId: ctx.projectId,
                userId: ctx.userId,
                activeLimit: input.snapshotLimit ?? 500,
                terminalLimit: Math.min(input.snapshotLimit ?? 500, 200),
              })
            : []
          const events = [
            ...userTaskEvents,
            ...recoverableTaskEvents,
          ]
            .sort((left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id))
          return {
            channel,
            mode: includeRecoverableSnapshot
              ? 'durable_replay_with_recoverable_snapshot'
              : 'durable_replay',
            fromEventId: input.lastEventId,
            events,
          }
        }

        if (!includeRecoverableSnapshot) {
          return {
            channel,
            mode: 'missed_event_replay_without_cursor',
            events: [],
          }
        }

        const snapshotLimit = input.snapshotLimit ?? 500
        const events = await listRecoverableTaskSnapshot({
          projectId: ctx.projectId,
          userId: ctx.userId,
          activeLimit: snapshotLimit,
          terminalLimit: Math.min(snapshotLimit, 200),
        })
        return {
          channel,
          mode: 'recoverable_snapshot',
          events,
        }
      },
    }),
  }
}
