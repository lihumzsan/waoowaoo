import { beforeEach, describe, expect, it, vi } from 'vitest'

type TaskEventRow = {
  id: number
  taskId: string
  projectId: string
  userId: string
  eventType: string
  payload: Record<string, unknown> | null
  createdAt: Date
}

type TaskMeta = {
  id: string
  type: string
  targetType: string
  targetId: string
  episodeId: string | null
  payload?: Record<string, unknown> | null
}

const taskEventFindManyMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<TaskEventRow[]>>(async () => []),
)

const taskEventCreateMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<TaskEventRow | null>>(async () => null),
)

const taskFindManyMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<TaskMeta[]>>(async () => []),
)

const prismaQueryRawMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
)

const redisPublishMock = vi.hoisted(() => vi.fn(async () => 1))

const scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => void>(() => undefined),
)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: prismaQueryRawMock,
    taskEvent: {
      findMany: taskEventFindManyMock,
      create: taskEventCreateMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
  },
}))

vi.mock('@/lib/redis', () => ({
  redis: {
    publish: redisPublishMock,
  },
}))

vi.mock('@/lib/project-agent/server-follow-up', () => ({
  scheduleResolvedProjectAgentWaitFollowUpsForTaskEvent: scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock,
}))

import {
  listEventsAfter,
  listRecentTerminalLifecycleEvents,
  listTaskLifecycleEvents,
  publishTaskEvent,
  publishTaskStreamEvent,
} from '@/lib/task/publisher'

import { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { listEventsAfter, listRecentTerminalLifecycleEvents, listTaskLifecycleEvents, publishTaskEvent, publishTaskStreamEvent } from '@/lib/task/publisher'
export { TASK_EVENT_TYPE, TASK_TYPE } from '@/lib/task/types'
export { prismaQueryRawMock, redisPublishMock, scheduleResolvedProjectAgentWaitFollowUpsForTaskEventMock, taskEventCreateMock, taskEventFindManyMock, taskFindManyMock }
export type { TaskEventRow, TaskMeta }
