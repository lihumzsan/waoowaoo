import { z } from 'zod'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getUserModelConfig } from '@/lib/config-service'
import { TASK_TYPE } from '@/lib/task/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { normalizeString, submitOperationTask } from '@/lib/operations/submit-operation-task'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  commitReferenceCharacterGeneration,
  planReferenceCharacterGeneration,
  referenceCharacterExtractionInputSchema,
  referenceCharacterGenerationInputSchema,
  submitReferenceCharacterExtraction,
} from '@/lib/operations/domains/reference-character-operations'
import {
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
} from '@/lib/assets/services/asset-scope-ownership'

const EFFECTS_BILLABLE_LONG_RUNNING = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

export function createAssetHubLlmOperations(): ProjectAgentOperationRegistryDraft {
  return {
    asset_hub_ai_design_character: defineOperation({
      id: 'asset_hub_ai_design_character',
      summary: 'Submit global asset-hub character design task (ASSET_HUB_AI_DESIGN_CHARACTER).',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        userInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const userInstruction = input.userInstruction.trim()
        const userConfig = await getUserModelConfig(ctx.userId)
        if (!userConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }
        const digest = createHash('sha1')
          .update(`${ctx.userId}:asset-hub:design-character:${userInstruction}`)
          .digest('hex')
          .slice(0, 16)

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: 'global-asset-hub',
          type: TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER,
          targetType: 'GlobalAssetHubCharacterDesign',
          targetId: ctx.userId,
          operationId: 'asset_hub_ai_design_character',
          source: ctx.source,
          payload: {
            userInstruction,
            analysisModel: userConfig.analysisModel,
            displayMode: 'detail',
          },
          dedupeKey: `asset_hub_ai_design_character:${digest}`,
          priority: 1,
        })
      },
    }),

    asset_hub_ai_design_location: defineOperation({
      id: 'asset_hub_ai_design_location',
      summary: 'Submit global asset-hub location design task (ASSET_HUB_AI_DESIGN_LOCATION).',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        userInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const userInstruction = input.userInstruction.trim()
        const userConfig = await getUserModelConfig(ctx.userId)
        if (!userConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }
        const digest = createHash('sha1')
          .update(`${ctx.userId}:asset-hub:design-location:${userInstruction}`)
          .digest('hex')
          .slice(0, 16)

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: 'global-asset-hub',
          type: TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION,
          targetType: 'GlobalAssetHubLocationDesign',
          targetId: ctx.userId,
          operationId: 'asset_hub_ai_design_location',
          source: ctx.source,
          payload: {
            userInstruction,
            analysisModel: userConfig.analysisModel,
            displayMode: 'detail',
          },
          dedupeKey: `asset_hub_ai_design_location:${digest}`,
          priority: 1,
        })
      },
    }),

    asset_hub_ai_modify_character: defineOperation({
      id: 'asset_hub_ai_modify_character',
      summary: 'Submit asset-hub AI modify character description task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        characterId: z.string().min(1),
        appearanceIndex: z.number().int().min(0).max(50),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: input.characterId,
        })

        const userConfig = await getUserModelConfig(ctx.userId)
        if (!userConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: 'global-asset-hub',
          type: TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER,
          targetType: 'GlobalCharacter',
          targetId: input.characterId,
          operationId: 'asset_hub_ai_modify_character',
          source: ctx.source,
          payload: {
            ...input,
            analysisModel: userConfig.analysisModel,
            displayMode: 'detail',
          },
          dedupeKey: `asset_hub_ai_modify_character:${input.characterId}:${input.appearanceIndex}`,
        })
      },
    }),

    asset_hub_ai_modify_location: defineOperation({
      id: 'asset_hub_ai_modify_location',
      summary: 'Submit asset-hub AI modify location description task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        locationId: z.string().min(1),
        imageIndex: z.number().int().min(0).max(200),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'location',
          assetId: input.locationId,
        })

        const userConfig = await getUserModelConfig(ctx.userId)
        if (!userConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: 'global-asset-hub',
          type: TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION,
          targetType: 'GlobalLocation',
          targetId: input.locationId,
          operationId: 'asset_hub_ai_modify_location',
          source: ctx.source,
          payload: {
            ...input,
            analysisModel: userConfig.analysisModel,
            displayMode: 'detail',
          },
          dedupeKey: `asset_hub_ai_modify_location:${input.locationId}:${input.imageIndex}`,
        })
      },
    }),

    asset_hub_ai_modify_prop: defineOperation({
      id: 'asset_hub_ai_modify_prop',
      summary: 'Submit asset-hub AI modify prop description task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        propId: z.string().min(1),
        variantId: z.string().optional(),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const propId = normalizeString(input.propId) || ''
        const variantId = normalizeString(input.variantId) || ''
        if (!propId) {
          throw new ApiError('INVALID_PARAMS')
        }

        const access = { scope: 'global' as const, userId: ctx.userId }
        if (variantId) {
          await requireOwnedAssetVariant({
            access,
            kind: 'prop',
            assetId: propId,
            variantId,
          })
        } else {
          await requireOwnedAssetTarget({ access, kind: 'prop', assetId: propId })
        }
        const prop = await prisma.globalLocation.findUniqueOrThrow({
          where: { id: propId },
          select: { name: true },
        })

        const userConfig = await getUserModelConfig(ctx.userId)
        if (!userConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: 'global-asset-hub',
          type: TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP,
          targetType: 'GlobalLocation',
          targetId: variantId || propId,
          operationId: 'asset_hub_ai_modify_prop',
          source: ctx.source,
          payload: {
            ...input,
            propId,
            propName: prop.name,
            ...(variantId ? { variantId } : {}),
            analysisModel: userConfig.analysisModel,
            displayMode: 'detail',
          },
          dedupeKey: `asset_hub_ai_modify_prop:${propId}:${variantId || 'default'}`,
        })
      },
    }),

    asset_hub_reference_to_character: defineOperation({
      id: 'asset_hub_reference_to_character',
      summary: 'Plan and submit billable asset-hub reference-to-character image generation.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: 'Generate asset-hub character images after approving the immutable media quote.',
      },
      inputSchema: referenceCharacterGenerationInputSchema,
      outputSchema: z.unknown(),
      plan: async (ctx, input) => await planReferenceCharacterGeneration({
        ctx,
        input,
        scope: 'asset_hub',
        operationId: 'asset_hub_reference_to_character',
      }),
      commit: async (ctx, _input, plan) => await commitReferenceCharacterGeneration({
        ctx,
        plan,
        operationId: 'asset_hub_reference_to_character',
      }),
    }),
    asset_hub_extract_reference_character_description: defineOperation({
      id: 'asset_hub_extract_reference_character_description',
      summary: 'Extract a text description from asset-hub character reference images.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: { kind: 'none', required: false },
      inputSchema: referenceCharacterExtractionInputSchema,
      outputSchema: z.unknown(),
      execute: async (ctx, input) => await submitReferenceCharacterExtraction({
        ctx,
        input,
        scope: 'asset_hub',
        operationId: 'asset_hub_extract_reference_character_description',
      }),
    }),
  }
}
