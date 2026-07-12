import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { planAssetGenerateTask } from '@/lib/assets/services/asset-actions'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { encodeImageUrls, decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible'
import type { Locale } from '@/i18n/routing'
import { submitPlannedOperationTasks, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { getPersistedEditScriptForRevision, mapPersistedEditScriptForRevision } from './asset-revision-persistence'
import { readProjectEditScripts } from './service'
import type { EditAssetKind, EditScriptAssetGenerationPayload, EditScriptAssetGenerationTask, EditScriptPayload } from './types'

export interface EditScriptAssetGenerationOperationInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly userId: string
  readonly locale: Locale
  readonly editScriptId?: string
  readonly requirementId?: string
}

type ExistingAsset = {
  readonly assetId: string
  readonly targetType: 'CharacterAppearance' | 'LocationImage'
  readonly targetId: string
  readonly hasOutput: boolean
}

type PlannedRequirement = {
  readonly requirementId: string
  readonly editScriptId: string
  readonly kind: EditAssetKind
  readonly name: string
  readonly description: string
  readonly previousStatus: string
  readonly previousTargetId: string | null
  readonly previousErrorMessage: string | null
  readonly assetId: string
  readonly targetType: 'CharacterAppearance' | 'LocationImage'
  readonly targetId: string
  readonly createAsset: boolean
  readonly hasOutput: boolean
  readonly taskPlanId: string | null
}

type EditScriptAssetPlanMetadata = {
  readonly projectId: string
  readonly episodeId: string
  readonly scriptIds: readonly string[]
  readonly representativeScriptId: string
  readonly representativeChapterId: string
  readonly requirements: readonly PlannedRequirement[]
}

function isEditAssetKind(value: string): value is EditAssetKind {
  return value === 'character' || value === 'location'
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:${label}`)
  }
  return value
}

function invalidPlanMetadata(label: string): never {
  throw new Error(`EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:${label}`)
}

function readPlanMetadata(plan: OperationPlan): EditScriptAssetPlanMetadata {
  const value = plan.metadata
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:root')
  }
  const scriptIds = Array.isArray(value.scriptIds)
    ? value.scriptIds.map((item, index) => assertString(item, `scriptIds.${String(index)}`))
    : []
  if (scriptIds.length === 0 || !Array.isArray(value.requirements)) {
    throw new Error('EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:collections')
  }
  const requirements = value.requirements.map((item, index): PlannedRequirement => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:requirements.${String(index)}`)
    }
    const record = item as Record<string, unknown>
    const kind = assertString(record.kind, `requirements.${String(index)}.kind`)
    const targetType = assertString(record.targetType, `requirements.${String(index)}.targetType`)
    if (!isEditAssetKind(kind)) {
      throw new Error(`EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:requirements.${String(index)}.kind`)
    }
    if (targetType !== 'CharacterAppearance' && targetType !== 'LocationImage') {
      throw new Error(`EDIT_SCRIPT_ASSET_PLAN_METADATA_INVALID:requirements.${String(index)}.targetType`)
    }
    return {
      requirementId: assertString(record.requirementId, `requirements.${String(index)}.requirementId`),
      editScriptId: assertString(record.editScriptId, `requirements.${String(index)}.editScriptId`),
      kind,
      name: assertString(record.name, `requirements.${String(index)}.name`),
      description: assertString(record.description, `requirements.${String(index)}.description`),
      previousStatus: assertString(record.previousStatus, `requirements.${String(index)}.previousStatus`),
      previousTargetId:
        record.previousTargetId === null ? null : assertString(record.previousTargetId, `requirements.${String(index)}.previousTargetId`),
      previousErrorMessage:
        record.previousErrorMessage === null
          ? null
          : assertString(record.previousErrorMessage, `requirements.${String(index)}.previousErrorMessage`),
      assetId: assertString(record.assetId, `requirements.${String(index)}.assetId`),
      targetType,
      targetId: assertString(record.targetId, `requirements.${String(index)}.targetId`),
      createAsset:
        typeof record.createAsset === 'boolean' ? record.createAsset : invalidPlanMetadata(`requirements.${String(index)}.createAsset`),
      hasOutput: typeof record.hasOutput === 'boolean' ? record.hasOutput : invalidPlanMetadata(`requirements.${String(index)}.hasOutput`),
      taskPlanId: record.taskPlanId === null ? null : assertString(record.taskPlanId, `requirements.${String(index)}.taskPlanId`),
    }
  })
  return {
    projectId: assertString(value.projectId, 'projectId'),
    episodeId: assertString(value.episodeId, 'episodeId'),
    scriptIds,
    representativeScriptId: assertString(value.representativeScriptId, 'representativeScriptId'),
    representativeChapterId: assertString(value.representativeChapterId, 'representativeChapterId'),
    requirements,
  }
}

