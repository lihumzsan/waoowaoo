import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { ensureAssetGenerateCommitReady, planAssetGenerateTask, planAssetModifyTask } from '@/lib/assets/services/asset-actions'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  assertOperationPlanConfirmedCost,
  resolveConfirmedMaxCostForExecution,
  submitPlannedOperationTask,
  type OperationPlan,
} from '@/lib/operations/planning'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveLocaleFromContext(locale?: unknown): string {
  const normalized = normalizeString(locale)
  return normalized || 'zh'
}

function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

const modifyCharacterImageInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  characterId: z.string().min(1),
}).passthrough()

const modifyLocationImageInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  locationId: z.string().min(1),
}).passthrough()

type ProjectAssetImageKind = 'character' | 'location'

type ProjectAssetImagePlanMetadata = {
  assetId: string
  assetKind: ProjectAssetImageKind
  appearanceId: string | null
  mutationTargetType: 'ProjectCharacter' | 'ProjectLocation'
  mutationTargetId: string
}

function omitOperationControls(input: Record<string, unknown>): Record<string, unknown> {
  const body = { ...input }
  delete body.confirmed
  delete body.confirmedMaxCost
  return body
}

function readProjectAssetImagePlanMetadata(plan: OperationPlan): ProjectAssetImagePlanMetadata {
  const metadata = plan.metadata ?? {}
  const assetId = normalizeString(metadata.assetId)
  const assetKind = metadata.assetKind
  const mutationTargetType = metadata.mutationTargetType
  const mutationTargetId = normalizeString(metadata.mutationTargetId)
  if (
    !assetId
    || (assetKind !== 'character' && assetKind !== 'location')
    || (mutationTargetType !== 'ProjectCharacter' && mutationTargetType !== 'ProjectLocation')
    || !mutationTargetId
  ) {
    throw new Error('PROJECT_AGENT_ASSET_IMAGE_PLAN_METADATA_INVALID')
  }
  return {
    assetId,
    assetKind,
    mutationTargetType,
    mutationTargetId,
    appearanceId: normalizeString(metadata.appearanceId) || null,
  }
}

async function planAssetImageModificationOperation(params: {
  ctx: ProjectAgentOperationContext
  input: Record<string, unknown>
  operationId: string
  kind: ProjectAssetImageKind
}): Promise<OperationPlan> {
  const assetId = params.kind === 'character'
    ? normalizeString(params.input.characterId)
    : normalizeString(params.input.locationId)

  if (!assetId) {
    throw new Error('PROJECT_AGENT_ASSET_ID_REQUIRED')
  }

  const body: Record<string, unknown> = {
    ...omitOperationControls(params.input),
    ...(params.kind === 'character' ? { characterId: assetId } : { locationId: assetId }),
  }

  const planned = await planAssetModifyTask({
    request: params.ctx.request,
    kind: params.kind,
    assetId,
    body,
    access: {
      scope: 'project',
      userId: params.ctx.userId,
      projectId: params.ctx.projectId,
    },
  })

  const appearanceId = params.kind === 'character' ? normalizeString(body.appearanceId) : ''
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId,
      assetKind: params.kind,
      appearanceId: appearanceId || null,
      mutationTargetType: params.kind === 'character' ? 'ProjectCharacter' : 'ProjectLocation',
      mutationTargetId: assetId,
    },
  }
}

async function commitAssetImageOperation(params: {
  ctx: ProjectAgentOperationContext
  input: { confirmed?: boolean }
  plan: OperationPlan
  operationId: string
}) {
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const metadata = readProjectAssetImagePlanMetadata(params.plan)
  if (params.operationId === 'generate_character_image' || params.operationId === 'generate_location_image') {
    await ensureAssetGenerateCommitReady({
      request: params.ctx.request,
      kind: metadata.assetKind,
      assetId: metadata.assetId,
      body: task.payload,
      access: {
        scope: 'project',
        userId: params.ctx.userId,
        projectId: params.ctx.projectId,
      },
    })
  }
  const result = await submitPlannedOperationTask({
    ctx: params.ctx,
    task,
    operationId: params.operationId,
    confirmed: params.input.confirmed === true,
  })

  const mutationBatch = await createMutationBatch({
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    source: params.ctx.source,
    operationId: params.operationId,
    episodeId: null,
    summary: `${params.operationId}:${metadata.assetId}`,
    entries: [
      {
        kind: 'asset_render_revert',
        targetType: metadata.mutationTargetType,
        targetId: metadata.mutationTargetId,
        payload: {
          kind: metadata.assetKind,
          assetId: metadata.assetId,
          ...(metadata.appearanceId ? { appearanceId: metadata.appearanceId } : {}),
        },
      },
    ],
  })

  writeOperationDataPart<TaskSubmittedPartData>(params.ctx.writer, 'data-task-submitted', {
    operationId: params.operationId,
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    mutationBatchId: mutationBatch.id,
    projectId: params.ctx.projectId,
    episodeId: null,
    taskType: task.taskType,
    targetType: metadata.mutationTargetType,
    targetId: metadata.mutationTargetId,
  })

  return {
    ...result,
    assetId: metadata.assetId,
    characterId: metadata.assetKind === 'character' ? metadata.assetId : '',
    locationId: metadata.assetKind === 'location' ? metadata.assetId : '',
    appearanceId: metadata.appearanceId,
    taskType: task.taskType,
    targetType: metadata.mutationTargetType,
    targetId: metadata.mutationTargetId,
    mutationBatchId: mutationBatch.id,
  }
}

