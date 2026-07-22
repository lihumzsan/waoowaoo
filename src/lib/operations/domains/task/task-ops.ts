import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { listTaskLifecycleEvents } from '@/lib/task/publisher'
import { cancelTask, getTaskById, queryTasks } from '@/lib/task/service'
import { TASK_STATUS, TASK_TYPE, type TaskStatus, type TaskType } from '@/lib/task/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

const taskStatusSchema = z.enum(Object.values(TASK_STATUS) as [TaskStatus, ...TaskStatus[]])
const taskTypeSchema = z.enum(Object.values(TASK_TYPE) as [TaskType, ...TaskType[]])

const listTasksInputSchema = z.object({
  projectId: z.string().trim().min(1).optional()
    .describe('Filter by the exact project ID. Omit to query tasks across the current user.'),
  targetType: z.string().trim().min(1).optional()
    .describe('Filter by the exact persisted task target type.'),
  targetId: z.string().trim().min(1).optional()
    .describe('Filter by the exact persisted task target ID.'),
  status: z.array(taskStatusSchema).min(1).optional()
    .describe('Filter by one or more exact task lifecycle statuses.'),
  type: z.array(taskTypeSchema).min(1).optional()
    .describe('Filter by one or more exact task types.'),
  limit: z.number().int().min(1).max(200).optional()
    .describe('Maximum tasks to return. Defaults to 50.'),
}).strict()

const getTaskInputSchema = z.object({
  taskId: z.string().trim().min(1).describe('Exact task ID.'),
  includeEvents: z.boolean().optional()
    .describe('Whether to include persisted lifecycle events. Defaults to false.'),
  eventsLimit: z.number().int().min(1).max(5000).optional()
    .describe('Maximum lifecycle events to return when includeEvents is true. Defaults to 500.'),
}).strict()

function withTaskError(task: Awaited<ReturnType<typeof queryTasks>>[number]) {
  const error = normalizeTaskError(task.errorCode, task.errorMessage)
  return {
    ...task,
    error,
  }
}

export function createTaskOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_tasks: defineOperation({
      id: 'list_tasks',
      summary: 'List tasks for the current user with optional filters.',
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
      inputSchema: listTasksInputSchema,
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const tasks = await queryTasks({
          projectId: input.projectId,
          targetType: input.targetType,
          targetId: input.targetId,
          status: input.status,
          type: input.type,
          limit: input.limit ?? 50,
        })

        const filtered = tasks
          .filter((task) => task.userId === ctx.userId)
          .map(withTaskError)
        return { tasks: filtered }
      },
    }),

    get_task: defineOperation({
      id: 'get_task',
      summary: 'Get task detail for the current user; optionally includes lifecycle events.',
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
      inputSchema: getTaskInputSchema,
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const task = await getTaskById(input.taskId)
        if (!task || task.userId !== ctx.userId) {
          throw new ApiError('NOT_FOUND')
        }

        const events = input.includeEvents
          ? await listTaskLifecycleEvents(input.taskId, input.eventsLimit ?? 500)
          : null

        return {
          task: {
            ...task,
            error: normalizeTaskError(task.errorCode, task.errorMessage),
          },
          ...(events ? { events } : {}),
        }
      },
    }),

    cancel_task: defineOperation({
      id: 'cancel_task',
      summary: 'Cancel a task owned by the current user and publish cancelled lifecycle payload.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: true,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      channels: { tool: false, api: true },
      confirmation: {
        required: true,
        summary: '将取消该任务。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        taskId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const task = await getTaskById(input.taskId)
        if (!task || task.userId !== ctx.userId) {
          throw new ApiError('NOT_FOUND')
        }

        const { task: updatedTask, cancelled } = await cancelTask(input.taskId)
        if (!updatedTask) {
          throw new ApiError('NOT_FOUND')
        }

        return {
          success: true,
          cancelled,
          task: {
            ...updatedTask,
            error: normalizeTaskError(updatedTask.errorCode, updatedTask.errorMessage),
          },
        }
      },
    }),
  }
}