async function loadExistingAssets(projectId: string): Promise<Map<string, ExistingAsset>> {
  const [characters, locations] = await Promise.all([
    prisma.projectCharacter.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: {
            id: true,
            imageUrl: true,
            imageMediaId: true,
            imageUrls: true,
          },
        },
      },
    }),
    prisma.projectLocation.findMany({
      where: { projectId, assetKind: 'location' },
      select: {
        id: true,
        name: true,
        images: {
          orderBy: { imageIndex: 'asc' },
          take: 1,
          select: { imageUrl: true, imageMediaId: true },
        },
      },
    }),
  ])
  const out = new Map<string, ExistingAsset>()
  for (const character of characters) {
    const appearance = character.appearances[0]
    if (!appearance) continue
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'editScript.assetPlan.character.imageUrls')
    out.set(`character:${normalizedName(character.name)}`, {
      assetId: character.id,
      targetType: 'CharacterAppearance',
      targetId: appearance.id,
      hasOutput: Boolean(appearance.imageMediaId || appearance.imageUrl || imageUrls[0]),
    })
    out.set(`character-id:${character.id}`, out.get(`character:${normalizedName(character.name)}`)!)
  }
  for (const location of locations) {
    const image = location.images[0]
    out.set(`location:${normalizedName(location.name)}`, {
      assetId: location.id,
      targetType: 'LocationImage',
      targetId: location.id,
      hasOutput: Boolean(image?.imageMediaId || image?.imageUrl),
    })
    out.set(`location-id:${location.id}`, out.get(`location:${normalizedName(location.name)}`)!)
  }
  return out
}

function selectScripts(params: { scripts: readonly EditScriptPayload[]; editScriptId?: string; chapterId?: string }): EditScriptPayload[] {
  return params.scripts.filter((script) => {
    if (params.editScriptId && script.id !== params.editScriptId) return false
    if (params.chapterId && script.chapterId !== params.chapterId) return false
    return true
  })
}

