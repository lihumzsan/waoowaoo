import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { ApiError, getRequestId } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import {
  getProjectModelConfig,
  getUserModelConfig,
  buildImageBillingPayload,
  buildImageBillingPayloadFromUserConfig,
} from '@/lib/config-service'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { ensureGlobalLocationImageSlots, ensureProjectLocationImageSlots } from '@/lib/image-generation/location-slots'
import { CHARACTER_CANDIDATE_PROMPT_COUNT } from '@/lib/asset-generation/character-candidate-prompts'
import { LOCATION_CANDIDATE_PROMPT_COUNT } from '@/lib/asset-generation/location-candidate-prompts'
import {
  hasCharacterAppearanceOutput,
  hasGlobalCharacterAppearanceOutput,
  hasGlobalLocationImageOutput,
  hasGlobalLocationOutput,
  hasLocationImageOutput,
} from '@/lib/task/has-output'
import { sanitizeImageInputsForTaskPayload } from '@/lib/media/outbound-image'
import {
  CHARACTER_ASSET_IMAGE_RATIO,
  LOCATION_IMAGE_RATIO,
  PRIMARY_APPEARANCE_INDEX,
  PROP_IMAGE_RATIO,
  removeLocationPromptSuffix,
  removePropPromptSuffix,
} from '@/lib/constants'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import type { AssetKind } from '@/lib/assets/contracts'
import { createPlannedTask, requirePlannedTaskBillingInfo, type PlannedTask } from '@/lib/operations/planning'
import {
  createGlobalLocationBackedAsset,
  createProjectLocationBackedAsset,
  deleteGlobalLocationBackedAsset,
  deleteProjectLocationBackedAsset,
  type LocationBackedAssetKind,
} from '@/lib/assets/services/location-backed-assets'
import { resolvePropVisualDescription } from '@/lib/assets/prop-description'
import { confirmProjectLocationBackedSelection } from '@/lib/assets/services/project-location-backed-selection'
import { deleteCreativeResourceBindingSlotInTransaction } from '@/lib/creative-resource/binding-service'
import { CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE } from '@/lib/creative-resource/contracts'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  requireAssetBodyVariantOwnership,
  requireAssetProjectId,
  requireOwnedAssetProject,
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
  type AssetOwnershipClient,
  type AssetWriteAccess,
} from '@/lib/assets/services/asset-scope-ownership'

type AssetActionTarget = {
  kind: Extract<AssetKind, 'character' | 'location' | 'prop'>
  assetId: string
}

export type AssetGenerateInput = AssetActionTarget & {
  request: NextRequest
  body: Record<string, unknown>
  access: AssetWriteAccess
  episodeId?: string | null
}

type PlannedAssetTask = {
  userId: string
  projectId: string
  task: PlannedTask
}

type AssetModifyInput = AssetActionTarget & {
  request: NextRequest
  body: Record<string, unknown>
  access: AssetWriteAccess
}

type AssetSelectInput = AssetActionTarget & {
  body: Record<string, unknown>
  access: AssetWriteAccess
}

type AssetRevertInput = AssetActionTarget & {
  body: Record<string, unknown>
  access: AssetWriteAccess
}

type AssetCopyInput = {
  kind: AssetKind
  targetId: string
  globalAssetId: string
  access: {
    userId: string
    projectId: string
  }
}

type AssetUpdateInput = {
  kind: AssetKind
  assetId: string
  body: Record<string, unknown>
  access: AssetWriteAccess
}

type AssetVariantUpdateInput = {
  kind: Extract<AssetKind, 'character' | 'location' | 'prop'>
  assetId: string
  variantId: string
  body: Record<string, unknown>
  access: AssetWriteAccess
}

type AssetCreateInput = {
  kind: Extract<AssetKind, 'location' | 'prop'>
  body: Record<string, unknown>
  access: AssetWriteAccess
}

