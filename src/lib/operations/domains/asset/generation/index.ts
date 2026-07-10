import { z } from 'zod'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { commitAssetImageOperation } from './commit'
import {
  buildGenerateCharacterImageInputSchema,
  buildGenerateLocationImageInputSchema,
  planCharacterImageGenerationOperation,
  planLocationImageGenerationOperation,
} from './generate'

export function createAssetImageOperations(): ProjectAgentOperationRegistryDraft {
  const withMutationBatchBase = taskSubmitOperationOutputSchemaBase
    .extend({
      mutationBatchId: z.string().min(1),
    })
    .passthrough()

  const taskSubmitOutputWithMutationBatch = <TShape extends z.ZodRawShape>(shape: TShape) =>
    refineTaskSubmitOperationOutputSchema(withMutationBatchBase.extend(shape).passthrough())

  return {
    generate_character_image: defineOperation({
      id: 'generate_character_image',
      summary: 'Generate character appearance images for a project character.',
      intent: 'act',
      groupPath: ['asset', 'character'],
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将为角色生成形象图片并产生媒体费用；用户批准当前不可变计划后执行。',
      },
      inputSchema: buildGenerateCharacterImageInputSchema(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        characterId: z.string().min(1),
        appearanceId: z.string().nullable(),
      }),
      plan: async (ctx, input) => planCharacterImageGenerationOperation(ctx, input),
      commit: async (ctx, input, plan) =>
        commitAssetImageOperation({
          ctx,
          input,
          plan,
          operationId: 'generate_character_image',
        }),
    }),

    generate_location_image: defineOperation({
      id: 'generate_location_image',
      summary: 'Generate location images for a project location.',
      intent: 'act',
      groupPath: ['asset', 'location'],
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将为场景生成图片并产生媒体费用；用户批准当前不可变计划后执行。',
      },
      inputSchema: buildGenerateLocationImageInputSchema(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        locationId: z.string().min(1),
      }),
      plan: async (ctx, input) => planLocationImageGenerationOperation(ctx, input),
      commit: async (ctx, input, plan) =>
        commitAssetImageOperation({
          ctx,
          input,
          plan,
          operationId: 'generate_location_image',
        }),
    }),
  }
}
