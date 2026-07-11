import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { addSignedUrlsToProject, deleteObjects } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
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

async function collectProjectStorageKeys(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      characters: {
        include: {
          appearances: true,
        },
      },
      locations: {
        include: {
          images: true,
        },
      },
      episodes: {
        include: {
          storyboards: {
            include: {
              panels: true,
            },
          },
        },
      },
    },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  const keys: string[] = []

  for (const character of project.characters) {
    for (const appearance of character.appearances) {
      const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
      if (key) keys.push(key)
    }
  }

  for (const location of project.locations) {
    for (const image of location.images) {
      const key = await resolveStorageKeyFromMediaValue(image.imageUrl)
      if (key) keys.push(key)
    }
  }

  for (const episode of project.episodes) {
    const audioKey = await resolveStorageKeyFromMediaValue(episode.audioUrl)
    if (audioKey) keys.push(audioKey)

    for (const storyboard of episode.storyboards) {
      const storyboardKey = await resolveStorageKeyFromMediaValue(storyboard.storyboardImageUrl)
      if (storyboardKey) keys.push(storyboardKey)

      for (const panel of storyboard.panels) {
        const imageKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
        if (imageKey) keys.push(imageKey)

        const videoKey = await resolveStorageKeyFromMediaValue(panel.videoUrl)
        if (videoKey) keys.push(videoKey)

      }
    }
  }

  return keys
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
      summary: 'Delete the project and cleanup storage objects (destructive).',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: {
        writes: true,
        billable: false,
        destructive: true,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将删除整个项目及其关联数据（不可恢复）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        const project = await requireOwnedProject({ projectId: ctx.projectId, userId: ctx.userId })

        const keys = await collectProjectStorageKeys(ctx.projectId)
        const cosKeys = Array.from(new Set(keys.filter(Boolean)))

        const cosResult = cosKeys.length > 0
          ? await deleteObjects(cosKeys)
          : { success: 0, failed: 0 }

        await prisma.project.delete({
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
            cosFilesDeleted: cosResult.success,
            cosFilesFailed: cosResult.failed,
          },
        )

        return {
          success: true,
          cosFilesDeleted: cosResult.success,
          cosFilesFailed: cosResult.failed,
        }
      },
    },
  }
}