async function planCharacterImageGenerationOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<ReturnType<typeof buildGenerateCharacterImageInputSchema>>,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input as unknown as Record<string, unknown>)
  const locale = resolveLocaleFromContext(ctx.context.locale)

  let characterId = normalizeString(input.characterId)
  const characterName = normalizeString(input.characterName)
  if (!characterId) {
    const exact = await prisma.projectCharacter.findFirst({
      where: {
        projectId: ctx.projectId,
        name: characterName,
      },
      select: { id: true },
    })
    if (exact) {
      characterId = exact.id
    } else {
      const fuzzy = await prisma.projectCharacter.findFirst({
        where: {
          projectId: ctx.projectId,
          name: {
            contains: characterName,
          },
        },
        select: { id: true },
      })
      if (fuzzy) {
        characterId = fuzzy.id
      }
    }
  }
  if (!characterId) {
    throw new Error('PROJECT_AGENT_CHARACTER_NOT_FOUND')
  }

  let appearanceId = normalizeString(input.appearanceId)
  if (!appearanceId) {
    const appearance = await prisma.characterAppearance.findFirst({
      where: { characterId },
      orderBy: { appearanceIndex: 'asc' },
      select: { id: true },
    })
    appearanceId = appearance?.id || ''
  }

  const body: Record<string, unknown> = {
    meta: {
      locale,
    },
    ...(appearanceId ? { appearanceId } : {}),
    ...(typeof input.appearanceIndex === 'number' ? { appearanceIndex: input.appearanceIndex } : {}),
    ...(typeof input.count === 'number' ? { count: input.count } : {}),
    ...(typeof input.imageIndex === 'number' ? { imageIndex: input.imageIndex } : {}),
  }

  const planned = await planAssetGenerateTask({
    request: ctx.request,
    kind: 'character',
    assetId: characterId,
    body,
    access: {
      scope: 'project',
      userId: ctx.userId,
      projectId: ctx.projectId,
    },
  })

  return {
    kind: 'task_submission',
    operationId: 'generate_character_image',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId: characterId,
      assetKind: 'character',
      appearanceId: appearanceId || null,
      mutationTargetType: 'ProjectCharacter',
      mutationTargetId: characterId,
    },
  }
}

async function planLocationImageGenerationOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<ReturnType<typeof buildGenerateLocationImageInputSchema>>,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input as unknown as Record<string, unknown>)
  const locale = resolveLocaleFromContext(ctx.context.locale)

  let locationId = normalizeString(input.locationId)
  const locationName = normalizeString(input.locationName)
  if (!locationId) {
    const exact = await prisma.projectLocation.findFirst({
      where: {
        projectId: ctx.projectId,
        name: locationName,
      },
      select: { id: true },
    })
    if (exact) {
      locationId = exact.id
    } else {
      const fuzzy = await prisma.projectLocation.findFirst({
        where: {
          projectId: ctx.projectId,
          name: {
            contains: locationName,
          },
        },
        select: { id: true },
      })
      if (fuzzy) {
        locationId = fuzzy.id
      }
    }
  }
  if (!locationId) {
    throw new Error('PROJECT_AGENT_LOCATION_NOT_FOUND')
  }

  const body: Record<string, unknown> = {
    meta: {
      locale,
    },
    ...(typeof input.count === 'number' ? { count: input.count } : {}),
    ...(typeof input.imageIndex === 'number' ? { imageIndex: input.imageIndex } : {}),
  }

  const planned = await planAssetGenerateTask({
    request: ctx.request,
    kind: 'location',
    assetId: locationId,
    body,
    access: {
      scope: 'project',
      userId: ctx.userId,
      projectId: ctx.projectId,
    },
  })

  return {
    kind: 'task_submission',
    operationId: 'generate_location_image',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId: locationId,
      assetKind: 'location',
      appearanceId: null,
      mutationTargetType: 'ProjectLocation',
      mutationTargetId: locationId,
    },
  }
}

function buildGenerateCharacterImageInputSchema() {
  return z.object({
    confirmed: z.boolean().optional(),
    confirmedMaxCost: z.number().nonnegative().optional(),
    characterId: z.string().min(1).optional(),
    characterName: z.string().min(1).optional(),
    appearanceId: z.string().min(1).optional(),
    appearanceIndex: z.number().int().min(0).max(20).optional(),
    count: z.number().int().positive().max(6).optional(),
    imageIndex: z.number().int().min(0).max(20).optional(),
  }).refine((value) => Boolean(value.characterId || value.characterName), {
    message: 'characterId or characterName is required',
    path: ['characterId'],
  })
}

function buildGenerateLocationImageInputSchema() {
  return z.object({
    confirmed: z.boolean().optional(),
    confirmedMaxCost: z.number().nonnegative().optional(),
    locationId: z.string().min(1).optional(),
    locationName: z.string().min(1).optional(),
    count: z.number().int().positive().max(6).optional(),
    imageIndex: z.number().int().min(0).max(50).optional(),
  }).refine((value) => Boolean(value.locationId || value.locationName), {
    message: 'locationId or locationName is required',
    path: ['locationId'],
  })
}

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
