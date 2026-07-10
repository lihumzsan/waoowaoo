import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTask,
  type OperationPlan,
  type PlannedTask,
} from '@/lib/operations/planning'
import {
  inferVideoGridModeForShotCount,
  resolveVideoGroupShots,
  totalVideoGroupDuration,
  validateVideoGroupShotIds,
} from '@/lib/video-groups/core'
import {
  type GenerationSegmentVideoPlan,
  type GenerationSegmentVideoPlanItem,
  type VideoGridMode,
  type VideoGroupShot,
} from '@/lib/video-groups/types'
import { normalizeEditScriptStructure } from '@/lib/edit-script/normalize'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'
import { buildStoryboardConsistencySource } from '@/lib/edit-script/storyboard-consistency/source-snapshot'
import { resolveDefaultEditChapter } from '@/lib/edit-chapter'
import {
  applySystemVideoDuration,
  buildVideoTaskPayload,
  isRecord,
  normalizeString,
  normalizeStringList,
  validateVideoTaskPayloadOrThrow,
  type UnknownObject,
} from './shared'

export function parseShotIdsJson(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0)
}

function parseShotNumbersJson(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => Number.isInteger(item) && item > 0)
}

function shotNumbersForShots(shots: readonly VideoGroupShot[]): number[] {
  return shots.map((shot) => shot.shotNumber)
}

function sameShotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export async function resolveEditChapterId(episodeId: string, chapterId?: string): Promise<string> {
  if (chapterId) {
    const chapter = await prisma.projectEditChapter.findFirst({
      where: { id: chapterId, episodeId },
      select: { id: true },
    })
    if (!chapter) throw new Error('PROJECT_AGENT_CHAPTER_NOT_FOUND')
    return chapter.id
  }
  const chapter = await resolveDefaultEditChapter(episodeId)
  return chapter.id
}

async function findExistingVideoGroup(params: { episodeId: string; chapterId: string; gridMode: string; shotIds: readonly string[] }) {
  const candidates = await prisma.projectVideoGroup.findMany({
    where: {
      episodeId: params.episodeId,
      chapterId: params.chapterId,
      gridMode: params.gridMode,
    },
    select: {
      id: true,
      status: true,
      taskId: true,
      errorCode: true,
      errorMessage: true,
      durationSec: true,
      prompt: true,
      referenceImageUrl: true,
      referenceImageMediaId: true,
      videoUrl: true,
      videoMediaId: true,
      shotIds: true,
      shotNumbers: true,
    },
  })
  return candidates.find((candidate) => sameShotIds(parseShotIdsJson(candidate.shotIds), params.shotIds)) ?? null
}

export function parseEditScriptShots(value: unknown): VideoGroupShot[] {
  const core = normalizeEditScriptStructure(value)
  return core.shots.map((shot) => ({
    shotId: shot.shotId,
    shotNumber: shot.shotNumber,
    durationSec: shot.durationSec,
    action: shot.action,
    sceneName: shot.scene.name,
    characters: shot.characters.map((character) => character.name),
    dialogue: shot.dialogue.map((line) => {
      const speaker = shot.characters.find((character) => character.characterId === line.characterId)?.name ?? line.characterId
      return `${speaker}: ${line.line}`
    }),
    sound: shot.sound,
  }))
}

function buildGenerationSegmentVideoPlanFromCore(value: unknown): GenerationSegmentVideoPlan {
  const core = normalizeEditScriptStructure(value)
  return {
    items: core.generationSegments
      .filter((segment) => segment.shotIds.length >= 2)
      .map((segment) => ({
        kind: 'group',
        shotIds: segment.shotIds,
        gridMode: inferVideoGridModeForShotCount(segment.shotIds.length),
        continuity: segment.continuity,
      })),
  }
}

