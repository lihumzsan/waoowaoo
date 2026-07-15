import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logProjectAction } from '@/lib/logging/semantic'
import { ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { buildProjectReadModel } from '@/lib/projects/build-project-read-model'
import {
  type CapabilitySelections,
  type UnifiedModelType,
} from '@/lib/ai-registry/types'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { resolveBuiltinModelContext, getCapabilityOptionFields, validateCapabilitySelectionsPayload, type CapabilityModelContext } from '@/lib/ai-registry/capabilities-catalog'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { getDeploymentConfig, isCloudDeployment, toPublicDeploymentConfig } from '@/lib/deployment/config'

const MODEL_FIELDS = [
  'analysisModel',
  'characterModel',
  'locationModel',
  'editModel',
  'videoModel',
  'musicModel',
] as const

const CLOUD_PROJECT_CONFIG_FIELDS = ['videoRatio'] as const

const MODEL_FIELD_TO_TYPE: Record<typeof MODEL_FIELDS[number], UnifiedModelType> = {
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  musicModel: 'music',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertNoLegacyStyleFields(body: Record<string, unknown>) {
  for (const field of ['artStyle', 'visualStylePreset'] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    throw new ApiError('INVALID_PARAMS', {
      code: 'LEGACY_STYLE_CONFIG_REMOVED',
      field,
      message: 'legacy visual style config is no longer supported; use the AI-generated Style Bible workflow.',
    })
  }
}

function assertCloudProjectConfigFields(body: Record<string, unknown>) {
  for (const field of Object.keys(body)) {
    if ((CLOUD_PROJECT_CONFIG_FIELDS as readonly string[]).includes(field)) continue
    throw new ApiError('FORBIDDEN', {
      code: 'PROJECT_CONFIG_MANAGED_BY_PLATFORM',
      field,
    })
  }
}

function normalizeCapabilitySelectionsInput(
  raw: unknown,
  options?: { allowLegacyAspectRatio?: boolean },
): CapabilitySelections {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CAPABILITY_SELECTION_INVALID',
      field: 'capabilityOverrides',
    })
  }

  const normalized: CapabilitySelections = {}
  for (const [modelKey, rawSelection] of Object.entries(raw)) {
    if (!isRecord(rawSelection)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CAPABILITY_SELECTION_INVALID',
        field: `capabilityOverrides.${modelKey}`,
      })
    }

    const selection: Record<string, string | number | boolean> = {}
    for (const [field, value] of Object.entries(rawSelection)) {
      if (field === 'aspectRatio') {
        if (options?.allowLegacyAspectRatio) continue
        throw new ApiError('INVALID_PARAMS', {
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilityOverrides.${modelKey}.${field}`,
        })
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CAPABILITY_SELECTION_INVALID',
          field: `capabilityOverrides.${modelKey}.${field}`,
        })
      }
      selection[field] = value
    }

    if (Object.keys(selection).length > 0) {
      normalized[modelKey] = selection
    }
  }

  return normalized
}

function parseStoredCapabilitySelections(raw: string | null | undefined): CapabilitySelections {
  if (!raw) return {}
  try {
    return normalizeCapabilitySelectionsInput(JSON.parse(raw) as unknown, { allowLegacyAspectRatio: true })
  } catch {
    return {}
  }
}

function serializeCapabilitySelections(selections: CapabilitySelections): string | null {
  if (Object.keys(selections).length === 0) return null
  return JSON.stringify(selections)
}

function validateModelKeyField(field: typeof MODEL_FIELDS[number], value: unknown) {
  if (value === null) return
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field,
    })
  }
  if (!parseModelKeyStrict(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field,
    })
  }
}

function resolveCapabilityContext(
  modelKey: string,
  modelContextMap: Record<string, CapabilityModelContext>,
): CapabilityModelContext | null {
  return modelContextMap[modelKey] || null
}

function getNextProjectModelMap(
  current: {
    analysisModel: string | null
    characterModel: string | null
    locationModel: string | null
    editModel: string | null
    videoModel: string | null
    musicModel: string | null
  },
  updates: Record<string, unknown>,
): Record<string, CapabilityModelContext> {
  const nextMap = new Map<string, CapabilityModelContext>()

  for (const field of MODEL_FIELDS) {
    const rawValue = updates[field] !== undefined
      ? updates[field]
      : current[field]
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue

    const modelKey = rawValue.trim()
    const context = resolveBuiltinModelContext(MODEL_FIELD_TO_TYPE[field], modelKey)
    if (!context) continue
    nextMap.set(modelKey, context)
  }

  return Object.fromEntries(nextMap.entries())
}

function sanitizeCapabilityOverrides(
  overrides: CapabilitySelections,
  modelContextMap: Record<string, CapabilityModelContext>,
): CapabilitySelections {
  const sanitized: CapabilitySelections = {}

  for (const [modelKey, selection] of Object.entries(overrides)) {
    const context = resolveCapabilityContext(modelKey, modelContextMap)
    if (!context) continue

    const optionFields = getCapabilityOptionFields(context.modelType, context.capabilities)
    if (Object.keys(optionFields).length === 0) continue

    const cleanedSelection: Record<string, string | number | boolean> = {}
    for (const [field, value] of Object.entries(selection)) {
      const allowedValues = optionFields[field]
      if (!allowedValues) continue
      if (!allowedValues.includes(value)) continue
      cleanedSelection[field] = value
    }

    if (Object.keys(cleanedSelection).length > 0) {
      sanitized[modelKey] = cleanedSelection
    }
  }

  return sanitized
}

function validateCapabilityOverrides(
  overrides: CapabilitySelections,
  modelContextMap: Record<string, CapabilityModelContext>,
) {
  const issues = validateCapabilitySelectionsPayload(overrides, (modelKey) =>
    resolveCapabilityContext(modelKey, modelContextMap))

  if (issues.length > 0) {
    const firstIssue = issues[0]
    throw new ApiError('INVALID_PARAMS', {
      code: firstIssue.code,
      field: firstIssue.field,
      allowedValues: firstIssue.allowedValues,
    })
  }
}

export function createConfigOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_config: {
      id: 'get_project_config',
      summary: 'Get project model and capability override configuration (sanitized).',
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
      outputSchema: z.object({
        configurable: z.boolean(),
        capabilityOverrides: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
      }).passthrough(),
      execute: async (ctx) => {
        const deployment = getDeploymentConfig()
        if (isCloudDeployment(deployment)) {
          return {
            configurable: false,
            capabilityOverrides: {},
            deployment: toPublicDeploymentConfig(deployment),
          }
        }

        const projectData = await prisma.project.findUnique({
          where: { id: ctx.projectId },
            select: {
              capabilityOverrides: true,
              analysisModel: true,
            characterModel: true,
            locationModel: true,
            editModel: true,
            videoModel: true,
            musicModel: true,
          },
        })
        if (!projectData) {
          throw new ApiError('NOT_FOUND', {
            code: 'PROJECT_NOT_FOUND',
            field: 'projectId',
          })
        }
        const storedOverrides = parseStoredCapabilitySelections(projectData.capabilityOverrides)
        const modelContextMap = getNextProjectModelMap({
          analysisModel: projectData.analysisModel,
          characterModel: projectData.characterModel,
          locationModel: projectData.locationModel,
          editModel: projectData.editModel,
          videoModel: projectData.videoModel,
          musicModel: projectData.musicModel,
        }, {})
        const cleanedOverrides = sanitizeCapabilityOverrides(storedOverrides, modelContextMap)

        return {
          configurable: true,
          capabilityOverrides: cleanedOverrides,
          deployment: toPublicDeploymentConfig(deployment),
        }
      },
    },

    update_project_config: {
      id: 'update_project_config',
      summary: 'Update project model keys and capability overrides.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_data',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: { required: true },
      inputSchema: z.object({
        analysisModel: z.string().nullable().optional(),
        characterModel: z.string().nullable().optional(),
        locationModel: z.string().nullable().optional(),
        editModel: z.string().nullable().optional(),
        videoModel: z.string().nullable().optional(),
        musicModel: z.string().nullable().optional(),
        videoRatio: z.string().optional(),
        capabilityOverrides: z.unknown().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const deployment = getDeploymentConfig()
        const cloudDeployment = isCloudDeployment(deployment)
        const body = input as unknown as Record<string, unknown>
        assertNoLegacyStyleFields(body)
        if (cloudDeployment) {
          assertCloudProjectConfigFields(body)
        }

        const currentProjectConfig = await transaction.project.findUnique({
          where: { id: ctx.projectId },
          select: {
            id: true,
            name: true,
            analysisModel: true,
            characterModel: true,
            locationModel: true,
            editModel: true,
            videoModel: true,
            musicModel: true,
          },
        })
        if (!currentProjectConfig) {
          throw new ApiError('NOT_FOUND')
        }

        const allowedProjectFields = [
          ...(cloudDeployment ? [] : MODEL_FIELDS),
          'videoRatio',
          ...(cloudDeployment ? [] : ['capabilityOverrides'] as const),
        ] as const

        const updateData: Record<string, unknown> = {}
        for (const field of allowedProjectFields) {
          if (body[field] === undefined) continue

          if ((MODEL_FIELDS as readonly string[]).includes(field)) {
            validateModelKeyField(field as typeof MODEL_FIELDS[number], body[field])
          }

          if (field === 'capabilityOverrides') {
            const overrides = normalizeCapabilitySelectionsInput(body.capabilityOverrides)
            const modelContextMap = getNextProjectModelMap(currentProjectConfig, body)
            const cleanedOverrides = sanitizeCapabilityOverrides(overrides, modelContextMap)
            validateCapabilityOverrides(cleanedOverrides, modelContextMap)
            updateData.capabilityOverrides = serializeCapabilitySelections(cleanedOverrides)
            continue
          }

          updateData[field] = body[field]
        }

        const updatedProject = await transaction.project.update({
          where: { id: ctx.projectId },
          data: updateData,
        })

        const projectWithSignedUrls = await attachMediaFieldsToProject(updatedProject)
        const fullProject = buildProjectReadModel(updatedProject, projectWithSignedUrls)

        logProjectAction(
          'UPDATE_NOVEL_PROMOTION',
          ctx.userId,
          null,
          ctx.projectId,
          currentProjectConfig.name,
          { changes: body },
        )

        return { project: fullProject }
      },
    },
  }
}
