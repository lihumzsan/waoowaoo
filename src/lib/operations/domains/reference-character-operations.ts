import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  buildImageBillingPayload,
  buildImageBillingPayloadFromUserConfig,
  getProjectModelConfig,
  getUserModelConfig,
} from '@/lib/config-service'
import { CHARACTER_IMAGE_BANANA_RATIO } from '@/lib/constants'
import { sanitizeImageInputsForTaskPayload } from '@/lib/media/outbound-image'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTask,
  type OperationPlan,
} from '@/lib/operations/planning'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { resolveOperationLocale } from '@/lib/operations/environment-input'

const referenceImagesSchema = z.array(z.string().min(1)).min(1).max(5)

export const referenceCharacterGenerationInputSchema = z.object({
  referenceImageUrls: referenceImagesSchema,
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('unattached'),
      characterName: z.string().trim().min(1).optional()
        .describe('Optional display name for the generated character concept.'),
    }).strict(),
    z.object({
      kind: z.literal('character'),
      characterId: z.string().trim().min(1).describe('Exact existing character ID.'),
      characterName: z.string().trim().min(1).optional(),
    }).strict(),
    z.object({
      kind: z.literal('appearance'),
      characterId: z.string().trim().min(1).describe('Exact existing character ID.'),
      appearanceId: z.string().trim().min(1).describe('Exact existing appearance ID.'),
      characterName: z.string().trim().min(1).optional(),
    }).strict(),
  ]).describe('Generate an unattached concept or target an existing character/appearance.'),
  count: z.number().int().positive().max(6).optional(),
  customDescription: z.string().min(1).optional(),
}).strict()

export const referenceCharacterExtractionInputSchema = z.object({
  referenceImageUrls: referenceImagesSchema,
}).strict()

export type ReferenceCharacterGenerationInput = z.infer<typeof referenceCharacterGenerationInputSchema>
export type ReferenceCharacterExtractionInput = z.infer<typeof referenceCharacterExtractionInputSchema>

type ReferenceScope = 'project' | 'asset_hub'

function normalizeReferenceImages(referenceImageUrls: readonly string[]): string[] {
  const audit = sanitizeImageInputsForTaskPayload([...referenceImageUrls])
  if (audit.normalized.length !== referenceImageUrls.length || audit.normalized.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'REFERENCE_IMAGES_INVALID',
      issues: audit.issues,
    })
  }
  return audit.normalized
}

function buildReferenceDedupeDigest(input: {
  targetId: string
  count: number
  referenceImageUrls: readonly string[]
  customDescription?: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24)
}

async function assertProjectTargetOwnership(params: {
  projectId: string
  characterId: string
  appearanceId: string
}): Promise<void> {
  if (!params.characterId && !params.appearanceId) return
  const appearance = params.appearanceId
    ? await prisma.characterAppearance.findFirst({
      where: {
        id: params.appearanceId,
        ...(params.characterId ? { characterId: params.characterId } : {}),
        character: { projectId: params.projectId },
      },
      select: { id: true, characterId: true },
    })
    : null
  const character = !params.appearanceId && params.characterId
    ? await prisma.projectCharacter.findFirst({
      where: { id: params.characterId, projectId: params.projectId },
      select: { id: true },
    })
    : null
  if ((params.appearanceId && !appearance) || (!params.appearanceId && params.characterId && !character)) {
    throw new ApiError('NOT_FOUND', { code: 'REFERENCE_CHARACTER_TARGET_NOT_FOUND' })
  }
}

async function assertAssetHubTargetOwnership(params: {
  userId: string
  characterId: string
  appearanceId: string
}): Promise<void> {
  if (!params.characterId && !params.appearanceId) return
  const appearance = params.appearanceId
    ? await prisma.globalCharacterAppearance.findFirst({
      where: {
        id: params.appearanceId,
        ...(params.characterId ? { characterId: params.characterId } : {}),
        character: { userId: params.userId },
      },
      select: { id: true, characterId: true },
    })
    : null
  const character = !params.appearanceId && params.characterId
    ? await prisma.globalCharacter.findFirst({
      where: { id: params.characterId, userId: params.userId },
      select: { id: true },
    })
    : null
  if ((params.appearanceId && !appearance) || (!params.appearanceId && params.characterId && !character)) {
    throw new ApiError('NOT_FOUND', { code: 'REFERENCE_CHARACTER_TARGET_NOT_FOUND' })
  }
}

