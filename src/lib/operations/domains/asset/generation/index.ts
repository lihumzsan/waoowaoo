import { z } from 'zod'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  assertOperationPlanConfirmedCost,
  resolveConfirmedMaxCostForExecution,
} from '@/lib/operations/planning'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { commitAssetImageOperation } from './commit'
import {
  buildGenerateCharacterImageInputSchema,
  buildGenerateLocationImageInputSchema,
  planCharacterImageGenerationOperation,
  planLocationImageGenerationOperation,
} from './generate'
import {
  modifyCharacterImageInputSchema,
  modifyLocationImageInputSchema,
  planAssetImageModificationOperation,
} from './modify'

export function createAssetImageOperations(): ProjectAgentOperationRegistryDraft {
  const withMutationBatchBase = taskSubmitOperationOutputSchemaBase.extend({
    mutationBatchId: z.string().min(1),
  }).passthrough()

  const taskSubmitOutputWithMutationBatch = <TShape extends z.ZodRawShape>(shape: TShape) => refineTaskSubmitOperationOutputSchema(
    withMutationBatchBase.extend(shape).passthrough(),
  )

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
        required: true,
        summary: '将为角色生成形象图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: buildGenerateCharacterImageInputSchema(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        characterId: z.string().min(1),
        appearanceId: z.string().nullable(),
      }),
      plan: async (ctx, input) => planCharacterImageGenerationOperation(ctx, input),
      commit: async (ctx, input, plan) => commitAssetImageOperation({
        ctx,
        input,
        plan,
        operationId: 'generate_character_image',
      }),
      execute: async (ctx, input) => {
        const plan = await planCharacterImageGenerationOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitAssetImageOperation({
          ctx,
          input,
          plan,
          operationId: 'generate_character_image',
        })
      },
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
        required: true,
        summary: '将为场景生成图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: buildGenerateLocationImageInputSchema(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        locationId: z.string().min(1),
      }),
      plan: async (ctx, input) => planLocationImageGenerationOperation(ctx, input),
      commit: async (ctx, input, plan) => commitAssetImageOperation({
        ctx,
        input,
        plan,
        operationId: 'generate_location_image',
      }),
      execute: async (ctx, input) => {
        const plan = await planLocationImageGenerationOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitAssetImageOperation({
          ctx,
          input,
          plan,
          operationId: 'generate_location_image',
        })
      },
    }),

    modify_character_image: defineOperation({
      id: 'modify_character_image',
      summary: 'Modify a project character image using the edit model.',
      intent: 'act',
      groupPath: ['asset', 'character'],
      effects: {
        writes: true,
        billable: true,
        destructive: true,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将修改角色图片（可能覆盖现有结果且可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: modifyCharacterImageInputSchema,
      outputSchema: taskSubmitOutputWithMutationBatch({
        assetId: z.string().min(1),
      }),
      plan: async (ctx, input) => planAssetImageModificationOperation({
        ctx,
        input: input as Record<string, unknown>,
        operationId: 'modify_character_image',
        kind: 'character',
      }),
      commit: async (ctx, input, plan) => commitAssetImageOperation({
        ctx,
        input,
        plan,
        operationId: 'modify_character_image',
      }),
      execute: async (ctx, input) => {
        const plan = await planAssetImageModificationOperation({
          ctx,
          input: input as Record<string, unknown>,
          operationId: 'modify_character_image',
          kind: 'character',
        })
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitAssetImageOperation({
          ctx,
          input,
          plan,
          operationId: 'modify_character_image',
        })
      },
    }),

    modify_location_image: defineOperation({
      id: 'modify_location_image',
      summary: 'Modify a project location image using the edit model.',
      intent: 'act',
      groupPath: ['asset', 'location'],
      effects: {
        writes: true,
        billable: true,
        destructive: true,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将修改场景图片（可能覆盖现有结果且可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: modifyLocationImageInputSchema,
      outputSchema: taskSubmitOutputWithMutationBatch({
        assetId: z.string().min(1),
      }),
      plan: async (ctx, input) => planAssetImageModificationOperation({
        ctx,
        input: input as Record<string, unknown>,
        operationId: 'modify_location_image',
        kind: 'location',
      }),
      commit: async (ctx, input, plan) => commitAssetImageOperation({
        ctx,
        input,
        plan,
        operationId: 'modify_location_image',
      }),
      execute: async (ctx, input) => {
        const plan = await planAssetImageModificationOperation({
          ctx,
          input: input as Record<string, unknown>,
          operationId: 'modify_location_image',
          kind: 'location',
        })
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitAssetImageOperation({
          ctx,
          input,
          plan,
          operationId: 'modify_location_image',
        })
      },
    }),
  }
}
