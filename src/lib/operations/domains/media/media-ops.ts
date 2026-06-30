import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { ensureProjectLocationImageSlots } from '@/lib/image-generation/location-slots'
import { hasCharacterAppearanceOutput, hasLocationImageOutput } from '@/lib/task/has-output'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { CHARACTER_ASSET_IMAGE_RATIO, LOCATION_IMAGE_RATIO } from '@/lib/constants'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { taskSubmitOperationOutputSchema } from '@/lib/operations/output-schemas'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

export function createMediaOperations(): ProjectAgentOperationRegistryDraft {
  return {
    regenerate_group: defineOperation({
      id: 'regenerate_group',
      summary: 'Regenerate a group of asset images (character/location) by submitting an async task.',
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
        summary: '将批量重生成图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        type: z.enum(['character', 'location']),
        id: z.string().min(1),
        appearanceId: z.string().min(1).optional(),
        count: z.number().int().positive().max(12).optional(),
      }).passthrough().refine((value) => (value.type !== 'character' || !!value.appearanceId), {
        message: 'appearanceId is required when type=character',
        path: ['appearanceId'],
      }),
      outputSchema: taskSubmitOperationOutputSchema,
      execute: async (ctx, input) => {
        assertNoLegacyArtStyle(toObject(input))
        const count = input.type === 'character'
          ? normalizeImageGenerationCount('character', (input as Record<string, unknown>).count)
          : normalizeImageGenerationCount('location', (input as Record<string, unknown>).count)

        const appearanceId = normalizeString((input as Record<string, unknown>).appearanceId)
        const targetType = input.type === 'character' ? 'CharacterAppearance' : 'LocationImage'
        const targetId = input.type === 'character' ? appearanceId : input.id

        if (!targetId) {
          throw new ApiError('INVALID_PARAMS')
        }

        if (input.type === 'location') {
          const location = await prisma.projectLocation.findUnique({
            where: { id: input.id },
            select: { name: true, summary: true },
          })
          if (!location) {
            throw new ApiError('NOT_FOUND')
          }
          await ensureProjectLocationImageSlots({
            locationId: input.id,
            count,
            fallbackDescription: location.summary || location.name,
          })
        }

        const hasOutputAtStart = input.type === 'character'
          ? await hasCharacterAppearanceOutput({
              appearanceId,
              characterId: input.id,
            })
          : await hasLocationImageOutput({
              locationId: input.id,
            })

        const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        const imageModel = input.type === 'character'
          ? projectModelConfig.characterModel
          : projectModelConfig.locationModel

        let billingPayload: Record<string, unknown>
        try {
          billingPayload = await buildImageBillingPayload({
            projectId: ctx.projectId,
            userId: ctx.userId,
            imageModel,
            basePayload: {
              ...(toObject(input)),
              count,
            },
            aspectRatio: input.type === 'character' ? CHARACTER_ASSET_IMAGE_RATIO : LOCATION_IMAGE_RATIO,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image model capability not configured'
          throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
        }

        const locale = resolveRequiredTaskLocale(ctx.request, billingPayload)
        const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
          projectId: ctx.projectId,
          episodeId: normalizeString(toObject(input).episodeId) || null,
        })

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          locale,
          projectId: ctx.projectId,
          type: TASK_TYPE.REGENERATE_GROUP,
          targetType,
          targetId,
          operationId: 'regenerate_group',
          source: ctx.source,
          confirmed: input.confirmed === true,
          payload: withTaskUiPayload(billingPayload, {
            intent: 'regenerate',
            hasOutputAtStart,
          }),
          dedupeKey: `regenerate_group:${targetType}:${targetId}:${count}:${styleBibleSignature}`,
          billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.REGENERATE_GROUP, billingPayload),
          decoratePayload: false,
        })
      },
    }),

    regenerate_single_image: defineOperation({
      id: 'regenerate_single_image',
      summary: 'Regenerate a single image by index for character/location (async task submission).',
      intent: 'act',
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将重生成单张图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        type: z.enum(['character', 'location']),
        id: z.string().min(1),
        appearanceId: z.string().min(1).optional(),
        imageIndex: z.union([z.number().int().min(0).max(200), z.string().min(1)]),
      }).passthrough(),
      outputSchema: taskSubmitOperationOutputSchema,
      execute: async (ctx, input) => {
        assertNoLegacyArtStyle(toObject(input))
        const imageIndex = (input as Record<string, unknown>).imageIndex
        const parsedImageIndex = toNumberOrNull(imageIndex)
        if (parsedImageIndex === null) {
          throw new ApiError('INVALID_PARAMS')
        }

        const appearanceId = normalizeString((input as Record<string, unknown>).appearanceId)
        const taskType = input.type === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION
        const targetType = input.type === 'character' ? 'CharacterAppearance' : 'LocationImage'
        const targetId = input.type === 'character' ? (appearanceId || input.id) : input.id

        const hasOutputAtStart = input.type === 'character'
          ? await hasCharacterAppearanceOutput({
              appearanceId: targetId,
              characterId: input.id,
            })
          : await hasLocationImageOutput({
              locationId: input.id,
              imageIndex: parsedImageIndex,
            })

        const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
        const imageModel = input.type === 'character'
          ? projectModelConfig.characterModel
          : projectModelConfig.locationModel

        let billingPayload: Record<string, unknown>
        try {
          billingPayload = await buildImageBillingPayload({
            projectId: ctx.projectId,
            userId: ctx.userId,
            imageModel,
            basePayload: {
              ...(toObject(input)),
              imageIndex: parsedImageIndex,
            },
            aspectRatio: input.type === 'character' ? CHARACTER_ASSET_IMAGE_RATIO : LOCATION_IMAGE_RATIO,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image model capability not configured'
          throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
        }

        const locale = resolveRequiredTaskLocale(ctx.request, billingPayload)
        const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
          projectId: ctx.projectId,
          episodeId: normalizeString(toObject(input).episodeId) || null,
        })

        return await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          locale,
          projectId: ctx.projectId,
          type: taskType,
          targetType,
          targetId,
          operationId: 'regenerate_single_image',
          source: ctx.source,
          confirmed: input.confirmed === true,
          payload: withTaskUiPayload(billingPayload, {
            intent: 'regenerate',
            hasOutputAtStart,
          }),
          dedupeKey: `${taskType}:${targetId}:single:${parsedImageIndex}:${styleBibleSignature}`,
          billingInfo: buildDefaultTaskBillingInfo(taskType, billingPayload),
          decoratePayload: false,
        })
      },
    }),

  }
}