export async function buildEpisodeGenerationSegmentVideoPlan(params: {
  ctx: ProjectAgentOperationContext
  episodeId: string
  chapterId?: string
}): Promise<{
  readonly editScript: {
    readonly id: string
    readonly corePlanJson: Prisma.JsonValue | null
  }
  readonly shots: readonly VideoGroupShot[]
  readonly plan: GenerationSegmentVideoPlan
}> {
  const chapterId = await resolveEditChapterId(params.episodeId, params.chapterId)
  const editScript = await prisma.projectEditScript.findFirst({
    where: {
      projectId: params.ctx.projectId,
      episodeId: params.episodeId,
      chapterId,
    },
    select: {
      id: true,
      corePlanJson: true,
    },
  })
  if (!editScript) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_REQUIRED')
  const shots = parseEditScriptShots(editScript.corePlanJson)
  if (shots.length === 0) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_SHOTS_EMPTY')

  return {
    editScript,
    shots,
    plan: buildGenerationSegmentVideoPlanFromCore(editScript.corePlanJson),
  }
}

async function resolveVideoGroupInput(params: {
  projectId: string
  episodeId: string
  chapterId?: string
  gridMode: VideoGridMode
  shotIds: readonly string[]
}) {
  const chapterId = await resolveEditChapterId(params.episodeId, params.chapterId)
  const [episode, editScript, panels] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: params.episodeId, projectId: params.projectId },
      select: { id: true },
    }),
    prisma.projectEditScript.findFirst({
      where: {
        episodeId: params.episodeId,
        projectId: params.projectId,
        chapterId,
      },
      select: { id: true, corePlanJson: true },
    }),
    prisma.projectPanel.findMany({
      where: {
        storyboard: { episodeId: params.episodeId, chapterId },
        sourceShotId: { in: [...params.shotIds] },
      },
      select: {
        id: true,
        panelNumber: true,
        sourceShotId: true,
        imageUrl: true,
        imageMediaId: true,
      },
    }),
  ])
  if (!episode) throw new Error('PROJECT_AGENT_EPISODE_NOT_FOUND')
  if (!editScript) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_REQUIRED')
  const shots = parseEditScriptShots(editScript.corePlanJson)
  const shotIds = validateVideoGroupShotIds({
    gridMode: params.gridMode,
    shotIds: params.shotIds,
    shots,
  })
  const selectedShots = resolveVideoGroupShots(shots, shotIds)
  const panelByShotId = new Map<string, (typeof panels)[number]>()
  panels.forEach((panel) => {
    if (panel.sourceShotId) panelByShotId.set(panel.sourceShotId, panel)
  })
  shotIds.forEach((shotId) => {
    const panel = panelByShotId.get(shotId)
    if (!panel) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_PANEL_NOT_FOUND:${shotId}`)
    if (!panel.imageUrl && !panel.imageMediaId) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_PANEL_IMAGE_MISSING:${shotId}`)
  })
  return {
    editScript,
    chapterId,
    shotIds,
    selectedShots,
  }
}

async function buildGenerationSegmentPrompt(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly chapterId: string
  readonly editScriptId: string
  readonly shotIds: readonly string[]
}): Promise<string> {
  const { sourceSnapshot } = await buildStoryboardConsistencySource({
    projectId: input.projectId,
    episodeId: input.episodeId,
    chapterId: input.chapterId,
    editScriptId: input.editScriptId,
    userId: input.userId,
  })
  const segment = sourceSnapshot.generationSegments.find((candidate) => sameShotIds(candidate.shotIds, input.shotIds))
  if (!segment) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_GENERATION_SEGMENT_NOT_FOUND:${input.shotIds.join(',')}`)
  const segmentExecution = sourceSnapshot.shotExecutionPlan.generationSegmentExecutions.find((candidate) =>
    sameShotIds(candidate.shotIds, input.shotIds),
  )
  if (!segmentExecution) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_SEGMENT_EXECUTION_NOT_FOUND:${input.shotIds.join(',')}`)
  return segmentExecution.continuousVideoPrompt
}

