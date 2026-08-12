import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { deleteProjectOwnedWorkspaceResourceLineage } from '@/lib/workspace-resource/project-deletion'
import { addSignedUrlsToProject } from '@/lib/storage'
import { logProjectAction } from '@/lib/logging/semantic'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_STATUS } from '@/lib/task/types'
import {
  formatProjectValidationIssue,
  normalizeProjectDraft,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  validateProjectDraft,
  type ProjectDraftInput,
  type ProjectUpdateInput,
} from '@/lib/projects/validation'
import {
  requireProjectAgentOperationRequest,
  type ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

const ACTIVE_ASSISTANT_TURN_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
] as const

const PENDING_ASSISTANT_INTERACTION_STATUSES = [
  'pending',
  'decided',
] as const

const updateProjectInputSchema: z.ZodType<ProjectUpdateInput> = z
  .object({
    command: z
      .discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('name'),
            name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
          })
          .strict(),
        z
          .object({
            kind: z.literal('description'),
            description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullable(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('details'),
            name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
            description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullable(),
          })
          .strict(),
      ])
      .describe('Choose exactly one project update command.'),
  })
  .strict()

async function requireOwnedProject(
  params: { projectId: string; userId: string },
  client: Pick<Prisma.TransactionClient, 'project'> = prisma,
) {
  const project = await client.project.findUnique({
    where: { id: params.projectId },
    include: { user: true },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== params.userId) {
    throw new ApiError('FORBIDDEN')
  }

  return project
}

export function createProjectCrudOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_basic: {
      id: 'get_project_basic',
      summary: 'Load base project info.',
      intent: 'query',
      channels: { tool: false, api: true },
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({}),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        const project = await requireOwnedProject({
          projectId: ctx.projectId,
          userId: ctx.userId,
        })
        return { project: addSignedUrlsToProject(project) }
      },
    },

    update_project: defineOperation({
      id: 'update_project',
      summary: 'Update project name/description for the project owner.',
      intent: 'act',
      channels: { tool: false, api: true, mcp: false },
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_data',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: updateProjectInputSchema,
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const existing = await requireOwnedProject(
          { projectId: ctx.projectId, userId: ctx.userId },
          transaction,
        )
        const draft: ProjectDraftInput =
          input.command.kind === 'name'
            ? {
                name: input.command.name,
                description: existing.description,
              }
            : input.command.kind === 'description'
              ? {
                  name: existing.name,
                  description: input.command.description,
                }
              : {
                  name: input.command.name,
                  description: input.command.description,
                }
        const validationIssue = validateProjectDraft(draft)
        if (validationIssue) {
          const locale = resolveTaskLocale(requireProjectAgentOperationRequest(ctx), input) ?? 'zh'
          throw new ApiError('INVALID_PARAMS', {
            code: validationIssue.code,
            field: validationIssue.field,
            ...(typeof validationIssue.limit === 'number' ? { limit: validationIssue.limit } : {}),
            message: formatProjectValidationIssue(validationIssue, locale),
          })
        }

        const normalized = normalizeProjectDraft(draft)

        const updatedProject = await transaction.project.update({
          where: { id: ctx.projectId },
          data: {
            name: normalized.name.trim(),
            description: normalized.description?.trim() || null,
          },
        })

        logProjectAction(
          'UPDATE',
          ctx.userId,
          existing.user?.name,
          ctx.projectId,
          updatedProject.name,
          {
            changes: {
              name: updatedProject.name,
              description: updatedProject.description,
            },
          },
        )

        return { project: updatedProject }
      },
    }),

    delete_project: {
      id: 'delete_project',
      summary: 'Delete the project and its domain relations (destructive).',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: true,
        overwrite: true,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: {
        required: true,
        summary:
          '将删除整个项目及其关联数据（不可恢复）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, _input, transaction) => {
        // Planned long-running Operations lock this same Project row before
        // creating Tasks. Deletion joins that serialization boundary so a Task
        // cannot be inserted between the non-terminal check and final delete.
        const lockedProjects = await transaction.$queryRaw<
          Array<{
            id: string
            userId: string
          }>
        >`
          SELECT id, userId
          FROM projects
          WHERE id = ${ctx.projectId}
          FOR UPDATE
        `
        const lockedProject = lockedProjects[0] ?? null
        if (!lockedProject) throw new ApiError('NOT_FOUND')
        if (lockedProject.userId !== ctx.userId) throw new ApiError('FORBIDDEN')

        const project = await requireOwnedProject(
          { projectId: ctx.projectId, userId: ctx.userId },
          transaction,
        )

        const [activeTaskCount, activeTurnCount, activeInteractionCount] = await Promise.all([
          transaction.task.count({
            where: {
              projectId: ctx.projectId,
              status: {
                notIn: [
                  TASK_STATUS.COMPLETED,
                  TASK_STATUS.FAILED,
                  TASK_STATUS.CANCELED,
                  TASK_STATUS.DISMISSED,
                ],
              },
            },
          }),
          transaction.projectAgentTurn.count({
            where: {
              projectId: ctx.projectId,
              status: { in: [...ACTIVE_ASSISTANT_TURN_STATUSES] },
            },
          }),
          transaction.agentTurnInteraction.count({
            where: {
              turn: { projectId: ctx.projectId },
              status: { in: [...PENDING_ASSISTANT_INTERACTION_STATUSES] },
            },
          }),
        ])
        if (activeTaskCount > 0 || activeTurnCount > 0 || activeInteractionCount > 0) {
          throw new ApiError('CONFLICT', {
            code: 'PROJECT_DELETE_ACTIVE_EXECUTION',
            activeTaskCount,
            activeTurnCount,
            activeInteractionCount,
          })
        }

        await deleteProjectOwnedWorkspaceResourceLineage({
          projectId: ctx.projectId,
          transaction,
        })
        // FollowUpBatch deliberately has no Project foreign key because a
        // terminal Task may settle after the originating Thread disappears.
        // Project deletion must therefore close this recovery authority
        // explicitly before cascading the Thread/Turn rows; otherwise a late
        // Task terminal can still try to create a ghost Agent Turn.
        await transaction.followUpBatch.updateMany({
          where: {
            projectId: ctx.projectId,
            status: { in: ['pending', 'ready', 'notified'] },
          },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
          },
        })

        await transaction.project.delete({
          where: { id: ctx.projectId },
        })

        logProjectAction('DELETE', ctx.userId, project.user?.name, ctx.projectId, project.name, {
          projectName: project.name,
        })

        return { success: true }
      },
    },
  }
}