type AssetRemoveInput = {
  kind: Extract<AssetKind, 'character' | 'location' | 'prop'>
  assetId: string
  access: AssetWriteAccess
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function assertNoLegacyArtStyle(body: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(body, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

function resolveGroupedCharacterGenerateCount(value: unknown): number {
  const normalized = normalizeImageGenerationCount('character', value, CHARACTER_CANDIDATE_PROMPT_COUNT)
  return normalized === 1 ? 1 : CHARACTER_CANDIDATE_PROMPT_COUNT
}

function resolveGroupedLocationGenerateCount(value: unknown): number {
  return normalizeImageGenerationCount('location', value, LOCATION_CANDIDATE_PROMPT_COUNT)
}

function normalizeLocationBackedKind(kind: AssetKind): 'character' | 'location' {
  return kind === 'character' ? 'character' : 'location'
}

function resolveAssetGenerationAspectRatio(kind: AssetKind): string {
  if (kind === 'character') return CHARACTER_ASSET_IMAGE_RATIO
  if (kind === 'prop') return PROP_IMAGE_RATIO
  return LOCATION_IMAGE_RATIO
}

function resolveAssetModifyAspectRatio(kind: AssetKind): string {
  if (kind === 'character') return CHARACTER_ASSET_IMAGE_RATIO
  if (kind === 'prop') return PROP_IMAGE_RATIO
  if (kind === 'location') return LOCATION_IMAGE_RATIO
  return CHARACTER_ASSET_IMAGE_RATIO
}

function requireLocationBackedKind(kind: AssetKind): LocationBackedAssetKind {
  if (kind !== 'location' && kind !== 'prop') {
    throw new ApiError('INVALID_PARAMS')
  }
  return kind
}

async function submitAssetPlannedTask(input: PlannedAssetTask, request: NextRequest) {
  return await submitTask({
    userId: input.userId,
    locale: input.task.locale,
    requestId: getRequestId(request),
    projectId: input.projectId,
    episodeId: input.task.episodeId ?? null,
    type: input.task.taskType,
    targetType: input.task.target.targetType,
    targetId: input.task.target.targetId,
    payload: input.task.payload,
    dedupeKey: input.task.dedupeKey ?? null,
    priority: input.task.priority,
    billingInfo: input.task.billingInfo,
    billingInfoSource: 'planned',
  })
}

export async function planAssetGenerateTask(input: AssetGenerateInput): Promise<PlannedAssetTask> {
  await requireAssetBodyVariantOwnership(input)
  return input.access.scope === 'global' ? planGlobalAssetGenerateTask(input) : planProjectAssetGenerateTask(input)
}

export async function submitAssetGenerateTask(input: AssetGenerateInput) {
  const planned = await planAssetGenerateTask(input)
  await ensureAssetGenerateCommitReady(input)
  return await submitAssetPlannedTask(planned, input.request)
}

export async function ensureAssetGenerateCommitReady(
  input: AssetGenerateInput,
  client: AssetOwnershipClient = prisma,
): Promise<void> {
  await requireAssetBodyVariantOwnership(input, client)
  const normalizedKind = normalizeLocationBackedKind(input.kind)
  if (normalizedKind !== 'location') return

  const imageIndex = toNumber(input.body.imageIndex)
  if (imageIndex !== null) return

  const count = resolveGroupedLocationGenerateCount(input.body.count)
  if (input.access.scope === 'global') {
    const location = await client.globalLocation.findFirst({
      where: { id: input.assetId, userId: input.access.userId },
      select: {
        name: true,
        summary: true,
        assetKind: true,
        images: {
          orderBy: { imageIndex: 'asc' },
          take: 1,
          select: { description: true },
        },
      },
    })
    if (!location) {
      throw new ApiError('NOT_FOUND')
    }
    await ensureGlobalLocationImageSlots(
      {
        locationId: input.assetId,
        count,
        fallbackDescription:
          location.assetKind === 'prop'
            ? resolvePropVisualDescription({
                name: location.name,
                summary: location.summary,
                description: location.images[0]?.description ?? null,
              })
            : location.summary || location.name,
      },
      client,
    )
    return
  }

  const projectId = requireAssetProjectId(input.access)
  const location = await client.projectLocation.findFirst({
    where: {
      id: input.assetId,
      projectId,
    },
    select: {
      name: true,
      summary: true,
      assetKind: true,
      images: {
        orderBy: { imageIndex: 'asc' },
        take: 1,
        select: { description: true },
      },
    },
  })
  if (!location) {
    throw new ApiError('NOT_FOUND')
  }
  await ensureProjectLocationImageSlots(
    {
      locationId: input.assetId,
      count,
      fallbackDescription:
        location.assetKind === 'prop'
          ? resolvePropVisualDescription({
              name: location.name,
              summary: location.summary,
              description: location.images[0]?.description ?? null,
            })
          : location.summary || location.name,
    },
    client,
  )
}

async function planGlobalAssetGenerateTask(input: AssetGenerateInput): Promise<PlannedAssetTask> {
  assertNoLegacyArtStyle(input.body)
  const locale = resolveRequiredTaskLocale(input.request, input.body)
  const appearanceIndex = toNumber(input.body.appearanceIndex) ?? PRIMARY_APPEARANCE_INDEX
  const normalizedKind = normalizeLocationBackedKind(input.kind)
  const imageIndex = toNumber(input.body.imageIndex)
  const count =
    normalizedKind === 'character'
      ? imageIndex === null
        ? resolveGroupedCharacterGenerateCount(input.body.count)
        : normalizeImageGenerationCount('character', input.body.count)
      : imageIndex === null
        ? resolveGroupedLocationGenerateCount(input.body.count)
        : normalizeImageGenerationCount('location', input.body.count)
  let characterAppearanceId: string | null = null
  if (normalizedKind === 'character') {
    const requestedAppearanceId = normalizeString(input.body.appearanceId)
    const appearance = requestedAppearanceId
      ? await prisma.globalCharacterAppearance.findFirst({
          where: {
            id: requestedAppearanceId,
            character: {
              id: input.assetId,
              userId: input.access.userId,
            },
          },
          select: { id: true },
        })
      : await prisma.globalCharacterAppearance.findFirst({
          where: {
            characterId: input.assetId,
            appearanceIndex,
            character: {
              userId: input.access.userId,
            },
          },
          select: { id: true },
        })
    if (!appearance) {
      throw new ApiError('NOT_FOUND')
    }
    characterAppearanceId = appearance.id
  }

  const payloadBase: Record<string, unknown> =
    normalizedKind === 'character'
      ? {
          ...input.body,
          id: input.assetId,
          type: input.kind,
          appearanceId: characterAppearanceId,
          appearanceIndex,
          count,
        }
      : { ...input.body, id: input.assetId, type: input.kind, count }
  const targetType = normalizedKind === 'character' ? 'GlobalCharacterAppearance' : 'GlobalLocation'
  const targetId = normalizedKind === 'character' ? characterAppearanceId : input.assetId
  if (!targetId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const hasOutputAtStart =
    normalizedKind === 'character'
      ? await hasGlobalCharacterAppearanceOutput({
          targetId,
          characterId: input.assetId,
          appearanceIndex,
        })
      : await hasGlobalLocationOutput({
          locationId: input.assetId,
        })

  const userModelConfig = await getUserModelConfig(input.access.userId)
  const imageModel = input.kind === 'character' ? userModelConfig.characterModel : userModelConfig.locationModel

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = buildImageBillingPayloadFromUserConfig({
      userModelConfig,
      imageModel,
      basePayload: payloadBase,
      aspectRatio: resolveAssetGenerationAspectRatio(input.kind),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }

  const projectId = 'global-asset-hub'
  return {
    userId: input.access.userId,
    projectId,
    task: createPlannedTask({
      id: `${TASK_TYPE.ASSET_HUB_IMAGE}:${targetType}:${targetId}`,
      taskType: TASK_TYPE.ASSET_HUB_IMAGE,
      targetType,
      targetId,
      payload: withTaskUiPayload(billingPayload, { hasOutputAtStart }),
      locale,
      episodeId: input.episodeId ?? null,
      dedupeKey: `${TASK_TYPE.ASSET_HUB_IMAGE}:${targetType}:${targetId}:${normalizedKind === 'character' ? appearanceIndex : 'na'}:${imageIndex === null ? count : `single:${imageIndex}`}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.ASSET_HUB_IMAGE,
        payload: billingPayload,
        allowedApiTypes: ['image'],
      }),
    }),
  }
}

async function planProjectAssetGenerateTask(input: AssetGenerateInput): Promise<PlannedAssetTask> {
  assertNoLegacyArtStyle(input.body)
  const projectId = requireAssetProjectId(input.access)
  const locale = resolveRequiredTaskLocale(input.request, input.body)
  const normalizedKind = normalizeLocationBackedKind(input.kind)
  const appearanceId = normalizeString(input.body.appearanceId)
  const imageIndex = toNumber(input.body.imageIndex)
  const count =
    normalizedKind === 'character'
      ? imageIndex === null
        ? resolveGroupedCharacterGenerateCount(input.body.count)
        : normalizeImageGenerationCount('character', input.body.count)
      : imageIndex === null
        ? resolveGroupedLocationGenerateCount(input.body.count)
        : normalizeImageGenerationCount('location', input.body.count)

  const taskType = normalizedKind === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION
  const targetType = normalizedKind === 'character' ? 'CharacterAppearance' : 'LocationImage'
  const targetId = normalizedKind === 'character' ? appearanceId || input.assetId : input.assetId
  if (!targetId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const hasOutputAtStart =
    normalizedKind === 'character'
      ? await hasCharacterAppearanceOutput({
          appearanceId: targetId,
          characterId: input.assetId,
          appearanceIndex: toNumber(input.body.appearanceIndex),
        })
      : await hasLocationImageOutput({
          locationId: input.assetId,
          imageIndex,
        })

  const projectModelConfig = await getProjectModelConfig(projectId, input.access.userId)
  const imageModel = normalizedKind === 'character' ? projectModelConfig.characterModel : projectModelConfig.locationModel
  const payloadBase = {
    ...input.body,
    type: input.kind,
    id: input.assetId,
    count,
  }
  const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
    projectId,
    episodeId: input.episodeId ?? null,
  })

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: input.access.userId,
      imageModel,
      basePayload: payloadBase,
      aspectRatio: resolveAssetGenerationAspectRatio(input.kind),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }

  return {
    userId: input.access.userId,
    projectId,
    task: createPlannedTask({
      id: `${taskType}:${targetType}:${targetId}`,
      taskType,
      targetType,
      targetId,
      payload: withTaskUiPayload(billingPayload, { hasOutputAtStart }),
      locale,
      episodeId: input.episodeId ?? null,
      dedupeKey: `${taskType}:${targetId}:${imageIndex === null ? count : `single:${imageIndex}`}:${styleBibleSignature}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType,
        payload: billingPayload,
        allowedApiTypes: ['image'],
      }),
    }),
  }
}

export async function submitAssetModifyTask(input: AssetModifyInput) {
  const planned = await planAssetModifyTask(input)
  return await submitAssetPlannedTask(planned, input.request)
}

export async function planAssetModifyTask(input: AssetModifyInput): Promise<PlannedAssetTask> {
  await requireAssetBodyVariantOwnership(input)
  return input.access.scope === 'global' ? planGlobalAssetModifyTask(input) : planProjectAssetModifyTask(input)
}

async function planGlobalAssetModifyTask(input: AssetModifyInput): Promise<PlannedAssetTask> {
  const locale = resolveRequiredTaskLocale(input.request, input.body)
  const modifyPrompt = normalizeString(input.body.modifyPrompt)
  if (!modifyPrompt) {
    throw new ApiError('INVALID_PARAMS')
  }
  const normalizedKind = normalizeLocationBackedKind(input.kind)
  const appearanceIndex = toNumber(input.body.appearanceIndex) ?? PRIMARY_APPEARANCE_INDEX
  const imageIndex = toNumber(input.body.imageIndex) ?? 0
  const extraImageAudit = sanitizeImageInputsForTaskPayload(Array.isArray(input.body.extraImageUrls) ? input.body.extraImageUrls : [])
  if (extraImageAudit.issues.some((issue) => issue.reason === 'relative_path_rejected')) {
    throw new ApiError('INVALID_PARAMS')
  }
  const targetType = normalizedKind === 'character' ? 'GlobalCharacterAppearance' : 'GlobalLocationImage'
  const targetId = normalizedKind === 'character' ? `${input.assetId}:${appearanceIndex}:${imageIndex}` : `${input.assetId}:${imageIndex}`
  const hasOutputAtStart =
    normalizedKind === 'character'
      ? await hasGlobalCharacterAppearanceOutput({
          targetId,
          characterId: input.assetId,
          appearanceIndex,
          imageIndex,
        })
      : await hasGlobalLocationImageOutput({
          targetId,
          locationId: input.assetId,
          imageIndex,
        })
  const payload = {
    ...input.body,
    id: input.assetId,
    type: input.kind,
    extraImageUrls: extraImageAudit.normalized,
    meta: {
      ...toObject(input.body.meta),
      outboundImageInputAudit: {
        extraImageUrls: extraImageAudit.issues,
      },
    },
  }
  const userModelConfig = await getUserModelConfig(input.access.userId)
  const imageModel = userModelConfig.editModel
  let billingPayload: Record<string, unknown>
  try {
    billingPayload = buildImageBillingPayloadFromUserConfig({
      userModelConfig,
      imageModel,
      basePayload: payload,
      aspectRatio: resolveAssetModifyAspectRatio(input.kind),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }
  const projectId = 'global-asset-hub'
  return {
    userId: input.access.userId,
    projectId,
    task: createPlannedTask({
      id: `${TASK_TYPE.ASSET_HUB_MODIFY}:${targetId}`,
      taskType: TASK_TYPE.ASSET_HUB_MODIFY,
      targetType,
      targetId,
      payload: withTaskUiPayload(billingPayload, {
        intent: 'modify',
        hasOutputAtStart,
      }),
      locale,
      dedupeKey: `${TASK_TYPE.ASSET_HUB_MODIFY}:${targetId}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.ASSET_HUB_MODIFY,
        payload: billingPayload,
        allowedApiTypes: ['image'],
      }),
    }),
  }
}

async function planProjectAssetModifyTask(input: AssetModifyInput): Promise<PlannedAssetTask> {
  const projectId = requireAssetProjectId(input.access)
  const locale = resolveRequiredTaskLocale(input.request, input.body)
  const modifyPrompt = normalizeString(input.body.modifyPrompt)
  if (!modifyPrompt) {
    throw new ApiError('INVALID_PARAMS')
  }
  const normalizedKind = normalizeLocationBackedKind(input.kind)
  const targetType = normalizedKind === 'character' ? 'CharacterAppearance' : 'LocationImage'
  const targetId =
    normalizedKind === 'character'
      ? normalizeString(input.body.appearanceId) || input.assetId
      : normalizeString(input.body.locationImageId) || input.assetId
  if (!targetId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const hasOutputAtStart =
    normalizedKind === 'character'
      ? await hasCharacterAppearanceOutput({
          appearanceId: normalizeString(input.body.appearanceId) || null,
          characterId: input.assetId,
          appearanceIndex: toNumber(input.body.appearanceIndex),
        })
      : await hasLocationImageOutput({
          imageId: normalizeString(input.body.locationImageId) || null,
          locationId: input.assetId,
          imageIndex: toNumber(input.body.imageIndex),
        })
  const extraImageAudit = sanitizeImageInputsForTaskPayload(Array.isArray(input.body.extraImageUrls) ? input.body.extraImageUrls : [])
  if (extraImageAudit.issues.some((issue) => issue.reason === 'relative_path_rejected')) {
    throw new ApiError('INVALID_PARAMS')
  }
  const payload = {
    ...input.body,
    type: input.kind,
    characterId: normalizedKind === 'character' ? input.assetId : undefined,
    locationId: normalizedKind === 'location' ? input.assetId : undefined,
    extraImageUrls: extraImageAudit.normalized,
    meta: {
      ...toObject(input.body.meta),
      outboundImageInputAudit: {
        extraImageUrls: extraImageAudit.issues,
      },
    },
  }
  const projectModelConfig = await getProjectModelConfig(projectId, input.access.userId)
  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: input.access.userId,
      imageModel: projectModelConfig.editModel,
      basePayload: payload,
      aspectRatio: resolveAssetModifyAspectRatio(input.kind),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }
  return {
    userId: input.access.userId,
    projectId,
    task: createPlannedTask({
      id: `${TASK_TYPE.MODIFY_ASSET_IMAGE}:${targetType}:${targetId}`,
      taskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
      targetType,
      targetId,
      payload: withTaskUiPayload(billingPayload, {
        intent: 'modify',
        hasOutputAtStart,
      }),
      locale,
      dedupeKey: `modify_asset_image:${targetType}:${targetId}:${input.body.imageIndex ?? 'na'}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
        payload: billingPayload,
        allowedApiTypes: ['image'],
      }),
    }),
  }
}

export async function selectAssetRender(
  input: AssetSelectInput,
  client: Prisma.TransactionClient,
) {
  await requireAssetBodyVariantOwnership(input, client)
  return input.access.scope === 'global'
    ? selectGlobalAssetRender(input, client)
    : selectProjectAssetRender(input, client)
}

async function selectGlobalAssetRender(
  input: AssetSelectInput,
  client: Prisma.TransactionClient | typeof prisma,
) {
  if (input.kind === 'character') {
    const appearanceIndex = toNumber(input.body.appearanceIndex) ?? PRIMARY_APPEARANCE_INDEX
    const imageIndex = toNumber(input.body.imageIndex)
    const confirm = input.body.confirm === true
    const appearance = await client.globalCharacterAppearance.findFirst({
      where: {
        characterId: input.assetId,
        appearanceIndex,
        character: { userId: input.access.userId },
      },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    if (confirm && appearance.selectedIndex !== null) {
      const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'globalCharacterAppearance.imageUrls')
      const selectedUrl = imageUrls[appearance.selectedIndex]
      if (!selectedUrl) throw new ApiError('NOT_FOUND')
      let descriptions: string[] = []
      if (appearance.descriptions) {
        try {
          descriptions = JSON.parse(appearance.descriptions) as string[]
        } catch {
          descriptions = []
        }
      }
      const selectedDescription = descriptions[appearance.selectedIndex] || appearance.description || ''
      await client.globalCharacterAppearance.update({
        where: { id: appearance.id },
        data: {
          imageUrl: selectedUrl,
          imageUrls: encodeImageUrls([selectedUrl]),
          selectedIndex: 0,
          description: selectedDescription,
          descriptions: JSON.stringify([selectedDescription]),
        },
      })
    } else {
      await client.globalCharacterAppearance.update({
        where: { id: appearance.id },
        data: { selectedIndex: imageIndex },
      })
    }
    return { success: true }
  }

  const imageIndex = toNumber(input.body.imageIndex)
  const confirm = input.body.confirm === true
  const location = await client.globalLocation.findFirst({
    where: { id: input.assetId, userId: input.access.userId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) throw new ApiError('NOT_FOUND')
  const images = location.images
  const selectedImg = images.find((image) => image.isSelected)
  const confirmIndex = imageIndex ?? selectedImg?.imageIndex
  if (confirm && confirmIndex !== null && confirmIndex !== undefined) {
    const targetImage = images.find((image) => image.imageIndex === confirmIndex)
    if (!targetImage) throw new ApiError('NOT_FOUND')
    await client.globalLocationImage.deleteMany({
        where: { locationId: input.assetId, id: { not: targetImage.id } },
    })
    await client.globalLocationImage.update({
        where: { id: targetImage.id },
        data: { imageIndex: 0, isSelected: true },
    })
  } else {
    await client.globalLocationImage.updateMany({
      where: { locationId: input.assetId },
      data: { isSelected: false },
    })
    if (imageIndex !== null) {
      const targetImage = images.find((image) => image.imageIndex === imageIndex)
      if (targetImage) {
        await client.globalLocationImage.update({
          where: { id: targetImage.id },
          data: { isSelected: true },
        })
      }
    }
  }
  return { success: true }
}

async function selectProjectAssetRender(
  input: AssetSelectInput,
  client: Prisma.TransactionClient | typeof prisma,
) {
  if (input.kind === 'character') {
    const appearanceId = normalizeString(input.body.appearanceId) || normalizeString(input.body.variantId)
    const selectedIndex = toNumber(input.body.selectedIndex ?? input.body.imageIndex)
    if (!appearanceId) throw new ApiError('INVALID_PARAMS')
    const appearance = await client.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    if (selectedIndex !== null && (selectedIndex < 0 || selectedIndex >= imageUrls.length || !imageUrls[selectedIndex])) {
      throw new ApiError('INVALID_PARAMS')
    }
    const selectedImageKey = selectedIndex !== null ? imageUrls[selectedIndex] : null
    await client.characterAppearance.update({
      where: { id: appearance.id },
      data: { selectedIndex, imageUrl: selectedImageKey },
    })
    return { success: true }
  }
  const selectedIndex = toNumber(input.body.selectedIndex ?? input.body.imageIndex)
  const confirm = input.body.confirm === true
  if (confirm) {
    return confirmProjectLocationBackedSelection(input.assetId, selectedIndex, client)
  }
  const location = await client.projectLocation.findUnique({
    where: { id: input.assetId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) throw new ApiError('NOT_FOUND')

  if (selectedIndex !== null) {
    const targetImage = location.images.find((image) => image.imageIndex === selectedIndex)
    if (!targetImage || !targetImage.imageUrl) {
      throw new ApiError('INVALID_PARAMS')
    }
  }
  await client.locationImage.updateMany({
    where: { locationId: input.assetId },
    data: { isSelected: false },
  })
  if (selectedIndex !== null) {
    const updated = await client.locationImage.update({
      where: {
        locationId_imageIndex: {
          locationId: input.assetId,
          imageIndex: selectedIndex,
        },
      },
      data: { isSelected: true },
    })
    await client.projectLocation.update({
      where: { id: input.assetId },
      data: { selectedImageId: updated.id },
    })
  } else {
    await client.projectLocation.update({
      where: { id: input.assetId },
      data: { selectedImageId: null },
    })
  }
  return { success: true }
}

export async function revertAssetRender(
  input: AssetRevertInput,
  client: Prisma.TransactionClient,
) {
  await requireAssetBodyVariantOwnership(input, client)
  return input.access.scope === 'global'
    ? revertGlobalAssetRender(input, client)
    : revertProjectAssetRender(input, client)
}

async function revertGlobalAssetRender(
  input: AssetRevertInput,
  client: Prisma.TransactionClient | typeof prisma,
) {
  if (input.kind === 'character') {
    const appearanceIndex = toNumber(input.body.appearanceIndex) ?? PRIMARY_APPEARANCE_INDEX
    const appearance = await client.globalCharacterAppearance.findFirst({
      where: {
        characterId: input.assetId,
        appearanceIndex,
        character: { userId: input.access.userId },
      },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const previousImageUrls = decodeImageUrlsFromDb(appearance.previousImageUrls, 'globalCharacterAppearance.previousImageUrls')
    if (!appearance.previousImageUrl && previousImageUrls.length === 0) throw new ApiError('INVALID_PARAMS')
    const restoredImageUrls =
      previousImageUrls.length > 0 ? previousImageUrls : appearance.previousImageUrl ? [appearance.previousImageUrl] : []
    await client.globalCharacterAppearance.update({
      where: { id: appearance.id },
      data: {
        imageUrl: appearance.previousImageUrl || restoredImageUrls[0] || null,
        imageUrls: encodeImageUrls(restoredImageUrls),
        previousImageUrl: null,
        previousImageUrls: encodeImageUrls([]),
        selectedIndex: null,
        description: appearance.previousDescription ?? appearance.description,
        descriptions: appearance.previousDescriptions ?? appearance.descriptions,
        previousDescription: null,
        previousDescriptions: null,
      },
    })
    return { success: true }
  }
  const location = await client.globalLocation.findFirst({
    where: { id: input.assetId, userId: input.access.userId },
    include: { images: true },
  })
  if (!location) throw new ApiError('NOT_FOUND')
  for (const image of location.images) {
    if (image.previousImageUrl) {
      await client.globalLocationImage.update({
        where: { id: image.id },
        data: {
          imageUrl: image.previousImageUrl,
          previousImageUrl: null,
          description: image.previousDescription ?? image.description,
          previousDescription: null,
        },
      })
    }
  }
  return { success: true }
}

async function revertProjectAssetRender(
  input: AssetRevertInput,
  client: Prisma.TransactionClient | typeof prisma,
) {
  if (input.kind === 'character') {
    const appearanceId = normalizeString(input.body.appearanceId) || normalizeString(input.body.variantId)
    if (!appearanceId) throw new ApiError('INVALID_PARAMS')
    const appearance = await client.characterAppearance.findUnique({
      where: { id: appearanceId },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const previousImageUrls = decodeImageUrlsFromDb(appearance.previousImageUrls, 'characterAppearance.previousImageUrls')
    if (!appearance.previousImageUrl && previousImageUrls.length === 0) throw new ApiError('INVALID_PARAMS')
    const restoredImageUrls =
      previousImageUrls.length > 0 ? previousImageUrls : appearance.previousImageUrl ? [appearance.previousImageUrl] : []
    await client.characterAppearance.update({
      where: { id: appearance.id },
      data: {
        imageUrl: appearance.previousImageUrl || restoredImageUrls[0] || null,
        imageUrls: encodeImageUrls(restoredImageUrls),
        previousImageUrl: null,
        previousImageUrls: encodeImageUrls([]),
        selectedIndex: null,
        description: appearance.previousDescription ?? appearance.description,
        descriptions: appearance.previousDescriptions ?? appearance.descriptions,
        previousDescription: null,
        previousDescriptions: null,
      },
    })
    return { success: true }
  }
  const location = await client.projectLocation.findUnique({
    where: { id: input.assetId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) throw new ApiError('NOT_FOUND')
  for (const image of location.images) {
    if (image.previousImageUrl) {
      await client.locationImage.update({
        where: { id: image.id },
        data: {
          imageUrl: image.previousImageUrl,
          previousImageUrl: null,
          description: image.previousDescription ?? image.description,
          previousDescription: null,
        },
      })
    }
  }
  return { success: true }
}

export async function copyAssetFromGlobal(
  input: AssetCopyInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  await requireOwnedAssetTarget({
    access: { scope: 'global', userId: input.access.userId },
    kind: input.kind,
    assetId: input.globalAssetId,
  }, client)
  await requireOwnedAssetTarget({
    access: {
      scope: 'project',
      userId: input.access.userId,
      projectId: input.access.projectId,
    },
    kind: input.kind,
    assetId: input.targetId,
  }, client)
  if (input.kind === 'character') {
    return copyCharacterFromGlobal(input, client)
  }
  if (input.kind === 'location' || input.kind === 'prop') {
    return copyLocationFromGlobal(input, client)
  }
  throw new ApiError('INVALID_PARAMS')
}

async function copyCharacterFromGlobal(
  input: AssetCopyInput,
  client: Prisma.TransactionClient | typeof prisma,
) {
  const globalCharacter = await client.globalCharacter.findFirst({
    where: { id: input.globalAssetId, userId: input.access.userId },
    include: { appearances: true },
  })
  if (!globalCharacter) throw new ApiError('NOT_FOUND')
  const projectCharacter = await client.projectCharacter.findUnique({
    where: { id: input.targetId },
    include: { appearances: true },
  })
  if (!projectCharacter) throw new ApiError('NOT_FOUND')
  if (projectCharacter.appearances.length > 0) {
    await client.characterAppearance.deleteMany({
      where: { characterId: input.targetId },
    })
  }
  for (let index = 0; index < globalCharacter.appearances.length; index += 1) {
    const appearance = globalCharacter.appearances[index]
    const originalImageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'globalCharacterAppearance.imageUrls')
    const mainImageUrl = appearance.imageUrl || originalImageUrls.find((url) => !!url) || null
    await client.characterAppearance.create({
      data: {
        characterId: input.targetId,
        appearanceIndex: appearance.appearanceIndex,
        changeReason: appearance.changeReason,
        description: appearance.description,
        descriptions: appearance.descriptions,
        imageUrl: mainImageUrl,
        imageUrls: encodeImageUrls(originalImageUrls),
        previousImageUrls: encodeImageUrls([]),
        selectedIndex: appearance.selectedIndex,
      },
    })
  }
  const character = await client.projectCharacter.update({
    where: { id: input.targetId },
    data: {
      sourceGlobalCharacterId: input.globalAssetId,
      profileConfirmed: true,
    },
    include: { appearances: true },
  })
  return { success: true, character }
}

async function copyLocationFromGlobal(
  input: AssetCopyInput,
  client: Prisma.TransactionClient | typeof prisma,
) {
  const globalLocation = await client.globalLocation.findFirst({
    where: { id: input.globalAssetId, userId: input.access.userId },
    include: { images: true },
  })
  if (!globalLocation) throw new ApiError('NOT_FOUND')
  const projectLocation = await client.projectLocation.findUnique({
    where: { id: input.targetId },
    include: { images: true },
  })
  if (!projectLocation) throw new ApiError('NOT_FOUND')
  if (projectLocation.images.length > 0) {
    await client.locationImage.deleteMany({
      where: { locationId: input.targetId },
    })
  }
  const copiedImages: Array<{
    id: string
    imageIndex: number
    imageUrl: string | null
  }> = []
  for (let index = 0; index < globalLocation.images.length; index += 1) {
    const image = globalLocation.images[index]
    const created = await client.locationImage.create({
      data: {
        locationId: input.targetId,
        imageIndex: image.imageIndex,
        description: image.description,
        imageUrl: image.imageUrl,
        isSelected: image.isSelected,
      },
    })
    copiedImages.push(created)
  }
  const selectedFromGlobal = globalLocation.images.find((image) => image.isSelected)
  const selectedImageId = selectedFromGlobal
    ? copiedImages.find((image) => image.imageIndex === selectedFromGlobal.imageIndex)?.id
    : copiedImages.find((image) => image.imageUrl)?.id || null
  const location = await client.projectLocation.update({
    where: { id: input.targetId },
    data: {
      sourceGlobalLocationId: input.globalAssetId,
      summary: globalLocation.summary,
      selectedImageId,
    },
    include: { images: true },
  })
  return { success: true, location }
}

export async function updateAsset(input: AssetUpdateInput, transaction: Prisma.TransactionClient) {
  await requireOwnedAssetTarget(input, transaction)
  if (input.access.scope === 'global') {
    return updateGlobalAsset(input, transaction)
  }
  return updateProjectAsset(input, transaction)
}

async function updateGlobalAsset(input: AssetUpdateInput, transaction: Prisma.TransactionClient) {
  if (input.kind === 'character') {
    const updateData: Record<string, unknown> = {}
    if (input.body.name !== undefined) updateData.name = normalizeString(input.body.name)
    if (input.body.aliases !== undefined) updateData.aliases = input.body.aliases
    if (input.body.profileData !== undefined) updateData.profileData = input.body.profileData
    if (input.body.profileConfirmed !== undefined) updateData.profileConfirmed = input.body.profileConfirmed
    if (input.body.folderId !== undefined) updateData.folderId = normalizeString(input.body.folderId) || null
    const character = await transaction.globalCharacter.update({
      where: { id: input.assetId },
      data: updateData,
    })
    return { success: true, character }
  }
  if (input.kind === 'location') {
    const updateData: Record<string, unknown> = {}
    if (input.body.name !== undefined) updateData.name = normalizeString(input.body.name)
    if (input.body.summary !== undefined) updateData.summary = normalizeString(input.body.summary) || null
    if (input.body.folderId !== undefined) updateData.folderId = normalizeString(input.body.folderId) || null
    const location = await transaction.globalLocation.update({
      where: { id: input.assetId },
      data: updateData,
    })
    return { success: true, location }
  }
  if (input.kind === 'prop') {
    const updateData: Record<string, unknown> = {}
    if (input.body.name !== undefined) updateData.name = normalizeString(input.body.name)
    if (input.body.summary !== undefined) updateData.summary = normalizeString(input.body.summary) || null
    if (input.body.folderId !== undefined) updateData.folderId = normalizeString(input.body.folderId) || null
    const prop = await transaction.globalLocation.update({
      where: { id: input.assetId },
      data: updateData,
    })
    return { success: true, prop }
  }
  throw new ApiError('INVALID_PARAMS')
}

async function updateProjectAsset(input: AssetUpdateInput, transaction: Prisma.TransactionClient) {
  if (input.kind === 'character') {
    const updateData: Record<string, unknown> = {}
    if (input.body.name !== undefined) updateData.name = normalizeString(input.body.name)
    if (input.body.introduction !== undefined) updateData.introduction = normalizeString(input.body.introduction)
    if (input.body.profileConfirmed !== undefined) updateData.profileConfirmed = input.body.profileConfirmed
    const character = await transaction.projectCharacter.update({
      where: { id: input.assetId },
      data: updateData,
    })
    return { success: true, character }
  }
  if (input.kind === 'location') {
    const updateData: Record<string, unknown> = {}
    if (input.body.name !== undefined) updateData.name = normalizeString(input.body.name)
    if (input.body.summary !== undefined) updateData.summary = normalizeString(input.body.summary) || null
    const location = await transaction.projectLocation.update({
      where: { id: input.assetId },
      data: updateData,
    })
    return { success: true, location }
  }
  if (input.kind === 'prop') {
    const updateData: Record<string, unknown> = {}
    if (input.body.name !== undefined) updateData.name = normalizeString(input.body.name)
    if (input.body.summary !== undefined) updateData.summary = normalizeString(input.body.summary) || null
    const prop = await transaction.projectLocation.update({
      where: { id: input.assetId },
      data: updateData,
    })
    return { success: true, prop }
  }
  throw new ApiError('INVALID_PARAMS')
}

export async function updateAssetVariant(input: AssetVariantUpdateInput, transaction: Prisma.TransactionClient) {
  await requireOwnedAssetVariant(input, transaction)
  if (input.access.scope === 'global') {
    return updateGlobalAssetVariant(input, transaction)
  }
  return updateProjectAssetVariant(input, transaction)
}

async function updateGlobalAssetVariant(input: AssetVariantUpdateInput, transaction: Prisma.TransactionClient) {
  assertNoLegacyArtStyle(input.body)
  if (input.kind === 'character') {
    const appearance = await transaction.globalCharacterAppearance.findUnique({
      where: { id: input.variantId },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const updateData: Record<string, unknown> = {}
    if (input.body.description !== undefined) {
      const trimmedDescription = normalizeString(input.body.description)
      let descriptions: string[] = []
      if (appearance.descriptions) {
        try {
          descriptions = JSON.parse(appearance.descriptions) as string[]
        } catch {
          descriptions = []
        }
      }
      if (descriptions.length === 0) descriptions = [appearance.description || '']
      const descriptionIndex = toNumber(input.body.descriptionIndex)
      if (descriptionIndex !== null) descriptions[descriptionIndex] = trimmedDescription
      else descriptions[0] = trimmedDescription
      updateData.descriptions = JSON.stringify(descriptions)
      updateData.description = descriptions[0]
    }
    if (input.body.changeReason !== undefined) updateData.changeReason = normalizeString(input.body.changeReason)
    await transaction.globalCharacterAppearance.update({
      where: { id: input.variantId },
      data: updateData,
    })
    return { success: true }
  }
  if (input.kind === 'prop') {
    const trimmedDescription = normalizeString(input.body.description)
    if (!trimmedDescription) throw new ApiError('INVALID_PARAMS')
    const cleanDescription = removePropPromptSuffix(trimmedDescription)
    const image = await transaction.globalLocationImage.update({
      where: { id: input.variantId },
      data: { description: cleanDescription },
    })
    return { success: true, image }
  }
  throw new ApiError('INVALID_PARAMS')
}

async function updateProjectAssetVariant(input: AssetVariantUpdateInput, transaction: Prisma.TransactionClient) {
  if (input.kind === 'character') {
    const appearance = await transaction.characterAppearance.findUnique({
      where: { id: input.variantId },
    })
    if (!appearance) throw new ApiError('NOT_FOUND')
    const trimmedDescription = normalizeString(input.body.description)
    if (!trimmedDescription) throw new ApiError('INVALID_PARAMS')
    let descriptions: string[] = []
    try {
      descriptions = appearance.descriptions ? (JSON.parse(appearance.descriptions) as string[]) : []
    } catch {
      descriptions = []
    }
    const descriptionIndex = toNumber(input.body.descriptionIndex) ?? 0
    if (descriptionIndex >= 0 && descriptionIndex < descriptions.length) descriptions[descriptionIndex] = trimmedDescription
    else descriptions.push(trimmedDescription)
    await transaction.characterAppearance.update({
      where: { id: input.variantId },
      data: {
        description: trimmedDescription,
        descriptions: JSON.stringify(descriptions),
      },
    })
    return { success: true }
  }
  if (input.kind === 'prop') {
    const trimmedDescription = normalizeString(input.body.description)
    if (!trimmedDescription) throw new ApiError('INVALID_PARAMS')
    const cleanDescription = removePropPromptSuffix(trimmedDescription)
    const image = await transaction.locationImage.update({
      where: { id: input.variantId },
      data: { description: cleanDescription },
    })
    return { success: true, image }
  }
  const trimmedDescription = normalizeString(input.body.description)
  if (!trimmedDescription) throw new ApiError('INVALID_PARAMS')
  const cleanDescription = removeLocationPromptSuffix(trimmedDescription)
  const image = await transaction.locationImage.update({
    where: { id: input.variantId },
    data: { description: cleanDescription },
  })
  return { success: true, image }
}

export async function createAsset(input: AssetCreateInput, transaction: Prisma.TransactionClient) {
  assertNoLegacyArtStyle(input.body)
  const name = normalizeString(input.body.name)
  const kind = requireLocationBackedKind(input.kind)
  const summary = normalizeString(input.body.summary || input.body.description)
  const description = kind === 'prop' ? normalizeString(input.body.description) : summary
  if (!name || !summary || !description) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (input.access.scope === 'global') {
    const created = await createGlobalLocationBackedAsset({
      userId: input.access.userId,
      folderId: normalizeString(input.body.folderId) || null,
      name,
      summary,
      initialDescription: description,
      kind,
    }, transaction)
    return { success: true, assetId: created.id }
  }

  const created = await createProjectLocationBackedAsset({
    projectId: await requireOwnedAssetProject(input.access, transaction),
    name,
    summary,
    initialDescription: description,
    kind,
  }, transaction)
  return { success: true, assetId: created.id }
}

export async function removeAsset(input: AssetRemoveInput, transaction: Prisma.TransactionClient) {
  await requireOwnedAssetTarget(input, transaction)
  if (input.kind === 'character') {
    if (input.access.scope === 'global') {
      await transaction.globalCharacter.delete({ where: { id: input.assetId } })
      return { success: true }
    }
    await deleteCreativeResourceBindingSlotInTransaction(transaction, {
      scope: resolveProjectCreativeResourceScope({
        userId: input.access.userId,
        projectId: requireAssetProjectId(input.access),
        episodeId: null,
      }),
      role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
      slotKey: input.assetId,
    })
    await transaction.projectCharacter.delete({ where: { id: input.assetId } })
    return { success: true }
  }
  requireLocationBackedKind(input.kind)
  if (input.access.scope === 'global') {
    await deleteGlobalLocationBackedAsset(input.assetId, transaction)
    return { success: true }
  }
  await deleteProjectLocationBackedAsset(input.assetId, transaction)
  return { success: true }
}