function validateAssetReferenceShotIds(shotIds: readonly string[], shots: readonly VideoGroupShot[]): string[] {
  const normalized = shotIds.map((value) => value.trim())
  if (normalized.some((value) => value.length === 0)) {
    throw new Error('PROJECT_AGENT_ASSET_REFERENCE_SHOT_IDS_INVALID')
  }
  if (normalized.length < 1 || normalized.length > 9) {
    throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_SHOT_COUNT_UNSUPPORTED:${normalized.length}`)
  }
  resolveVideoGroupShots(shots, normalized)
  return normalized
}

function gridModeForAssetReferenceItem(item: GenerationSegmentVideoPlanItem): string {
  return item.gridMode ?? inferVideoGridModeForShotCount(item.shotIds.length)
}

export function readStoryboardVideoGridMode(value: unknown): VideoGridMode {
  return value === '3x3' ? '3x3' : '2x2'
}

type ExistingVideoGroupRecord = NonNullable<Awaited<ReturnType<typeof findExistingVideoGroup>>>

export type PlannedVideoGroupTaskMetadata = {
  planTaskId: string
  projectId: string
  groupId: string
  episodeId: string
  chapterId: string
  gridMode: string
  shotIds: string[]
  shotNumbers: number[]
  durationSec: number
  previous: ExistingVideoGroupRecord | null
  sourceMode?: 'asset_reference' | null
  prompt?: string | null
  referenceImageUrls?: string[]
  segmentIndex?: number
}

export type CommittedVideoGroupTask = {
  metadata: PlannedVideoGroupTaskMetadata
  result: Awaited<ReturnType<typeof submitPlannedOperationTask>>
}

function readPlannedVideoGroupTaskMetadata(value: unknown): PlannedVideoGroupTaskMetadata {
  if (!isRecord(value)) throw new Error('PROJECT_AGENT_VIDEO_GROUP_PLAN_METADATA_INVALID')
  const planTaskId = normalizeString(value.planTaskId)
  const projectId = normalizeString(value.projectId)
  const groupId = normalizeString(value.groupId)
  const episodeId = normalizeString(value.episodeId)
  const chapterId = normalizeString(value.chapterId)
  const gridMode = normalizeString(value.gridMode)
  const shotIds = parseShotIdsJson(value.shotIds)
  const shotNumbers = parseShotNumbersJson(value.shotNumbers)
  const durationSec = Number(value.durationSec)
  if (
    !planTaskId ||
    !projectId ||
    !groupId ||
    !episodeId ||
    !chapterId ||
    !gridMode ||
    shotIds.length === 0 ||
    shotNumbers.length !== shotIds.length ||
    !Number.isInteger(durationSec) ||
    durationSec <= 0
  ) {
    throw new Error('PROJECT_AGENT_VIDEO_GROUP_PLAN_METADATA_INVALID')
  }
  const prompt = Object.prototype.hasOwnProperty.call(value, 'prompt') ? normalizeString(value.prompt) || null : undefined
  const sourceMode = value.sourceMode === 'asset_reference' ? 'asset_reference' : null
  if (sourceMode === 'asset_reference' && !prompt) {
    throw new Error('PROJECT_AGENT_ASSET_REFERENCE_PROMPT_REQUIRED')
  }
  return {
    planTaskId,
    projectId,
    groupId,
    episodeId,
    chapterId,
    gridMode,
    shotIds,
    shotNumbers,
    durationSec,
    previous: isRecord(value.previous) ? (value.previous as ExistingVideoGroupRecord) : null,
    sourceMode,
    ...(prompt !== undefined ? { prompt } : {}),
    referenceImageUrls: normalizeStringList(value.referenceImageUrls),
    segmentIndex: typeof value.segmentIndex === 'number' && Number.isInteger(value.segmentIndex) ? value.segmentIndex : undefined,
  }
}

export function readPlannedVideoGroupMetadataList(plan: OperationPlan): PlannedVideoGroupTaskMetadata[] {
  const metadata = isRecord(plan.metadata) ? plan.metadata : {}
  const groups = Array.isArray(metadata.videoGroups) ? metadata.videoGroups : []
  return groups.map(readPlannedVideoGroupTaskMetadata)
}

export function readPlannedVideoGroupMetadataByTaskId(plan: OperationPlan): Map<string, PlannedVideoGroupTaskMetadata> {
  return new Map(readPlannedVideoGroupMetadataList(plan).map((metadata) => [metadata.planTaskId, metadata]))
}

async function prepareVideoGroupRecordForPlan(tx: Prisma.TransactionClient, metadata: PlannedVideoGroupTaskMetadata): Promise<void> {
  const resetReferenceImage = metadata.sourceMode === 'asset_reference'
  if (metadata.previous) {
    await tx.projectVideoGroup.update({
      where: { id: metadata.groupId },
      data: {
        durationSec: metadata.durationSec,
        shotIds: metadata.shotIds as unknown as Prisma.InputJsonValue,
        shotNumbers: metadata.shotNumbers as unknown as Prisma.InputJsonValue,
        status: 'queued',
        taskId: null,
        errorCode: null,
        errorMessage: null,
        ...(metadata.prompt !== undefined ? { prompt: metadata.prompt } : {}),
        ...(resetReferenceImage
          ? {
              referenceImageUrl: null,
              referenceImageMediaId: null,
            }
          : {}),
      },
    })
    return
  }

  await tx.projectVideoGroup.create({
    data: {
      id: metadata.groupId,
      projectId: metadata.projectId,
      episodeId: metadata.episodeId,
      chapterId: metadata.chapterId,
      gridMode: metadata.gridMode,
      shotIds: metadata.shotIds as unknown as Prisma.InputJsonValue,
      shotNumbers: metadata.shotNumbers as unknown as Prisma.InputJsonValue,
      durationSec: metadata.durationSec,
      prompt: metadata.prompt ?? null,
      status: 'queued',
    },
  })
}

export async function planAssetReferenceGenerationSegmentTask(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  episodeId: string
  chapterId?: string
  editScriptId: string
  item: GenerationSegmentVideoPlanItem
  shots: readonly VideoGroupShot[]
  segmentIndex?: number
}): Promise<{
  task: PlannedTask
  metadata: PlannedVideoGroupTaskMetadata
}> {
  const referenceImageUrls = normalizeStringList(params.input.referenceImageUrls)
  if (referenceImageUrls.length === 0) {
    throw new Error('PROJECT_AGENT_ASSET_REFERENCE_IMAGES_REQUIRED')
  }
  const chapterId = await resolveEditChapterId(params.episodeId, params.chapterId)
  const shotIds = validateAssetReferenceShotIds(params.item.shotIds, params.shots)
  const selectedShots = resolveVideoGroupShots(params.shots, shotIds)
  const durationSec = totalVideoGroupDuration(selectedShots)
  if (durationSec < 1 || durationSec > 15) {
    throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_DURATION_UNSUPPORTED:${durationSec}`)
  }

  const { payload, localeForTask } = buildVideoTaskPayload({
    ctx: params.ctx,
    input: params.input,
  })
  delete payload.prompt
  applySystemVideoDuration(payload, durationSec)
  payload.episodeId = params.episodeId
  payload.chapterId = chapterId
  payload.gridMode = gridModeForAssetReferenceItem(params.item)
  payload.shotIds = shotIds
  payload.durationSec = durationSec
  payload.sourceMode = 'asset_reference'
  payload.referenceImageUrls = referenceImageUrls

  await validateVideoTaskPayloadOrThrow({
    payload,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    modelPurpose: 'sequence-video',
  })

  const gridMode = String(payload.gridMode)
  const previous = await findExistingVideoGroup({
    episodeId: params.episodeId,
    chapterId,
    gridMode,
    shotIds,
  })
  const prompt = await buildGenerationSegmentPrompt({
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    episodeId: params.episodeId,
    chapterId,
    editScriptId: params.editScriptId,
    shotIds,
  })
  const groupId = previous?.id ?? randomUUID()
  const planTaskId = `${params.operationId}:asset_reference:${params.segmentIndex ?? shotIds.join('-')}:${groupId}`
  const billingInfo = requirePlannedTaskBillingInfo({
    taskType: TASK_TYPE.VIDEO_GROUP,
    payload,
    allowedApiTypes: ['video'],
  })
  return {
    task: createPlannedTask({
      id: planTaskId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: groupId,
      locale: localeForTask,
      episodeId: params.episodeId,
      payload: withTaskUiPayload(payload, {
        hasOutputAtStart: Boolean(previous?.videoUrl || previous?.videoMediaId),
      }),
      dedupeKey: `video_group:${groupId}`,
      billingInfo,
    }),
    metadata: {
      planTaskId,
      projectId: params.ctx.projectId,
      groupId,
      episodeId: params.episodeId,
      chapterId,
      gridMode,
      shotIds,
      shotNumbers: shotNumbersForShots(selectedShots),
      durationSec,
      previous,
      sourceMode: 'asset_reference',
      prompt,
      referenceImageUrls,
      segmentIndex: params.segmentIndex,
    },
  }
}

