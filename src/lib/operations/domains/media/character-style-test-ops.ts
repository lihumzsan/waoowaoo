import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { resolveEditScriptStyleBibleForTask } from '@/lib/edit-script/style-bible-prompt'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { taskSubmitOperationOutputSchema } from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { TASK_TYPE } from '@/lib/task/types'

export function createCharacterStyleTestOperations(): ProjectAgentOperationRegistryDraft {
  return {
    character_style_test: defineOperation({
      id: 'character_style_test',
      summary: 'Submit a Style Bible based character asset reference image test.',
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
        summary: '将生成一张角色风格测试图（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        episodeId: z.string().min(1),
        characterRequest: z.string().min(1).max(2000),
      }).passthrough(),
      outputSchema: taskSubmitOperationOutputSchema,
      execute: async (ctx, input) => {
        const characterRequest = input.characterRequest.trim()
        const episodeId = input.episodeId.trim()
        const styleBible = await resolveEditScriptStyleBibleForTask({
          projectId: ctx.projectId,
          episodeId,
        })
        if (!styleBible) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'EDIT_SCRIPT_STYLE_BIBLE_REQUIRED',
            message: 'Style Bible is required before character style testing',
          })
        }

        const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        let billingPayload: Record<string, unknown>
        try {
          billingPayload = await buildImageBillingPayload({
            projectId: ctx.projectId,
            userId: ctx.userId,
            imageModel: projectModelConfig.characterModel,
            basePayload: {
              characterRequest,
              episodeId,
              count: 1,
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image model capability not configured'
          throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
        }

        const locale = resolveRequiredTaskLocale(ctx.request, billingPayload)

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          locale,
          projectId: ctx.projectId,
          episodeId,
          type: TASK_TYPE.CHARACTER_STYLE_TEST,
          targetType: 'CharacterStyleTest',
          targetId: episodeId,
          operationId: 'character_style_test',
          source: ctx.source,
          confirmed: input.confirmed === true,
          payload: withTaskUiPayload(billingPayload, {
            intent: 'generate',
            hasOutputAtStart: false,
          }),
          billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.CHARACTER_STYLE_TEST, billingPayload),
          decoratePayload: false,
        })
      },
    }),
  }
}
