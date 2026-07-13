import { z } from 'zod'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  refineTaskBatchSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import {
  commitContinuityExperimentImagesOperation,
  continuityExperimentInputSchema,
  planContinuityExperimentImagesOperation,
} from './continuity-image'

export function createContinuityExperimentOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_continuity_experiment_images: defineOperation({
      id: 'generate_continuity_experiment_images',
      summary: 'Generate a fixed matrix of storyboard continuity experiment images.',
      intent: 'act',
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将按当前固定实验矩阵并行生成图片并产生媒体费用；批准后不会覆盖正式分镜。',
      },
      inputSchema: continuityExperimentInputSchema,
      outputSchema: refineTaskBatchSubmitOperationOutputSchema(
        taskBatchSubmitOperationOutputSchemaBase.extend({
          runId: z.string().uuid(),
        }).passthrough(),
      ),
      plan: async (ctx, input) => planContinuityExperimentImagesOperation(ctx, input),
      commit: async (ctx, input, plan) => commitContinuityExperimentImagesOperation(ctx, input, plan),
    }),
  }
}
