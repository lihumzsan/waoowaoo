import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig, isPlatformProviderCredentialMode, toPublicDeploymentConfig } from '@/lib/deployment/config'
import {
  assertPlatformUserModelKey,
  getPlatformDefaultModels,
  resolvePlatformUserModelPreferences,
} from '@/lib/platform-models/catalog'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

function assertNoLegacyArtStyle(body: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(body, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Creative Direction workflow.',
  })
}

const ALLOWED_FIELDS: ReadonlyArray<string> = [
  'assistantModel',
  'analysisModel',
  'characterModel',
  'locationModel',
  'editModel',
  'videoModel',
  'musicModel',
  'videoRatio',
  'assistantBillingConfirmationRequired',
]

const PLATFORM_IMAGE_MODEL_FIELDS = [
  'characterModel',
  'locationModel',
  'editModel',
] as const

function requirePlatformModelValue(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PLATFORM_USER_MODEL_REQUIRED',
      field,
    })
  }
  return value.trim()
}

function assertPlatformModelUpdate(body: Record<string, unknown>): void {
  const forbiddenField = ['analysisModel', 'musicModel']
    .find((field) => Object.prototype.hasOwnProperty.call(body, field))
  if (forbiddenField) {
    throw new ApiError('FORBIDDEN', {
      code: 'PLATFORM_MODEL_NOT_USER_SELECTABLE',
      field: forbiddenField,
    })
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assistantModel')) {
    const modelKey = requirePlatformModelValue(body, 'assistantModel')
    try {
      assertPlatformUserModelKey('llm', modelKey)
    } catch {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PLATFORM_USER_MODEL_NOT_ALLOWED',
        field: 'assistantModel',
      })
    }
  }

  const writesImageModel = PLATFORM_IMAGE_MODEL_FIELDS.some((field) => (
    Object.prototype.hasOwnProperty.call(body, field)
  ))
  if (writesImageModel) {
    if (!PLATFORM_IMAGE_MODEL_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(body, field))) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PLATFORM_IMAGE_MODEL_UPDATE_INCOMPLETE',
        field: 'characterModel',
      })
    }
    const modelKeys = PLATFORM_IMAGE_MODEL_FIELDS.map((field) => requirePlatformModelValue(body, field))
    if (new Set(modelKeys).size !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PLATFORM_IMAGE_MODELS_MUST_MATCH',
        field: 'characterModel',
      })
    }
    try {
      assertPlatformUserModelKey('image', modelKeys[0] ?? '')
    } catch {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PLATFORM_USER_MODEL_NOT_ALLOWED',
        field: 'characterModel',
      })
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'videoModel')) {
    const modelKey = requirePlatformModelValue(body, 'videoModel')
    try {
      assertPlatformUserModelKey('video', modelKey)
    } catch {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PLATFORM_USER_MODEL_NOT_ALLOWED',
        field: 'videoModel',
      })
    }
  }
}

const modelKeyPreferenceSchema = z.string().trim().min(1).nullable()
  .describe('Exact provider::modelId key from list_user_models, or null to clear the preference.')

const updateUserPreferenceInputSchema = z.object({
  assistantModel: modelKeyPreferenceSchema.optional(),
  analysisModel: modelKeyPreferenceSchema.optional(),
  characterModel: modelKeyPreferenceSchema.optional(),
  locationModel: modelKeyPreferenceSchema.optional(),
  editModel: modelKeyPreferenceSchema.optional(),
  videoModel: modelKeyPreferenceSchema.optional(),
  musicModel: modelKeyPreferenceSchema.optional(),
  videoRatio: z.string().trim().min(1).optional()
    .describe('Default output aspect ratio, for example 16:9 or 9:16.'),
  assistantBillingConfirmationRequired: z.boolean().optional()
    .describe('Whether billable Assistant operations must pause for an immutable quote approval.'),
}).strict()

async function lockUserPreferenceOwner(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const owners = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM user WHERE id = ${userId} FOR UPDATE
  `)
  if (owners.length !== 1) {
    throw new ApiError('NOT_FOUND', { code: 'USER_PREFERENCE_OWNER_NOT_FOUND' })
  }
}

export function createUserPreferenceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_user_preference: defineOperation({
      id: 'get_user_preference',
      summary: 'Get or initialize the current user preference record.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, _input, transaction) => {
        const deployment = getDeploymentConfig()
        await lockUserPreferenceOwner(transaction, ctx.userId)
        const preference = await transaction.userPreference.upsert({
          where: { userId: ctx.userId },
          update: {},
          create: { userId: ctx.userId },
        })

        if (isPlatformProviderCredentialMode(deployment)) {
          const runtimeDefaults = getPlatformDefaultModels()
          const userModels = resolvePlatformUserModelPreferences(preference)
          return {
            preference: {
              ...preference,
              ...userModels,
            },
            deployment: toPublicDeploymentConfig(deployment),
            runtimeDefaults,
          }
        }

        return {
          preference,
          deployment: toPublicDeploymentConfig(deployment),
        }
      },
    }),

    update_user_preference: defineOperation({
      id: 'update_user_preference',
      summary: 'Update allowed fields of the current user preference record.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: {
        required: true,
        summary: '将覆盖更新用户偏好设置（例如模型等）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: updateUserPreferenceInputSchema,
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const deployment = getDeploymentConfig()
        await lockUserPreferenceOwner(transaction, ctx.userId)
        const body: Record<string, unknown> = input
        if (isPlatformProviderCredentialMode(deployment)) {
          assertPlatformModelUpdate(body)
        }

        const updateData: Record<string, unknown> = {}
        assertNoLegacyArtStyle(body)
        for (const field of ALLOWED_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(body, field)) continue
          const value = body[field]
          if (value === undefined) continue
          updateData[field] = value
        }

        if (Object.keys(updateData).length === 0) {
          throw new ApiError('INVALID_PARAMS')
        }

        const preference = await transaction.userPreference.upsert({
          where: { userId: ctx.userId },
          update: updateData,
          create: { userId: ctx.userId, ...updateData },
        })

        if (isPlatformProviderCredentialMode(deployment)) {
          return {
            preference: {
              ...preference,
              ...resolvePlatformUserModelPreferences(preference),
            },
          }
        }
        return { preference }
      },
    }),
  }
}
