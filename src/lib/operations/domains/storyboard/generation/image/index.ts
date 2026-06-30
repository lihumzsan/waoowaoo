import { z } from 'zod'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { assertOperationPlanConfirmedCost, resolveConfirmedMaxCostForExecution } from '@/lib/operations/planning'
import { refineTaskSubmitOperationOutputSchema, refineTaskBatchSubmitOperationOutputSchema, taskBatchSubmitOperationOutputSchemaBase, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { commitGenerateEditScriptStoryboardImagesOperation, planGenerateEditScriptStoryboardImagesOperation } from './edit-script-storyboard-images'
import { commitGenerateStoryboardGridImagesOperation, planGenerateStoryboardGridImagesOperation } from './storyboard-grid-images'
import { commitRegeneratePanelImageOperation, planRegeneratePanelImageOperation } from './regenerate-panel-image'

export function createStoryboardPanelImageOperations(): ProjectAgentOperationRegistryDraft {
  const withMutationBatchBase = taskSubmitOperationOutputSchemaBase.extend({
    mutationBatchId: z.string().min(1),
  }).passthrough()

  const taskSubmitOutputWithMutationBatch = <TShape extends z.ZodRawShape>(shape: TShape) => refineTaskSubmitOperationOutputSchema(
    withMutationBatchBase.extend(shape).passthrough(),
  )
  const storyboardImageBatchOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
      storyboardIds: z.array(z.string().min(1)),
      panelIds: z.array(z.string().min(1)),
      generationMode: z.enum(['single', 'grid']),
    }).passthrough(),
  )

  return {
    generate_edit_script_storyboard_images: defineOperation({
      id: 'generate_edit_script_storyboard_images',
      summary: 'Generate missing storyboard panel images for the edit-first storyboard.',
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
        required: true,
        summary: '将为当前剪辑先行分镜中缺失图片的格子批量生成分镜图片，可能消耗额度或产生计费。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        episodeId: z.string().trim().min(1).optional(),
        storyboardId: z.string().trim().min(1).optional(),
        generationMode: z.enum(['single', 'grid']).optional(),
      }).passthrough(),
      outputSchema: storyboardImageBatchOutputSchema,
      plan: async (ctx, input) => planGenerateEditScriptStoryboardImagesOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateEditScriptStoryboardImagesOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateEditScriptStoryboardImagesOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return storyboardImageBatchOutputSchema.parse(
          await commitGenerateEditScriptStoryboardImagesOperation(ctx, input, plan),
        )
      },
    }),
    generate_storyboard_grid_images: defineOperation({
      id: 'generate_storyboard_grid_images',
      summary: 'Generate storyboard panel images as one 2x2 grid for a selected storyboard group.',
      intent: 'act',
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将把本组分镜作为一张四宫格图片生成，再裁剪回单张分镜图，可能消耗额度或产生计费。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        episodeId: z.string().trim().min(1),
        editScriptId: z.string().trim().min(1),
        sourceGenerationSegmentId: z.string().trim().min(1),
        panelIds: z.array(z.string().trim().min(1)).min(2).max(4),
      }).passthrough(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        episodeId: z.string().min(1),
        sourceGenerationSegmentId: z.string().min(1),
        panelIds: z.array(z.string().min(1)),
      }),
      plan: async (ctx, input) => planGenerateStoryboardGridImagesOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateStoryboardGridImagesOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateStoryboardGridImagesOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitGenerateStoryboardGridImagesOperation(ctx, input, plan)
      },
    }),
    regenerate_panel_image: defineOperation({
      id: 'regenerate_panel_image',
      summary: 'Regenerate storyboard panel images (async task submission).',
      intent: 'act',
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
        summary: '将为分镜格子重新生成图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        panelId: z.string().min(1).optional(),
        storyboardId: z.string().min(1).optional(),
        panelIndex: z.number().int().min(0).max(1000).optional(),
        count: z.number().int().positive().max(4).optional(),
        referenceMode: z.enum(['asset', 'storyboard']).optional(),
        referencePanelIds: z.array(z.string().min(1)).max(8).optional(),
        extraImageUrls: z.array(z.unknown()).max(8).optional(),
        referenceImageNotes: z.array(z.unknown()).max(16).optional(),
      }).refine((value) => Boolean(value.panelId || (value.storyboardId && typeof value.panelIndex === 'number')), {
        message: 'panelId or (storyboardId + panelIndex) is required',
        path: ['panelId'],
      }),
      outputSchema: taskSubmitOutputWithMutationBatch({
        panelId: z.string().min(1),
      }),
      plan: async (ctx, input) => planRegeneratePanelImageOperation(ctx, input),
      commit: async (ctx, input, plan) => commitRegeneratePanelImageOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planRegeneratePanelImageOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitRegeneratePanelImageOperation(ctx, input, plan)
      },
    }),
  }
}
