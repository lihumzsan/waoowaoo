import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { listEventsAfter, getProjectChannel, listRecentTerminalLifecycleEvents } from '@/lib/task/publisher'
import { listMutationBatchReplayEvents } from '@/lib/mutation-batch/service'
import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  TASK_STATUS,
  WORKSPACE_SSE_EVENT_TYPE,
  type MutationBatchSSEEvent,
  type ResourceChangedSSEEvent,
  type TaskSSEEvent,
} from '@/lib/task/types'
import { coerceTaskIntent } from '@/lib/task/intent'
import { withTaskCoveredTargetsPayload } from '@/lib/task/covered-targets'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { parseWorkspaceSseCursor } from '@/lib/sse/protocol'
import { listLatestProjectAgentSessionChangedEvent } from '@/lib/project-agent/session-event'
import { listWorkspaceResourceReplayEvents } from '@/lib/workspace-resource/resource-change-events'
import {
  GLOBAL_ASSET_PROJECT_ID,
  resolveWorkspaceResourceRefs,
  WORKSPACE_RESOURCE_IMPACT,
} from '@/lib/workspace-resource/resource-impact'

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

function buildRecoveryMutationCheckpoint(params: {
  projectId: string
  userId: string
  episodeId: string | null
}): MutationBatchSSEEvent {
  const checkpointAt = new Date()
  const checkpointId = `!snapshot:${params.projectId}`
  return {
    id: `mb:${checkpointAt.getTime()}:${checkpointId}`,
    type: WORKSPACE_SSE_EVENT_TYPE.MUTATION_BATCH,
    mutationBatchId: checkpointId,
    projectId: params.projectId,
    userId: params.userId,
    ts: checkpointAt.toISOString(),
    operationId: null,
    episodeId: params.episodeId,
    targets: [{
      targetType: params.projectId === 'global-asset-hub' ? 'GlobalAsset' : 'ProjectEpisode',
      targetId: params.episodeId ?? params.projectId,
    }],
  }
}

function buildRecoveryResourceCheckpoint(params: {
  projectId: string
  userId: string
  episodeId: string | null
}): ResourceChangedSSEEvent {
  const checkpointAt = new Date()
  return {
    id: `wr:${checkpointAt.getTime()}:!snapshot:${params.projectId}`,
    type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
    projectId: params.projectId,
    userId: params.userId,
    ts: checkpointAt.toISOString(),
    affectedResources: resolveWorkspaceResourceRefs({
      impact: params.projectId === GLOBAL_ASSET_PROJECT_ID
        ? WORKSPACE_RESOURCE_IMPACT.GLOBAL_ASSETS
        : WORKSPACE_RESOURCE_IMPACT.PROJECT_WORKSPACE,
      projectId: params.projectId,
      episodeId: params.episodeId,
    }),
  }
}