export async function planProjectEditScriptAssetsOperation(
  ctx: ProjectAgentOperationContext,
  input: Omit<EditScriptAssetGenerationOperationInput, 'request' | 'projectId' | 'userId' | 'locale'>,
): Promise<OperationPlan> {
  const [episodeBible, episodeChapters, episodeScriptRows, allScripts, existingAssets] = await Promise.all([
    readEpisodeEditBible({
      projectId: ctx.projectId,
      episodeId: input.episodeId,
    }),
    readEpisodeEditChapters({
      projectId: ctx.projectId,
      episodeId: input.episodeId,
    }),
    prisma.projectEditScript.findMany({
      where: { projectId: ctx.projectId, episodeId: input.episodeId },
      select: { chapterId: true, status: true },
    }),
    readProjectEditScripts({
      projectId: ctx.projectId,
      episodeId: input.episodeId,
    }),
    loadExistingAssets(ctx.projectId),
  ])
  const hasConfirmedStyle =
    episodeBible?.stylePreviews.some(
      (preview) => preview.status === 'confirmed' && typeof preview.imageUrl === 'string' && preview.imageUrl.trim().length > 0,
    ) === true
  if (!hasConfirmedStyle) {
    throw new Error(`EDIT_FIRST_MEDIA_STYLE_CONTEXT_REQUIRED:${input.episodeId}`)
  }
  const readyChapterIds = new Set(
    episodeScriptRows.filter((script) => script.status === 'ready' || script.status === 'completed').map((script) => script.chapterId),
  )
  const notReadyChapterIds = episodeChapters.map((chapter) => chapter.id).filter((chapterId) => !readyChapterIds.has(chapterId))
  if (episodeChapters.length === 0 || notReadyChapterIds.length > 0) {
    throw new Error(`EDIT_SCRIPT_ASSET_EPISODE_GATE_NOT_READY:${notReadyChapterIds.join(',') || 'no-chapters'}`)
  }

  const scopedScripts = selectScripts({
    scripts: allScripts,
    ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  })
  if (scopedScripts.length === 0) throw new ApiError('NOT_FOUND')
  const scripts = input.requirementId
    ? scopedScripts.filter((script) => script.requirements.some((requirement) => requirement.id === input.requirementId))
    : scopedScripts
  if (scripts.length === 0) throw new ApiError('NOT_FOUND')
  const selectedRequirements = scripts.flatMap((script) =>
    script.requirements
      .filter((requirement) => !input.requirementId || requirement.id === input.requirementId)
      .map((requirement) => ({ script, requirement })),
  )
  if (input.requirementId && selectedRequirements.length === 0) throw new ApiError('NOT_FOUND')

  for (const { requirement } of selectedRequirements) {
    if (!requirement.id || !isEditAssetKind(requirement.kind)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EDIT_SCRIPT_ASSET_REQUIREMENT_UNSUPPORTED',
        requirementId: requirement.id ?? null,
        kind: requirement.kind,
      })
    }
  }

  const reservedAssets = new Map<string, ExistingAsset & { readonly createAsset: boolean }>()
  const tasksByAssetKey = new Map<string, PlannedTask>()
  const plannedRequirements: PlannedRequirement[] = []
  for (const { script, requirement } of selectedRequirements) {
    if (!script.id || !requirement.id || !isEditAssetKind(requirement.kind)) {
      throw new Error('EDIT_SCRIPT_ASSET_REQUIREMENT_IDENTITY_REQUIRED')
    }
    const assetKey = `${requirement.kind}:${normalizedName(requirement.name)}`
    let asset = reservedAssets.get(assetKey)
    if (!asset) {
      const existing = requirement.targetId
        ? existingAssets.get(`${requirement.kind}-id:${requirement.targetId}`)
        : existingAssets.get(assetKey)
      asset = existing
        ? { ...existing, createAsset: false }
        : requirement.kind === 'character'
          ? {
              assetId: randomUUID(),
              targetType: 'CharacterAppearance',
              targetId: randomUUID(),
              hasOutput: false,
              createAsset: true,
            }
          : (() => {
              const assetId = randomUUID()
              return {
                assetId,
                targetType: 'LocationImage',
                targetId: assetId,
                hasOutput: false,
                createAsset: true,
              }
            })()
      reservedAssets.set(assetKey, asset)
    }

    let task = tasksByAssetKey.get(assetKey) ?? null
    if (!asset.hasOutput && !task) {
      const planned = await planAssetGenerateTask({
        request: ctx.request,
        kind: requirement.kind,
        assetId: asset.assetId,
        episodeId: input.episodeId,
        body: {
          count: 1,
          ...(requirement.kind === 'character'
            ? {
                appearanceId: asset.targetId,
                appearanceIndex: PRIMARY_APPEARANCE_INDEX,
              }
            : { imageIndex: 0 }),
          meta: { locale: ctx.context.locale },
        },
        access: {
          scope: 'project',
          userId: ctx.userId,
          projectId: ctx.projectId,
        },
      })
      task = planned.task
      tasksByAssetKey.set(assetKey, task)
    }

    plannedRequirements.push({
      requirementId: requirement.id,
      editScriptId: script.id,
      kind: requirement.kind,
      name: requirement.name,
      description: requirement.description,
      previousStatus: requirement.status ?? invalidPlanMetadata(`requirement.${requirement.id}.status`),
      previousTargetId: requirement.targetId ?? null,
      previousErrorMessage: requirement.errorMessage ?? null,
      assetId: asset.assetId,
      targetType: asset.targetType,
      targetId: asset.targetId,
      createAsset: asset.createAsset,
      hasOutput: asset.hasOutput,
      taskPlanId: task?.id ?? null,
    })
  }

  const representative = scripts[0]
  if (!representative?.id || !representative.chapterId) {
    throw new Error('EDIT_SCRIPT_ASSET_PLAN_REPRESENTATIVE_REQUIRED')
  }
  return {
    kind: 'task_submission',
    operationId: 'generate_edit_script_assets',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [...tasksByAssetKey.values()],
    reservedIdentityIds: [...new Set(plannedRequirements.flatMap((requirement) => (
      requirement.createAsset ? [requirement.assetId, requirement.targetId] : []
    )))],
    metadata: {
      projectId: ctx.projectId,
      episodeId: input.episodeId,
      scriptIds: scripts.map((script) => script.id).filter((id): id is string => typeof id === 'string'),
      representativeScriptId: representative.id,
      representativeChapterId: representative.chapterId,
      requirements: plannedRequirements,
    },
  }
}