export async function planReferenceCharacterGeneration(params: {
  ctx: ProjectAgentOperationContext
  input: ReferenceCharacterGenerationInput
  scope: ReferenceScope
  operationId: 'reference_to_character' | 'asset_hub_reference_to_character'
}): Promise<OperationPlan> {
  const referenceImageUrls = normalizeReferenceImages(params.input.referenceImageUrls)
  const count = normalizeImageGenerationCount('reference-to-character', params.input.count)
  const characterId = params.input.target.kind === 'unattached'
    ? ''
    : params.input.target.characterId
  const appearanceId = params.input.target.kind === 'appearance'
    ? params.input.target.appearanceId
    : ''
  const isBackgroundJob = params.input.target.kind === 'appearance'

  if (params.scope === 'project') {
    await assertProjectTargetOwnership({
      projectId: params.ctx.projectId,
      characterId,
      appearanceId,
    })
  } else {
    await assertAssetHubTargetOwnership({
      userId: params.ctx.userId,
      characterId,
      appearanceId,
    })
  }

  const basePayload: Record<string, unknown> = {
    referenceImageUrls,
    count,
    extractOnly: false,
    isBackgroundJob,
    ...(characterId ? { characterId } : {}),
    ...(appearanceId ? { appearanceId } : {}),
    ...(params.input.target.characterName
      ? { characterName: params.input.target.characterName.trim() }
      : {}),
    ...(params.input.customDescription ? { customDescription: params.input.customDescription.trim() } : {}),
    displayMode: 'detail',
  }
  let payload: Record<string, unknown>
  if (params.scope === 'project') {
    const config = await getProjectModelConfig(params.ctx.projectId, params.ctx.userId)
    if (!config.characterModel) throw new ApiError('MISSING_CONFIG')
    await resolveModelSelection(params.ctx.userId, config.characterModel, 'image')
    payload = await buildImageBillingPayload({
      projectId: params.ctx.projectId,
      userId: params.ctx.userId,
      imageModel: config.characterModel,
      basePayload,
      aspectRatio: CHARACTER_IMAGE_BANANA_RATIO,
    })
  } else {
    const config = await getUserModelConfig(params.ctx.userId)
    if (!config.characterModel) throw new ApiError('MISSING_CONFIG')
    await resolveModelSelection(params.ctx.userId, config.characterModel, 'image')
    payload = buildImageBillingPayloadFromUserConfig({
      userModelConfig: config,
      imageModel: config.characterModel,
      basePayload,
      aspectRatio: CHARACTER_IMAGE_BANANA_RATIO,
    })
  }

  const taskType = params.scope === 'project'
    ? TASK_TYPE.REFERENCE_TO_CHARACTER
    : TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER
  const targetType = appearanceId
    ? params.scope === 'project' ? 'CharacterAppearance' : 'GlobalCharacterAppearance'
    : params.scope === 'project' ? 'Project' : 'GlobalCharacter'
  const targetId = appearanceId || characterId || params.ctx.projectId
  const digest = buildReferenceDedupeDigest({
    targetId,
    count,
    referenceImageUrls,
    customDescription: params.input.customDescription,
  })
  const task = createPlannedTask({
    id: `${params.operationId}:${digest}`,
    taskType,
    targetType,
    targetId,
    payload,
    locale: resolveOperationLocale(params.ctx.context),
    dedupeKey: `${params.operationId}:${digest}`,
    billingInfo: requirePlannedTaskBillingInfo({
      taskType,
      payload,
      allowedApiTypes: ['image'],
    }),
  })
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [task],
    metadata: { scope: params.scope, targetType, targetId },
  }
}

export async function commitReferenceCharacterGeneration(params: {
  ctx: ProjectAgentOperationContext
  plan: OperationPlan
  operationId: 'reference_to_character' | 'asset_hub_reference_to_character'
}) {
  const task = params.plan.tasks[0]
  if (!task || params.plan.tasks.length !== 1) {
    throw new Error(`REFERENCE_CHARACTER_PLAN_TASK_INVALID:${params.operationId}`)
  }
  return await submitPlannedOperationTask({
    ctx: params.ctx,
    task,
    operationId: params.operationId,
  })
}

export async function submitReferenceCharacterExtraction(params: {
  ctx: ProjectAgentOperationContext
  input: ReferenceCharacterExtractionInput
  scope: ReferenceScope
  operationId: 'extract_reference_character_description' | 'asset_hub_extract_reference_character_description'
}) {
  const referenceImageUrls = normalizeReferenceImages(params.input.referenceImageUrls)
  const config = params.scope === 'project'
    ? await getProjectModelConfig(params.ctx.projectId, params.ctx.userId)
    : await getUserModelConfig(params.ctx.userId)
  if (!config.analysisModel) throw new ApiError('MISSING_CONFIG')
  const payload = {
    referenceImageUrls,
    extractOnly: true,
    analysisModel: config.analysisModel,
    displayMode: 'detail',
  }
  const taskType = params.scope === 'project'
    ? TASK_TYPE.REFERENCE_CHARACTER_DESCRIPTION_EXTRACT
    : TASK_TYPE.ASSET_HUB_REFERENCE_CHARACTER_DESCRIPTION_EXTRACT
  const digest = createHash('sha256')
    .update(JSON.stringify(referenceImageUrls))
    .digest('hex')
    .slice(0, 24)
  return await submitOperationTask({
    request: params.ctx.request,
    locale: resolveOperationLocale(params.ctx.context),
    userId: params.ctx.userId,
    projectId: params.ctx.projectId,
    type: taskType,
    targetType: params.scope === 'project' ? 'Project' : 'GlobalAssetHub',
    targetId: params.ctx.projectId,
    operationId: params.operationId,
    source: params.ctx.source,
    payload,
    dedupeKey: `${params.operationId}:${digest}`,
  })
}
