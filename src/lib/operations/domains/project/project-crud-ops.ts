import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { addSignedUrlsToProject } from '@/lib/storage'
import { logProjectAction } from '@/lib/logging/semantic'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import {
  formatProjectValidationIssue,
  normalizeProjectDraft,
  validateProjectDraft,
  type ProjectDraftInput,
} from '@/lib/projects/validation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

function readProjectDraftBody(body: unknown): ProjectDraftInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { name: '' }
  }

  const payload = body as Record<string, unknown>
  return {
    name: typeof payload.name === 'string' ? payload.name : '',
    description: typeof payload.description === 'string' ? payload.description : null,
  }
}

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

    update_project: {
      id: 'update_project',
      summary: 'Update project name/description for the project owner.',
      intent: 'act',
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
      inputSchema: z.object({
        name: z.string().optional(),
        description: z.string().optional().nullable(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const draft = readProjectDraftBody(input)
        const validationIssue = validateProjectDraft(draft)
        if (validationIssue) {
          const locale = resolveTaskLocale(ctx.request, input) ?? 'zh'
          throw new ApiError('INVALID_PARAMS', {
            code: validationIssue.code,
            field: validationIssue.field,
            ...(typeof validationIssue.limit === 'number' ? { limit: validationIssue.limit } : {}),
            message: formatProjectValidationIssue(validationIssue, locale),
          })
        }

        const existing = await requireOwnedProject(
          { projectId: ctx.projectId, userId: ctx.userId },
          transaction,
        )
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
    },

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