async function applyPlanWrites(
  tx: import('@prisma/client').Prisma.TransactionClient,
  metadata: EditScriptAssetPlanMetadata,
): Promise<void> {
  const createdKeys = new Set<string>()
  const current = await tx.projectEditAssetRequirement.findMany({
    where: {
      id: { in: metadata.requirements.map((item) => item.requirementId) },
    },
    select: { id: true, status: true, targetId: true, errorMessage: true },
  })
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of metadata.requirements) {
    const actual = byId.get(item.requirementId)
    if (
      !actual ||
      actual.status !== item.previousStatus ||
      actual.targetId !== item.previousTargetId ||
      actual.errorMessage !== item.previousErrorMessage
    ) {
      const expected = JSON.stringify({
        status: item.previousStatus,
        targetId: item.previousTargetId,
        errorMessage: item.previousErrorMessage,
      })
      const observed = JSON.stringify(actual ?? null)
      throw new ApiError('CONFLICT', {
        code: 'OPERATION_PLAN_STALE',
        message: `OPERATION_PLAN_STALE:${item.requirementId}:expected=${expected}:observed=${observed}`,
        operationId: 'generate_edit_script_assets',
        requirementId: item.requirementId,
      })
    }
  }
  for (const item of metadata.requirements) {
    const assetKey = `${item.kind}:${item.assetId}`
    if (item.createAsset && !createdKeys.has(assetKey)) {
      if (item.kind === 'character') {
        await tx.projectCharacter.create({
          data: {
            id: item.assetId,
            projectId: metadata.projectId,
            name: item.name,
            aliases: null,
            appearances: {
              create: {
                id: item.targetId,
                appearanceIndex: PRIMARY_APPEARANCE_INDEX,
                changeReason: 'primary',
                description: item.description,
                descriptions: JSON.stringify([item.description]),
                imageUrls: encodeImageUrls([]),
                previousImageUrls: encodeImageUrls([]),
              },
            },
          },
        })
      } else {
        await tx.projectLocation.create({
          data: {
            id: item.assetId,
            projectId: metadata.projectId,
            name: item.name,
            summary: item.description,
            assetKind: 'location',
            images: {
              create: {
                imageIndex: 0,
                description: item.description,
              },
            },
          },
        })
      }
      createdKeys.add(assetKey)
    }
    await tx.projectEditAssetRequirement.update({
      where: { id: item.requirementId },
      data: {
        targetId: item.assetId,
        status: item.hasOutput ? 'completed' : 'generating',
        errorMessage: null,
      },
    })
  }
}