export async function planVideoGroupTask(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  episodeId: string
  chapterId?: string
  gridMode: VideoGridMode
  shotIds: readonly string[]
}): Promise<{
  task: PlannedTask
  metadata: PlannedVideoGroupTaskMetadata
}> {
  const resolved = await resolveVideoGroupInput({
    projectId: params.ctx.projectId,
    episodeId: params.episodeId,
    chapterId: params.chapterId,
    gridMode: params.gridMode,
    shotIds: params.shotIds,
  })
  const durationSec = totalVideoGroupDuration(resolved.selectedShots)
  const { payload, localeForTask } = buildVideoTaskPayload({
    ctx: params.ctx,
    input: params.input,
  })
  applySystemVideoDuration(payload, durationSec)
  payload.episodeId = params.episodeId
  payload.chapterId = resolved.chapterId
  payload.gridMode = params.gridMode
  payload.shotIds = resolved.shotIds
  payload.durationSec = durationSec

  await validateVideoTaskPayloadOrThrow({
    payload,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    modelPurpose: 'sequence-video',
  })

  const previous = await findExistingVideoGroup({
    episodeId: params.episodeId,
    chapterId: resolved.chapterId,
    gridMode: params.gridMode,
    shotIds: resolved.shotIds,
  })
  const prompt = await buildGenerationSegmentPrompt({
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    episodeId: params.episodeId,
    chapterId: resolved.chapterId,
    editScriptId: resolved.editScript.id,
    shotIds: resolved.shotIds,
  })
  const groupId = previous?.id ?? randomUUID()
  const planTaskId = `${params.operationId}:${params.gridMode}:${resolved.shotIds.join('-')}:${groupId}`
  const billingInfo = requirePlannedTaskBillingInfo({
    taskType: TASK_TYPE.VIDEO_GROUP,
    payload,
    allowedApiTypes: ['video'],
  })
  return {
    task: createPlannedTask({
      id: planTaskId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: groupId,
      locale: localeForTask,
      episodeId: params.episodeId,
      payload: withTaskUiPayload(payload, {
        hasOutputAtStart: Boolean(previous?.videoUrl || previous?.videoMediaId),
      }),
      dedupeKey: `video_group:${groupId}`,
      billingInfo,
    }),
    metadata: {
      planTaskId,
      projectId: params.ctx.projectId,
      groupId,
      episodeId: params.episodeId,
      chapterId: resolved.chapterId,
      gridMode: params.gridMode,
      shotIds: resolved.shotIds,
      shotNumbers: shotNumbersForShots(resolved.selectedShots),
      durationSec,
      previous,
      prompt,
    },
  }
}

