import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { getErrorSpec } from '@/lib/errors/codes'
import {
  projectErrorForUser,
  projectPublicErrorDetails,
} from '@/lib/errors/projection'
import { parseFailureRecord } from '@/lib/errors/failure'
import { listTaskLifecycleEvents } from '@/lib/task/publisher'
import { getTaskById, queryTasks } from '@/lib/task/service'
import { queryTaskTargetStates } from '@/lib/task/state-service'
import { cancelTemporalTask } from '@/lib/temporal/task-client'
import { withRetry } from '@/lib/retry'
import {
  isTaskType,
  TASK_STATUS,
  TASK_TYPE,
  type TaskStatus,
  type TaskType,
} from '@/lib/task/types'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

const taskStatusSchema = z.enum(Object.values(TASK_STATUS) as [TaskStatus, ...TaskStatus[]])
const taskTypeSchema = z.enum(Object.values(TASK_TYPE) as [TaskType, ...TaskType[]])
const taskTargetSchema = z.object({
  targetType: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  types: z.array(z.string().trim().min(1)).optional(),
}).strict()

const listTasksInputSchema = z
  .object({
    projectId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Filter by the exact project ID. Omit to query tasks across the current user.'),
    targetType: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Filter by the exact persisted task target type.'),
    targetId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Filter by the exact persisted task target ID.'),
    status: z
      .array(taskStatusSchema)
      .min(1)
      .optional()
      .describe('Filter by one or more exact task lifecycle statuses.'),
    type: z
      .array(taskTypeSchema)
      .min(1)
      .optional()
      .describe('Filter by one or more exact task types.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum tasks to return. Defaults to 50.'),
  })
  .strict()

const getTaskInputSchema = z
  .object({
    taskId: z.string().trim().min(1).describe('Exact task ID.'),
    events: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }).strict(),
        z
          .object({
            kind: z.literal('include'),
            limit: z
              .number()
              .int()
              .min(1)
              .max(5000)
              .optional()
              .describe('Maximum lifecycle events to return. Defaults to 500.'),
          })
          .strict(),
      ])
      .describe('Choose whether persisted lifecycle events are returned.'),
  })
  .strict()

export type GetTaskInput = z.infer<typeof getTaskInputSchema>

function withTaskError(task: Awaited<ReturnType<typeof queryTasks>>[number]) {
  const publicTask: Partial<typeof task> = { ...task }
  delete publicTask.failure
  const failure = parseFailureRecord(task.failure)
  const userProjection = task.status === TASK_STATUS.FAILED
    ? projectErrorForUser(
        failure?.interpretation.code,
        failure?.native.requestId ?? null,
      )
    : null
  const error = userProjection
    ? {
        ...userProjection,
        category: getErrorSpec(userProjection.code).category,
        details: projectPublicErrorDetails(failure?.interpretation.details),
      }
    : null
  return {
    ...publicTask,
    errorCode: error?.code ?? null,
    error,
  }
}

function isTaskVisibleInOperationContext(
  ctx: ProjectAgentOperationContext,
  task: NonNullable<Awaited<ReturnType<typeof getTaskById>>>,
): boolean {
  if (task.userId !== ctx.userId) return false
  if (ctx.invocationChannel === 'api') return true
  return task.projectId === ctx.projectId
}

export function createTaskOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_task_status: defineOperation({
      id: 'get_task_status',
      summary: 'API-only: Query current Task presentation state for exact project targets.',
      intent: 'query',
      channels: { tool: false, api: true, mcp: false },
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
        targets: z.array(taskTargetSchema).min(1).max(500),
      }).strict(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => ({
        states: await withRetry({
          operation: EXTERNAL_OPERATION.DATABASE_READ,
          scope: 'prisma:get_task_status',
          run: async () => await queryTaskTargetStates({
            projectId: ctx.projectId,
            userId: ctx.userId,
            targets: input.targets,
          }),
        }),
      }),
    }),
    list_tasks: defineOperation({
      id: 'list_tasks',
      summary: 'List tasks for the current user with optional filters.',
      intent: 'query',
      channels: { tool: false, api: true, mcp: false },
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
        const restrictedToAssistantScope = ctx.invocationChannel !== 'api'
        if (restrictedToAssistantScope && input.projectId && input.projectId !== ctx.projectId) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'TASK_PROJECT_SCOPE_INVALID',
            field: 'projectId',
          })
        }
        const tasks = await queryTasks({
          userId: ctx.userId,
          projectId: restrictedToAssistantScope ? ctx.projectId : input.projectId,
          targetType: input.targetType,
          targetId: input.targetId,
          status: input.status,
          type: input.type,
          limit: input.limit ?? 50,
        })

        return { tasks: tasks.map(withTaskError) }
      },
    }),

    get_task: defineOperation({
      id: 'get_task',
      summary: 'Get task detail for the current user; optionally includes lifecycle events.',
      intent: 'query',
      channels: { tool: false, api: true, mcp: false },
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
        if (!task || !isTaskVisibleInOperationContext(ctx, task)) {
          throw new ApiError('NOT_FOUND')
        }

        const events =
          input.events.kind === 'include'
            ? await listTaskLifecycleEvents(input.taskId, input.events.limit ?? 500)
            : null

        return {
          task: {
            ...withTaskError(task),
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

        const active = task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.PROCESSING
        if (!isTaskType(task.type)) {
          throw new ApiError('CONFLICT', { code: 'TASK_TYPE_INVALID' })
        }
        const workflow = active
          ? await cancelTemporalTask({
              reference: {
                taskId: task.id,
                userId: task.userId,
                taskType: task.type,
              },
              reason: 'Task cancelled by user',
            })
          : null
        const updatedTask = await getTaskById(input.taskId)
        if (!updatedTask) {
          throw new ApiError('NOT_FOUND')
        }

        return {
          success: true,
          cancelAccepted: workflow?.cancelRequested === true || workflow?.status === 'canceled',
          task: {
            ...withTaskError(updatedTask),
          },
        }
      },
    }),
  }
}