export async function commitProjectEditScriptAssetsOperation(params: {
  ctx: ProjectAgentOperationContext
  input: Record<string, unknown>
  plan: OperationPlan
}): Promise<EditScriptAssetGenerationPayload> {
  if (
    params.plan.operationId !== 'generate_edit_script_assets' ||
    params.plan.projectId !== params.ctx.projectId ||
    params.plan.userId !== params.ctx.userId
  ) {
    throw new ApiError('CONFLICT', { code: 'OPERATION_PLAN_SCOPE_MISMATCH' })
  }
  const metadata = readPlanMetadata(params.plan)
  if (metadata.projectId !== params.ctx.projectId) {
    throw new ApiError('CONFLICT', { code: 'OPERATION_PLAN_SCOPE_MISMATCH' })
  }
  const transaction = requireOperationExecutionTransaction(params.ctx)
  await applyPlanWrites(transaction, metadata)
  const submitted = await submitPlannedOperationTasks({
    ctx: params.ctx,
    operationId: 'generate_edit_script_assets',
  })

  const submittedTasks: EditScriptAssetGenerationTask[] = []
  const representedPlans = new Set<string>()
  for (const item of metadata.requirements) {
    if (!item.taskPlanId || representedPlans.has(item.taskPlanId)) continue
    const task = params.plan.tasks.find((planned) => planned.id === item.taskPlanId)
    const result = submitted.get(item.taskPlanId)
    if (!task || !result) throw new Error(`EDIT_SCRIPT_ASSET_TASK_RESULT_MISSING:${item.taskPlanId}`)
    representedPlans.add(item.taskPlanId)
    const taskType =
      task.taskType === TASK_TYPE.IMAGE_CHARACTER
        ? TASK_TYPE.IMAGE_CHARACTER
        : task.taskType === TASK_TYPE.IMAGE_LOCATION
          ? TASK_TYPE.IMAGE_LOCATION
          : invalidPlanMetadata(`task.${task.id}.taskType.${task.taskType}`)
    submittedTasks.push({
      requirementId: item.requirementId,
      kind: item.kind,
      name: item.name,
      taskId: result.taskId,
      status: result.status,
      runId: result.runId,
      deduped: result.deduped,
      taskType,
      targetType: item.targetType,
      targetId: item.targetId,
    })
  }
  const persistedEditScript = await getPersistedEditScriptForRevision(
    params.ctx.projectId,
    metadata.episodeId,
    metadata.representativeChapterId,
    metadata.representativeScriptId,
    transaction,
  )
  if (!persistedEditScript) throw new ApiError('NOT_FOUND')
  const editScript = mapPersistedEditScriptForRevision(persistedEditScript)
  const remainingRequirementCount = await transaction.projectEditAssetRequirement.count({
    where: {
      editScriptId: { in: [...metadata.scriptIds] },
      status: { not: 'completed' },
    },
  })
  if (submittedTasks.length === 0 && remainingRequirementCount > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_ASSET_GENERATION_STALLED',
      message: 'No edit script asset generation tasks were submitted while asset requirements remain unfinished.',
      remainingRequirementCount,
      processedRequirementCount: metadata.requirements.length,
    })
  }
  return {
    success: true,
    async: submittedTasks.length > 0,
    total: submittedTasks.length,
    processedRequirementCount: metadata.requirements.length,
    remainingRequirementCount,
    taskIds: submittedTasks.map((task) => task.taskId),
    results: submittedTasks.map((task) => ({
      refId: task.requirementId,
      taskId: task.taskId,
      taskType: task.taskType,
      targetType: task.targetType,
      targetId: task.targetId,
    })),
    submittedTasks,
    editScript,
  }
}
