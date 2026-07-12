import { z } from 'zod'
import { createHash } from 'crypto'
import { ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  commitReferenceCharacterGeneration,
  planReferenceCharacterGeneration,
  referenceCharacterExtractionInputSchema,
  referenceCharacterGenerationInputSchema,
  submitReferenceCharacterExtraction,
} from '@/lib/operations/domains/reference-character-operations'

const EFFECTS_BILLABLE_LONG_RUNNING = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

export function createExtraOperations(): ProjectAgentOperationRegistryDraft {
  return {
    ai_create_character: defineOperation({
      id: 'ai_create_character',
      summary: 'Submit AI create character design task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
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
        const modelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        if (!modelConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }
        const dedupeDigest = createHash('sha1')
          .update(`${ctx.projectId}:${ctx.userId}:character:${userInstruction}`)
          .digest('hex')
          .slice(0, 16)

        const payload = {
          userInstruction,
          analysisModel: modelConfig.analysisModel,
          displayMode: 'detail',
        }

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_CREATE_CHARACTER,
          targetType: 'ProjectCharacterDesign',
          targetId: ctx.projectId,
          operationId: 'ai_create_character',
          source: ctx.source,
          payload,
          dedupeKey: `project_ai_create_character:${dedupeDigest}`,
        })
      },
    }),
    ai_create_location: defineOperation({
      id: 'ai_create_location',
      summary: 'Submit AI create location design task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
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
        const modelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        if (!modelConfig.analysisModel) {
          throw new ApiError('MISSING_CONFIG')
        }
        const dedupeDigest = createHash('sha1')
          .update(`${ctx.projectId}:${ctx.userId}:location:${userInstruction}`)
          .digest('hex')
          .slice(0, 16)

        const payload = {
          userInstruction,
          analysisModel: modelConfig.analysisModel,
          displayMode: 'detail',
        }

        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_CREATE_LOCATION,
          targetType: 'ProjectLocationDesign',
          targetId: ctx.projectId,
          operationId: 'ai_create_location',
          source: ctx.source,
          payload,
          dedupeKey: `project_ai_create_location:${dedupeDigest}`,
        })
      },
    }),
    ai_modify_location: defineOperation({
      id: 'ai_modify_location',
      summary: 'Submit AI modify location task.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      inputSchema: z.object({
        locationId: z.string().min(1),
        imageIndex: z.number().int().min(0).optional(),
        currentDescription: z.string().min(1),
        modifyInstruction: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const imageIndex = input.imageIndex ?? 0
        return await submitOperationTask({
          request: ctx.request,
          locale: resolveOperationLocale(ctx.context),
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.AI_MODIFY_LOCATION,
          targetType: 'ProjectLocation',
          targetId: input.locationId,
          operationId: 'ai_modify_location',
          source: ctx.source,
          payload: {
            ...input,
            imageIndex,
          } as unknown as Record<string, unknown>,
          dedupeKey: `ai_modify_location:${input.locationId}:${imageIndex}`,
        })
      },
    }),
    reference_to_character: defineOperation({
      id: 'reference_to_character',
      summary: 'Plan and submit billable reference-to-character image generation.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: 'Generate character images from references after approving the immutable media quote.',
      },
      inputSchema: referenceCharacterGenerationInputSchema,
      outputSchema: z.unknown(),
      plan: async (ctx, input) => await planReferenceCharacterGeneration({
        ctx,
        input,
        scope: 'project',
        operationId: 'reference_to_character',
      }),
      commit: async (ctx, _input, plan) => await commitReferenceCharacterGeneration({
        ctx,
        plan,
        operationId: 'reference_to_character',
      }),
    }),
    extract_reference_character_description: defineOperation({
      id: 'extract_reference_character_description',
      summary: 'Extract a text description from character reference images.',
      intent: 'act',
      effects: EFFECTS_BILLABLE_LONG_RUNNING,
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: { kind: 'none', required: false },
      inputSchema: referenceCharacterExtractionInputSchema,
      outputSchema: z.unknown(),
      execute: async (ctx, input) => await submitReferenceCharacterExtraction({
        ctx,
        input,
        scope: 'project',
        operationId: 'extract_reference_character_description',
      }),
    }),
  }
}
