import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
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
import { taskSubmitOperationOutputSchema } from '@/lib/operations/output-schemas'
import { createPlannedTask, submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

function requireImageBillingInfo(
  taskType: typeof TASK_TYPE.REGENERATE_GROUP | typeof TASK_TYPE.IMAGE_CHARACTER | typeof TASK_TYPE.IMAGE_LOCATION,
  payload: Record<string, unknown>,
) {
  const billingInfo = buildDefaultTaskBillingInfo(taskType, payload)
  if (!billingInfo || billingInfo.billable !== true || billingInfo.apiType !== 'image') {
    throw new Error(`MEDIA_OPERATION_IMAGE_BILLING_INFO_REQUIRED:${taskType}`)
  }
  return billingInfo
}

const regenerateGroupInputSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('character'),
      characterId: z.string().trim().min(1).describe('Exact project character ID.'),
      appearanceId: z.string().trim().min(1).describe('Exact character appearance ID.'),
    }).strict(),
    z.object({
      kind: z.literal('location'),
      locationId: z.string().trim().min(1).describe('Exact project location ID.'),
    }).strict(),
  ]),
  count: z.number().int().positive().max(12).optional(),
}).strict()

async function planRegenerateGroupOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<typeof regenerateGroupInputSchema>,
): Promise<OperationPlan> {
  const type = input.target.kind
  const id = type === 'character' ? input.target.characterId : input.target.locationId
  const appearanceId = type === 'character' ? input.target.appearanceId : ''
  const count =
    type === 'character'
      ? normalizeImageGenerationCount('character', input.count)
      : normalizeImageGenerationCount('location', input.count)
  const targetType = type === 'character' ? 'CharacterAppearance' : 'LocationImage'
  const targetId = type === 'character' ? appearanceId : id
  if (!targetId) throw new ApiError('INVALID_PARAMS')

  let locationSummary: string | null = null
  let locationName: string | null = null
  if (type === 'location') {
    const location = await prisma.projectLocation.findUnique({
      where: { id },
      select: { name: true, summary: true },
    })
    if (!location) throw new ApiError('NOT_FOUND')
    locationName = location.name
    locationSummary = location.summary
  }
  const hasOutputAtStart =
    type === 'character'
      ? await hasCharacterAppearanceOutput({
          appearanceId,
          characterId: id,
        })
      : await hasLocationImageOutput({ locationId: id })
  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  const imageModel = type === 'character' ? projectModelConfig.characterModel : projectModelConfig.locationModel
  const operationPayload = {
    type,
    id,
    ...(appearanceId ? { appearanceId } : {}),
    count,
  }
  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel,
      basePayload: operationPayload,
      aspectRatio: type === 'character' ? CHARACTER_ASSET_IMAGE_RATIO : LOCATION_IMAGE_RATIO,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }
  const locale = resolveOperationLocale(ctx.context)
  const episodeId = normalizeString(ctx.context.episodeId) || null
  const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
    projectId: ctx.projectId,
    episodeId,
  })
  const payload = withTaskUiPayload(billingPayload, {
    intent: 'regenerate',
    hasOutputAtStart,
  })
  return {
    kind: 'task_submission',
    operationId: 'regenerate_group',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `regenerate-group:${targetType}:${targetId}`,
        taskType: TASK_TYPE.REGENERATE_GROUP,
        targetType,
        targetId,
        payload,
        billingInfo: requireImageBillingInfo(TASK_TYPE.REGENERATE_GROUP, billingPayload),
        locale,
        episodeId,
        dedupeKey: `regenerate_group:${targetType}:${targetId}:${count}:${styleBibleSignature}`,
      }),
    ],
    metadata: {
      type,
      locationId: id,
      count,
      locationDescription: locationSummary || locationName || '',
    },
  }
}

