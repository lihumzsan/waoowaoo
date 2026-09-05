import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import {
  formatProjectValidationIssue,
  normalizeProjectDraft,
  validateProjectDraft,
  type ProjectDraftInput,
} from '@/lib/projects/validation'
import {
  getDeploymentConfig,
  isPlatformProviderCredentialMode,
  isSelfHostedUserProviderCredentialMode,
} from '@/lib/deployment/config'
import { getPlatformDefaultModels } from '@/lib/platform-models/catalog'
import { requireSelectableVideoModel } from '@/lib/model-access/selectable-video-model'
import {
  requireProjectAgentOperationRequest,
  type ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  isProjectVideoRatio,
  writeProjectVideoRatioInTransaction,
} from '@/lib/projects/video-ratio-write'
import {
  buildLocalProjectCapabilityOverrides,
  LOCAL_PROJECT_DEFAULT_MODELS,
  LOCAL_PROJECT_DEFAULT_VIDEO_RATIO,
  validateStoredProjectCapabilityDefaults,
} from '@/lib/projects/creation-defaults'

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
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_WRITE = {
  writes: true,
  workspaceResourceImpact: 'none',
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
      summary: 'List user projects with pagination and basic stats.',
      intent: 'query',
      channels: { tool: false, api: true },
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
        const [resourceCounts] = await Promise.all([
          projectIds.length === 0
            ? []
            : prisma.workspaceResource.groupBy({
                by: ['projectId', 'resourceKind', 'mediaType'],
                where: {
                  projectId: { in: projectIds },
                  deletedAt: null,
                  activePath: { not: null },
                },
                _count: { _all: true },
              }),
        ])

        const statsMap = new Map<string, {
          resources: number
          folders: number
          images: number
          videos: number
        }>()
        for (const count of resourceCounts) {
          const current = statsMap.get(count.projectId) ?? {
            resources: 0,
            folders: 0,
            images: 0,
            videos: 0,
          }
          const amount = count._count._all
          current.resources += amount
          if (count.resourceKind === 'folder') current.folders += amount
          if (count.mediaType === 'image') current.images += amount
          if (count.mediaType === 'video') current.videos += amount
          statsMap.set(count.projectId, current)
        }

        const projectsWithStats = projects.map((project) => ({
          ...project,
          stats: statsMap.get(project.id) ?? {
            resources: 0,
            folders: 0,
            images: 0,
            videos: 0,
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
      channels: { tool: false, api: true },
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        videoRatio: z.string().trim().min(1).refine(isProjectVideoRatio, {
          message: 'Unsupported project video ratio.',
        }).optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const draft = readProjectDraftBody(input)
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
        const deployment = getDeploymentConfig()
        const platformDefaults = isPlatformProviderCredentialMode(deployment)
          ? getPlatformDefaultModels()
          : null
        const usesLocalProjectPreset = isSelfHostedUserProviderCredentialMode(deployment)
        const userPreference = await transaction.userPreference.findUnique({
          where: { userId: ctx.userId },
        })
        const validatedCapabilityDefaults = validateStoredProjectCapabilityDefaults({
          storedUserDefaults: userPreference?.capabilityDefaults,
          storedCustomModels: userPreference?.customModels,
        })
        const inheritedVideoModel = (
          userPreference?.videoModel
          && isSelfHostedUserProviderCredentialMode(deployment)
        )
          ? await requireSelectableVideoModel(ctx.userId, userPreference.videoModel)
          : userPreference?.videoModel ?? (usesLocalProjectPreset
              ? LOCAL_PROJECT_DEFAULT_MODELS.videoModel
              : null)
        const projectVideoRatio = input.videoRatio
          ?? userPreference?.videoRatio
          ?? LOCAL_PROJECT_DEFAULT_VIDEO_RATIO

        let project = await transaction.project.create({
          data: {
            name: normalized.name.trim(),
            description: normalized.description?.trim() || null,
            userId: ctx.userId,
            videoRatio: null,
            ...(platformDefaults && {
              analysisModel: platformDefaults.analysisModel ?? null,
              characterModel: platformDefaults.characterModel,
              locationModel: platformDefaults.locationModel,
              editModel: platformDefaults.editModel,
              videoModel: platformDefaults.videoModel,
              musicModel: platformDefaults.musicModel,
              soundModel: platformDefaults.soundModel ?? null,
            }),
            ...(usesLocalProjectPreset && userPreference && {
              analysisModel: userPreference.analysisModel,
              characterModel: userPreference.characterModel ?? LOCAL_PROJECT_DEFAULT_MODELS.characterModel,
              locationModel: userPreference.locationModel ?? LOCAL_PROJECT_DEFAULT_MODELS.locationModel,
              editModel: userPreference.editModel ?? LOCAL_PROJECT_DEFAULT_MODELS.editModel,
              videoModel: inheritedVideoModel,
              musicModel: userPreference.musicModel,
              soundModel: userPreference.soundModel ?? null,
              videoResolution: userPreference.videoResolution,
              imageResolution: userPreference.imageResolution,
              capabilityOverrides: buildLocalProjectCapabilityOverrides(validatedCapabilityDefaults),
            }),
            ...(usesLocalProjectPreset && !userPreference && {
              ...LOCAL_PROJECT_DEFAULT_MODELS,
              capabilityOverrides: buildLocalProjectCapabilityOverrides(validatedCapabilityDefaults),
            }),
            ...(!platformDefaults && !usesLocalProjectPreset && userPreference && {
              analysisModel: userPreference.analysisModel,
              characterModel: userPreference.characterModel,
              locationModel: userPreference.locationModel,
              editModel: userPreference.editModel,
              videoModel: inheritedVideoModel,
              musicModel: userPreference.musicModel,
              soundModel: userPreference.soundModel,
              videoResolution: userPreference.videoResolution,
              imageResolution: userPreference.imageResolution,
            }),
          },
        })

        project = await writeProjectVideoRatioInTransaction({
          transaction,
          projectId: project.id,
          videoRatio: projectVideoRatio,
        })

        return { project }
      },
    }),
  }
}
