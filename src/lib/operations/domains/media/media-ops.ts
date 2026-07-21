import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { planAssetGenerateTask } from '@/lib/assets/services/asset-actions'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type { OperationPlan } from '@/lib/operations/planning'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { commitAssetImageOperation } from '@/lib/operations/domains/asset/generation/commit'
import {
  planCharacterImageGenerationOperation,
  planLocationImageGenerationOperation,
} from '@/lib/operations/domains/asset/generation/generate'
import { resolveLocaleFromContext } from '@/lib/operations/domains/asset/generation/shared'

const regenerateAssetInputSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('character'),
      assetId: z.string().trim().min(1),
      appearanceId: z.string().trim().min(1).optional(),
      appearanceIndex: z.number().int().min(0).max(20).optional(),
    }).strict(),
    z.object({
      kind: z.literal('location'),
      assetId: z.string().trim().min(1),
    }).strict(),
    z.object({
      kind: z.literal('prop'),
      assetId: z.string().trim().min(1),
    }).strict(),
  ]),
  count: z.number().int().positive().max(6).optional(),
  imageIndex: z.number().int().min(0).max(50).optional(),
}).strict()

type RegenerateAssetInput = z.infer<typeof regenerateAssetInputSchema>

async function freezeRegenerationWatermark(
  plan: OperationPlan,
  input: RegenerateAssetInput,
): Promise<OperationPlan> {
  const metadata = plan.metadata ?? {}
  const appearanceId = typeof metadata.appearanceId === 'string' ? metadata.appearanceId : null
  let watermark: string
  if (input.target.kind === 'character') {
    const currentVersion = await prisma.characterAppearance.findFirst({
      where: {
        ...(appearanceId ? { id: appearanceId } : {}),
        character: { id: input.target.assetId, projectId: plan.projectId },
      },
      select: { updatedAt: true },
    })
    if (!currentVersion) throw new Error('REGENERATE_ASSET_VERSION_NOT_FOUND')
    watermark = currentVersion.updatedAt.toISOString()
  } else {
    const currentVersion = await prisma.projectLocation.findFirst({
      where: {
        id: input.target.assetId,
        projectId: plan.projectId,
        assetKind: input.target.kind,
      },
      select: {
        updatedAt: true,
        images: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { updatedAt: true },
        },
      },
    })
    if (!currentVersion) throw new Error('REGENERATE_ASSET_VERSION_NOT_FOUND')
    watermark = (currentVersion.images[0]?.updatedAt ?? currentVersion.updatedAt).toISOString()
  }
  const requestScope = input.imageIndex === undefined ? `group:${String(input.count ?? 'default')}` : `image:${String(input.imageIndex)}`
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      ...task,
      dedupeKey: `regenerate_asset:${task.target.targetType}:${task.target.targetId}:${requestScope}:${watermark}`,
    })),
    metadata: {
      ...metadata,
      regenerationWatermark: watermark,
    },
  }
}

async function planPropRegeneration(
  ctx: ProjectAgentOperationContext,
  input: RegenerateAssetInput,
): Promise<OperationPlan> {
  if (input.target.kind !== 'prop') throw new Error('REGENERATE_PROP_TARGET_REQUIRED')
  const planned = await planAssetGenerateTask({
    request: ctx.request,
    kind: 'prop',
    assetId: input.target.assetId,
    body: {
      meta: { locale: resolveLocaleFromContext(ctx.context.locale) },
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.imageIndex !== undefined ? { imageIndex: input.imageIndex } : {}),
    },
    access: {
      scope: 'project',
      userId: ctx.userId,
      projectId: ctx.projectId,
    },
  })
  return {
    kind: 'task_submission',
    operationId: 'regenerate_asset',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId: input.target.assetId,
      assetKind: 'prop',
      appearanceId: null,
      mutationTargetType: 'ProjectLocation',
      mutationTargetId: input.target.assetId,
    },
  }
}

async function planRegenerateAssetOperation(
  ctx: ProjectAgentOperationContext,
  input: RegenerateAssetInput,
): Promise<OperationPlan> {
  if (input.target.kind === 'character') {
    const plan = await planCharacterImageGenerationOperation(ctx, {
      target: { kind: 'id', characterId: input.target.assetId },
      ...(input.target.appearanceId ? { appearanceId: input.target.appearanceId } : {}),
      ...(input.target.appearanceIndex !== undefined
        ? { appearanceIndex: input.target.appearanceIndex }
        : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.imageIndex !== undefined ? { imageIndex: input.imageIndex } : {}),
    })
    return await freezeRegenerationWatermark({ ...plan, operationId: 'regenerate_asset' }, input)
  }
  if (input.target.kind === 'location') {
    const plan = await planLocationImageGenerationOperation(ctx, {
      target: { kind: 'id', locationId: input.target.assetId },
      ...(input.count !== undefined ? { count: input.count } : {}),
      ...(input.imageIndex !== undefined ? { imageIndex: input.imageIndex } : {}),
    })
    return await freezeRegenerationWatermark({ ...plan, operationId: 'regenerate_asset' }, input)
  }
  return await freezeRegenerationWatermark(await planPropRegeneration(ctx, input), input)
}

export function createMediaOperations(): ProjectAgentOperationRegistryDraft {
  const outputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      mutationBatchId: z.string().min(1),
      assetId: z.string().min(1),
    }).passthrough(),
  )

  return {
    regenerate_asset: defineOperation({
      id: 'regenerate_asset',
      summary: 'Regenerate images in one exact existing character, location, or prop asset without creating a replacement asset.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将在原资产 identity 下重新生成图片并产生媒体费用，不会新增替代资产；用户批准当前不可变计划后执行。',
      },
      inputSchema: regenerateAssetInputSchema,
      outputSchema,
      plan: async (ctx, input) => await planRegenerateAssetOperation(ctx, input),
      commit: async (ctx, input, plan) => await commitAssetImageOperation({
        ctx,
        input,
        plan,
        operationId: 'regenerate_asset',
      }),
    }),
  }
}
