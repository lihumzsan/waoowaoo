import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { toMoneyNumber, type MoneyValue } from '@/lib/billing/money'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import {
  formatProjectValidationIssue,
  normalizeProjectDraft,
  validateProjectDraft,
  type ProjectDraftInput,
} from '@/lib/projects/validation'
import { getDeploymentConfig, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getPlatformDefaultModels } from '@/lib/platform-models/catalog'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { createProjectEpisodeInTransaction } from '@/lib/projects/episode-service'
import {
  isProjectVideoRatio,
  writeProjectVideoRatioInTransaction,
} from '@/lib/projects/video-ratio-write'

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

const EFFECTS_QUERY = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_WRITE = {
  writes: true,
  workspaceResourceImpact: 'none',
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

export function createSystemProjectOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_projects: defineOperation({
      id: 'list_projects',
      summary: 'List user projects with pagination, cost and basic stats.',
      intent: 'query',
      effects: EFFECTS_QUERY,
      inputSchema: z.object({
        page: z.number().int().positive().max(10000).optional(),
        pageSize: z.number().int().positive().max(200).optional(),
        search: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const page = input.page ?? 1
        const pageSize = input.pageSize ?? 12
        const search = input.search?.trim() ?? ''

        const where: Record<string, unknown> = { userId: ctx.userId }
        if (search) {
          where.OR = [
            { name: { contains: search } },
            { description: { contains: search } },
          ]
        }

        const [total, allProjects] = await Promise.all([
          prisma.project.count({ where }),
          prisma.project.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ])

        const projects = [...allProjects].sort((a, b) => {
          if (!a.lastAccessedAt && !b.lastAccessedAt) {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          }
          if (!a.lastAccessedAt && b.lastAccessedAt) return -1
          if (a.lastAccessedAt && !b.lastAccessedAt) return 1
          return new Date(b.lastAccessedAt!).getTime() - new Date(a.lastAccessedAt!).getTime()
        })

        const projectIds = projects.map((project) => project.id)
        const [costsByProject, projectEpisodes] = await Promise.all([
          projectIds.length === 0
            ? []
            : prisma.usageCost.groupBy({
                by: ['projectId'],
                where: { projectId: { in: projectIds } },
                _sum: { cost: true },
              }),
          projectIds.length === 0
            ? []
            : prisma.project.findMany({
                where: { id: { in: projectIds } },
                select: {
                  id: true,
                  characters: {
                    select: {
                      appearances: {
                        select: { imageMediaId: true, imageUrl: true },
                      },
                    },
                  },
                  locations: {
                    select: {
                      images: {
                        select: { imageMediaId: true, imageUrl: true },
                      },
                    },
                  },
                  creativeResources: {
                    where: { mediaType: 'video', status: 'ready', headRevisionId: { not: null } },
                    select: { id: true },
                  },
                  episodes: {
                    orderBy: { episodeNumber: 'asc' },
                    select: {
                      episodeNumber: true,
                      novelText: true,
                    },
                  },
                },
              }),
        ])

        const costMap = new Map(
          (costsByProject as Array<{ projectId: string; _sum: { cost: MoneyValue } }>).map((item) => [
            item.projectId,
            toMoneyNumber(item._sum.cost),
          ]),
        )

        const statsMap = new Map<string, {
          episodes: number
          images: number
          videos: number
          firstEpisodePreview: string | null
        }>(
          projectEpisodes.map((projectEntry) => {
            const imageCount = projectEntry.characters.reduce(
              (total, character) => total + character.appearances.filter((appearance) => appearance.imageMediaId || appearance.imageUrl).length,
              0,
            ) + projectEntry.locations.reduce(
              (total, location) => total + location.images.filter((image) => image.imageMediaId || image.imageUrl).length,
              0,
            )
            const videoCount = projectEntry.creativeResources.length
            const firstEpisode = projectEntry.episodes[0]
            const preview = firstEpisode?.novelText ? firstEpisode.novelText.slice(0, 100) : null
            return [
              projectEntry.id,
              {
                episodes: projectEntry.episodes.length,
                images: imageCount,
                videos: videoCount,
                firstEpisodePreview: preview,
              },
            ]
          }),
        )

        const projectsWithStats = projects.map((project) => ({
          ...project,
          totalCost: costMap.get(project.id) ?? 0,
          stats: statsMap.get(project.id) ?? {
            episodes: 0,
            images: 0,
            videos: 0,
            firstEpisodePreview: null,
          },
        }))

        return {
          projects: projectsWithStats,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        }
      },
    }),

    create_project: defineOperation({
      id: 'create_project',
      summary: 'Create a new project for the current user.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        videoRatio: z.string().trim().min(1).refine(isProjectVideoRatio, {
          message: 'Unsupported project video ratio.',
        }).optional(),
        initialEpisode: z.object({
          name: z.string().trim().min(1),
        }).strict().optional(),
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

        const normalized = normalizeProjectDraft(draft)
        const deployment = getDeploymentConfig()
        const platformDefaults = isPlatformProviderCredentialMode(deployment)
          ? getPlatformDefaultModels()
          : null
        const userPreference = platformDefaults
          ? null
          : await transaction.userPreference.findUnique({
              where: { userId: ctx.userId },
            })

        let project = await transaction.project.create({
          data: {
            name: normalized.name.trim(),
            description: normalized.description?.trim() || null,
            userId: ctx.userId,
            videoRatio: null,
            ...(platformDefaults && {
              analysisModel: platformDefaults.analysisModel,
              characterModel: platformDefaults.characterModel,
              locationModel: platformDefaults.locationModel,
              editModel: platformDefaults.editModel,
              videoModel: platformDefaults.videoModel,
              musicModel: platformDefaults.musicModel,
            }),
            ...(!platformDefaults && userPreference && {
              analysisModel: userPreference.analysisModel,
              characterModel: userPreference.characterModel,
              locationModel: userPreference.locationModel,
              editModel: userPreference.editModel,
              videoModel: userPreference.videoModel,
              musicModel: userPreference.musicModel,
              videoResolution: userPreference.videoResolution,
              imageResolution: userPreference.imageResolution,
            }),
          },
        })

        if (input.videoRatio !== undefined) {
          project = await writeProjectVideoRatioInTransaction({
            transaction,
            projectId: project.id,
            videoRatio: input.videoRatio,
          })
        }

        if (input.initialEpisode) {
          const created = await createProjectEpisodeInTransaction({
            transaction,
            projectId: project.id,
            userId: ctx.userId,
            name: input.initialEpisode.name,
          })
          return { project: created.project, episode: created.episode }
        }

        return { project }
      },
    }),
  }
}