async function listActiveLifecycleSnapshot(params: {
  projectId: string
  episodeId: string | null
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
      ...(params.episodeId ? { episodeId: params.episodeId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      targetType: true,
      targetId: true,
      episodeId: true,
      userId: true,
      status: true,
      progress: true,
      payload: true,
      updatedAt: true,
    },
  })

  return rows.map((row): TaskSSEEvent => {
    const payload = asObject(row.payload)
    const payloadUi = asObject(payload?.ui)
    const lifecycleType = row.status === TASK_STATUS.QUEUED
      ? TASK_EVENT_TYPE.CREATED
      : TASK_EVENT_TYPE.PROCESSING
    const eventPayload = withTaskCoveredTargetsPayload({
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
      episodeId: row.episodeId,
      payload: eventPayload,
    }
  })
}

async function listRecoverableLifecycleSnapshot(params: {
  projectId: string
  episodeId: string | null
  userId: string
  activeLimit?: number
  terminalLimit?: number
}): Promise<TaskSSEEvent[]> {
  const [terminalEvents, activeEvents] = await Promise.all([
    listRecentTerminalLifecycleEvents({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      limit: params.terminalLimit ?? 200,
    }),
    listActiveLifecycleSnapshot({
      projectId: params.projectId,
      episodeId: params.episodeId,
      userId: params.userId,
      limit: params.activeLimit ?? 500,
    }),
  ])

  return uniqueTaskEvents([...terminalEvents, ...activeEvents])
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
        episodeId: z.string().optional().nullable(),
        assistantId: z.literal('workspace-command').optional(),
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
        const episodeId = input.episodeId ? input.episodeId.trim() : null
        const assistantId = input.assistantId ?? 'workspace-command'

        if (
          cursor.taskEventId > 0
          || cursor.mutationEventAtMs > 0
          || cursor.agentEventId !== '0'
          || cursor.resourceEventAtMs > 0
        ) {
          const replayLimit = input.replayLimit ?? 5000
          const [taskEvents, mutationEvents, assistantEvents, resourceEvents] = await Promise.all([
            cursor.taskEventId > 0
              ? listEventsAfter(ctx.projectId, cursor.taskEventId, replayLimit)
              : Promise.resolve([]),
            cursor.mutationEventAtMs > 0 && cursor.mutationBatchId
              ? listMutationBatchReplayEvents({
                  projectId: ctx.projectId,
                  userId: ctx.userId,
                  after: {
                    createdAt: new Date(cursor.mutationEventAtMs),
                    batchId: cursor.mutationBatchId,
                  },
                  episodeId,
                  limit: replayLimit,
                })
              : Promise.resolve([]),
            listLatestProjectAgentSessionChangedEvent({
              projectId: ctx.projectId,
              userId: ctx.userId,
              episodeId,
              assistantId,
              afterEventId: cursor.agentEventId,
            }),
            cursor.resourceEventAtMs > 0 && cursor.resourceOutboxId
              ? listWorkspaceResourceReplayEvents({
                  projectId: ctx.projectId,
                  userId: ctx.userId,
                  after: {
                    createdAt: new Date(cursor.resourceEventAtMs),
                    outboxId: cursor.resourceOutboxId,
                  },
                  limit: replayLimit,
                })
              : Promise.resolve([]),
          ])
          const userTaskEvents = taskEvents.filter((event) => event.userId === ctx.userId)
          const recoverableTaskEvents = includeRecoverableSnapshot
            ? await listRecoverableLifecycleSnapshot({
                projectId: ctx.projectId,
                episodeId,
                userId: ctx.userId,
                activeLimit: input.snapshotLimit ?? 500,
                terminalLimit: Math.min(input.snapshotLimit ?? 500, 200),
              })
            : []
          const recoveryCheckpoint = cursor.mutationEventAtMs === 0
            ? [buildRecoveryMutationCheckpoint({
                projectId: ctx.projectId,
                userId: ctx.userId,
                episodeId,
              })]
            : []
          const resourceRecoveryCheckpoint = (
            cursor.resourceEventAtMs === 0
            || resourceEvents.length === replayLimit
          )
            ? [buildRecoveryResourceCheckpoint({
                projectId: ctx.projectId,
                userId: ctx.userId,
                episodeId,
              })]
            : []
          const events = [
            ...userTaskEvents,
            ...mutationEvents,
            ...assistantEvents,
            ...resourceEvents,
            ...recoverableTaskEvents,
            ...recoveryCheckpoint,
            ...resourceRecoveryCheckpoint,
          ]
            .sort((left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id))
          return {
            channel,
            mode: cursor.taskEventId > 0 && cursor.mutationEventAtMs > 0
              ? 'composite_replay'
              : cursor.taskEventId > 0
                ? 'missed_event_replay'
                : includeRecoverableSnapshot
                  ? 'mutation_replay_with_active_snapshot'
                  : 'mutation_replay',
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
        const [events, assistantEvents] = await Promise.all([
          listRecoverableLifecycleSnapshot({
            projectId: ctx.projectId,
            episodeId,
            userId: ctx.userId,
            activeLimit: snapshotLimit,
            terminalLimit: Math.min(snapshotLimit, 200),
          }),
          listLatestProjectAgentSessionChangedEvent({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
            assistantId,
            afterEventId: '0',
          }),
        ])
        return {
          channel,
          mode: 'recoverable_snapshot',
          events: [...events, ...assistantEvents, buildRecoveryMutationCheckpoint({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
          }), buildRecoveryResourceCheckpoint({
            projectId: ctx.projectId,
            userId: ctx.userId,
            episodeId,
          })],
        }
      },
    }),
  }
}