async function commitRegenerateGroupOperation(ctx: ProjectAgentOperationContext, plan: OperationPlan) {
  const transaction = requireOperationExecutionTransaction(ctx)
  const task = plan.tasks[0]
  if (!task) throw new Error('REGENERATE_GROUP_PLAN_EMPTY')
  if (plan.metadata?.type === 'location') {
    const locationId = typeof plan.metadata.locationId === 'string' ? plan.metadata.locationId : ''
    const count = typeof plan.metadata.count === 'number' ? plan.metadata.count : 0
    const fallbackDescription = typeof plan.metadata.locationDescription === 'string' ? plan.metadata.locationDescription : ''
    if (!locationId || count < 1 || !fallbackDescription) throw new Error('REGENERATE_GROUP_PLAN_METADATA_INVALID')
    await ensureProjectLocationImageSlots({ locationId, count, fallbackDescription }, transaction)
  }
  return await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'regenerate_group',
  })
}

async function planRegenerateSingleImageOperation(
  ctx: ProjectAgentOperationContext,
  input: {
    type: 'character' | 'location'
    id: string
    appearanceId?: string
    imageIndex: number | string
  } & Record<string, unknown>,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input)
  const parsedImageIndex = toNumberOrNull(input.imageIndex)
  if (parsedImageIndex === null) throw new ApiError('INVALID_PARAMS')
  const appearanceId = normalizeString(input.appearanceId)
  const taskType = input.type === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION
  const targetType = input.type === 'character' ? 'CharacterAppearance' : 'LocationImage'
  const targetId = input.type === 'character' ? appearanceId || input.id : input.id
  const hasOutputAtStart =
    input.type === 'character'
      ? await hasCharacterAppearanceOutput({
          appearanceId: targetId,
          characterId: input.id,
        })
      : await hasLocationImageOutput({
          locationId: input.id,
          imageIndex: parsedImageIndex,
        })
  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  const imageModel = input.type === 'character' ? projectModelConfig.characterModel : projectModelConfig.locationModel
  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel,
      basePayload: { ...input, imageIndex: parsedImageIndex },
      aspectRatio: input.type === 'character' ? CHARACTER_ASSET_IMAGE_RATIO : LOCATION_IMAGE_RATIO,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }
  const locale = resolveOperationLocale(ctx.context)
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId) || null
  const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({ projectId: ctx.projectId, episodeId })
  const payload = withTaskUiPayload(billingPayload, {
    intent: 'regenerate',
    hasOutputAtStart,
  })
  return {
    kind: 'task_submission',
    operationId: 'regenerate_single_image',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `regenerate-single:${taskType}:${targetId}:${String(parsedImageIndex)}`,
        taskType,
        targetType,
        targetId,
        payload,
        billingInfo: requireImageBillingInfo(taskType, billingPayload),
        locale,
        episodeId,
        dedupeKey: `${taskType}:${targetId}:single:${parsedImageIndex}:${styleBibleSignature}`,
      }),
    ],
  }
}

async function commitRegenerateSingleImageOperation(ctx: ProjectAgentOperationContext, plan: OperationPlan) {
  const task = plan.tasks[0]
  if (!task) throw new Error('REGENERATE_SINGLE_IMAGE_PLAN_EMPTY')
  return await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'regenerate_single_image',
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
        workspaceResourceImpact: 'none',
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
        summary: '将批量重生成图片并产生媒体费用；用户批准当前不可变计划后执行。',
      },
      inputSchema: regenerateGroupInputSchema,
      outputSchema: taskSubmitOperationOutputSchema,
      plan: planRegenerateGroupOperation,
      commit: async (ctx, _input, plan) => await commitRegenerateGroupOperation(ctx, plan),
    }),

    regenerate_single_image: defineOperation({
      id: 'regenerate_single_image',
      summary: 'Regenerate a single image by index for character/location (async task submission).',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将重生成单张图片并产生媒体费用；用户批准当前不可变计划后执行。',
      },
      inputSchema: z
        .object({
          type: z.enum(['character', 'location']),
          id: z.string().min(1),
          appearanceId: z.string().min(1).optional(),
          imageIndex: z.union([z.number().int().min(0).max(200), z.string().min(1)]),
        })
        .passthrough(),
      outputSchema: taskSubmitOperationOutputSchema,
      plan: planRegenerateSingleImageOperation,
      commit: async (ctx, _input, plan) => await commitRegenerateSingleImageOperation(ctx, plan),
    }),
  }
}