export async function commitPlannedVideoGroupTask(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  task: PlannedTask
  metadata: PlannedVideoGroupTaskMetadata
}): Promise<CommittedVideoGroupTask> {
  const transaction = requireOperationExecutionTransaction(params.ctx)
  await prepareVideoGroupRecordForPlan(transaction, params.metadata)
  const result = await submitPlannedOperationTask({
    ctx: params.ctx,
    task: params.task,
    operationId: params.operationId,
  })
  await transaction.projectVideoGroup.update({
    where: { id: params.metadata.groupId },
    data: {
      taskId: result.taskId,
      status: result.status,
      ...(params.metadata.sourceMode === 'asset_reference'
        ? {
            prompt: params.metadata.prompt ?? null,
            referenceImageUrl: params.metadata.referenceImageUrls?.[0] ?? null,
            referenceImageMediaId: null,
          }
        : {}),
    },
  })
  return {
    metadata: params.metadata,
    result,
  }
}

export async function commitPlannedVideoGroupBatch(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}): Promise<CommittedVideoGroupTask[]> {
  const metadataByTaskId = readPlannedVideoGroupMetadataByTaskId(params.plan)
  const committed: CommittedVideoGroupTask[] = []
  for (const task of params.plan.tasks) {
    const metadata = metadataByTaskId.get(task.id)
    if (!metadata) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_PLAN_TASK_METADATA_MISSING:${task.id}`)
    committed.push(
      await commitPlannedVideoGroupTask({
        ctx: params.ctx,
        input: params.input,
        operationId: params.operationId,
        task,
        metadata,
      }),
    )
  }
  return committed
}
