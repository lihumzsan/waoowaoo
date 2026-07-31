import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { deleteProjectOwnedCreativeResourceLineage } from '@/lib/creative-resource/project-deletion'
import { deleteProjectNarrativeProjections } from '@/lib/story-canon/project-deletion'
import { addSignedUrlsToProject } from '@/lib/storage'
import { logProjectAction } from '@/lib/logging/semantic'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
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

const updateProjectInputSchema: z.ZodType<ProjectUpdateInput> = z.object({
  command: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('name'),
      name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
    }).strict(),
    z.object({
      kind: z.literal('description'),
      description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullable(),
    }).strict(),
    z.object({
      kind: z.literal('details'),
      name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
      description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH).nullable(),
    }).strict(),
  ]).describe('Choose exactly one project update command.'),
}).strict()

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
        const project = await requireOwnedProject({ projectId: ctx.projectId, userId: ctx.userId })
        return { project: addSignedUrlsToProject(project) }
      },
    },

    update_project: defineOperation({
      id: 'update_project',
      summary: 'Update project name/description for the project owner.',
      intent: 'act',
      toolContractRevision: 'update_project/v1',
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
        const draft: ProjectDraftInput = input.command.kind === 'name'
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
          const locale = resolveTaskLocale(
            requireProjectAgentOperationRequest(ctx),
            input,
          ) ?? 'zh'
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
          { changes: { name: updatedProject.name, description: updatedProject.description } },
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
        summary: '将删除整个项目及其关联数据（不可恢复）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, _input, transaction) => {
        const project = await requireOwnedProject(
          { projectId: ctx.projectId, userId: ctx.userId },
          transaction,
        )

        await deleteProjectOwnedCreativeResourceLineage({
          projectId: ctx.projectId,
          transaction,
        })
        await deleteProjectNarrativeProjections({
          projectId: ctx.projectId,
          transaction,
        })

        await transaction.project.delete({
          where: { id: ctx.projectId },
        })

        logProjectAction(
          'DELETE',
          ctx.userId,
          project.user?.name,
          ctx.projectId,
          project.name,
          {
            projectName: project.name,
          },
        )

        return { success: true }
      },
    },
  }
}
