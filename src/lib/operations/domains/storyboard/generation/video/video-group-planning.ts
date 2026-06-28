import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { compensateSubmittedTasks, createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import { totalVideoGroupDuration, validateVideoGroupShotNumbers } from '@/lib/video-groups/core'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import { type VideoBlockPlan, type VideoBlockPlanItem, type VideoGridMode, type VideoGroupShot } from '@/lib/video-groups/types'
import { ASSET_REFERENCE_GRID_MODE, applySystemVideoDuration, buildVideoTaskPayload, isRecord, normalizeString, normalizeStringList, validateVideoTaskPayloadOrThrow, type UnknownObject } from './shared'

export function parseShotNumbersJson(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

async function findExistingVideoGroup(params: {
  episodeId: string
  gridMode: string
  shotNumbers: readonly number[]
}) {
  const candidates = await prisma.projectVideoGroup.findMany({
    where: {
      episodeId: params.episodeId,
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
      shotNumbers: true,
    },
  })
  return candidates.find((candidate) => sameShotNumbers(parseShotNumbersJson(candidate.shotNumbers), params.shotNumbers)) ?? null
}

export function parseEditScriptShots(value: unknown): VideoGroupShot[] {
  if (!Array.isArray(value)) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_SHOTS_INVALID')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_SHOT_INVALID')
    const shotNumber = Number(item.shotNumber)
    const durationSec = Number(item.durationSec)
    if (!Number.isInteger(shotNumber) || shotNumber <= 0) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_SHOT_NUMBER_INVALID')
    if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 5) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_SHOT_DURATION_INVALID')
    return {
      shotNumber,
      durationSec,
      dramaticPurpose: normalizeString(item.dramaticPurpose),
      visibleAction: normalizeString(item.visibleAction),
      audienceFocus: normalizeString(item.audienceFocus),
      viewpoint: normalizeString(item.viewpoint),
      revealPlan: normalizeString(item.revealPlan),
      performanceBeat: normalizeString(item.performanceBeat),
      continuityIn: normalizeString(item.continuityIn),
      continuityOut: normalizeString(item.continuityOut),
      charactersAndScene: normalizeString(item.charactersAndScene),
      sound: normalizeString(item.sound),
    }
  })
}

export async function buildEpisodeVideoBlockPlan(params: {
  ctx: ProjectAgentOperationContext
  episodeId: string
}): Promise<{
  readonly editScript: {
    readonly title: string
    readonly logline: string | null
    readonly shotsJson: Prisma.JsonValue
    readonly videoBlocksJson: Prisma.JsonValue | null
  }
  readonly shots: readonly VideoGroupShot[]
  readonly plan: VideoBlockPlan
}> {
  const editScript = await prisma.projectEditScript.findFirst({
    where: { projectId: params.ctx.projectId, episodeId: params.episodeId },
    select: {
      title: true,
      logline: true,
      shotsJson: true,
      videoBlocksJson: true,
    },
  })
  if (!editScript) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_REQUIRED')
  if (!Array.isArray(editScript.videoBlocksJson) || editScript.videoBlocksJson.length === 0) {
    throw new Error('PROJECT_AGENT_VIDEO_BLOCKS_REQUIRED')
  }
  const shots = parseEditScriptShots(editScript.shotsJson)
  if (shots.length === 0) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_SHOTS_EMPTY')

  return {
    editScript,
    shots,
    plan: normalizeVideoBlockPlanResponse({
      response: { items: editScript.videoBlocksJson },
      allShotNumbers: shots.map((shot) => shot.shotNumber),
      shots,
      enforceSingleMinDuration: false,
    }),
  }
}

export async function resolvePanelIdForVideoBlockShot(params: {
  episodeId: string
  shotNumber: number
}): Promise<string> {
  const panel = await prisma.projectPanel.findFirst({
    where: {
      storyboard: { episodeId: params.episodeId },
      panelNumber: params.shotNumber,
    },
    select: {
      id: true,
      imageUrl: true,
      imageMediaId: true,
    },
  })
  if (!panel) throw new Error(`PROJECT_AGENT_AUTO_VIDEO_PANEL_NOT_FOUND:${params.shotNumber}`)
  if (!panel.imageUrl && !panel.imageMediaId) {
    throw new Error(`PROJECT_AGENT_AUTO_VIDEO_PANEL_IMAGE_MISSING:${params.shotNumber}`)
  }
  return panel.id
}

async function resolveVideoGroupInput(params: {
  projectId: string
  episodeId: string
  gridMode: VideoGridMode
  shotNumbers: readonly number[]
}) {
  const shotNumbers = validateVideoGroupShotNumbers({
    gridMode: params.gridMode,
    shotNumbers: params.shotNumbers,
  })
  const [episode, editScript, panels] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: { id: params.episodeId, projectId: params.projectId },
      select: { id: true },
    }),
    prisma.projectEditScript.findFirst({
      where: { episodeId: params.episodeId, projectId: params.projectId },
      select: { id: true, title: true, logline: true, shotsJson: true },
    }),
    prisma.projectPanel.findMany({
      where: {
        storyboard: { episodeId: params.episodeId },
        panelNumber: { in: shotNumbers },
      },
      select: {
        id: true,
        panelNumber: true,
        imageUrl: true,
        imageMediaId: true,
      },
    }),
  ])
  if (!episode) throw new Error('PROJECT_AGENT_EPISODE_NOT_FOUND')
  if (!editScript) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_REQUIRED')
  const shots = parseEditScriptShots(editScript.shotsJson)
  const selectedShots = shotNumbers.map((shotNumber) => {
    const shot = shots.find((item) => item.shotNumber === shotNumber)
    if (!shot) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_SHOT_NOT_FOUND:${shotNumber}`)
    return shot
  })
  const panelByShotNumber = new Map<number, (typeof panels)[number]>()
  panels.forEach((panel) => {
    if (typeof panel.panelNumber === 'number') panelByShotNumber.set(panel.panelNumber, panel)
  })
  shotNumbers.forEach((shotNumber) => {
    const panel = panelByShotNumber.get(shotNumber)
    if (!panel) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_PANEL_NOT_FOUND:${shotNumber}`)
    if (!panel.imageUrl && !panel.imageMediaId) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_PANEL_IMAGE_MISSING:${shotNumber}`)
  })
  return {
    editScript,
    shotNumbers,
    selectedShots,
  }
}

function validateAssetReferenceShotNumbers(shotNumbers: readonly number[]): number[] {
  const normalized = shotNumbers.map((value) => Number(value))
  if (normalized.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('PROJECT_AGENT_ASSET_REFERENCE_SHOT_NUMBERS_INVALID')
  }
  if (normalized.length < 1 || normalized.length > 9) {
    throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_SHOT_COUNT_UNSUPPORTED:${normalized.length}`)
  }
  return normalized
}

function durationForShotNumbers(shots: readonly VideoGroupShot[], shotNumbers: readonly number[]): number {
  return shotNumbers.reduce((total, shotNumber) => {
    const shot = shots.find((item) => item.shotNumber === shotNumber)
    if (!shot) throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_SHOT_NOT_FOUND:${shotNumber}`)
    return total + shot.durationSec
  }, 0)
}

function gridModeForAssetReferenceItem(item: VideoBlockPlanItem): string {
  if (item.kind === 'group') return item.gridMode ?? ASSET_REFERENCE_GRID_MODE
  return ASSET_REFERENCE_GRID_MODE
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
  gridMode: string
  shotNumbers: number[]
  durationSec: number
  previous: ExistingVideoGroupRecord | null
  sourceMode?: 'asset_reference' | null
  prompt?: string | null
  referenceImageUrls?: string[]
  blockIndex?: number
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
  const gridMode = normalizeString(value.gridMode)
  const shotNumbers = parseShotNumbersJson(value.shotNumbers)
  const durationSec = Number(value.durationSec)
  if (!planTaskId || !projectId || !groupId || !episodeId || !gridMode || shotNumbers.length === 0 || !Number.isInteger(durationSec) || durationSec <= 0) {
    throw new Error('PROJECT_AGENT_VIDEO_GROUP_PLAN_METADATA_INVALID')
  }
  return {
    planTaskId,
    projectId,
    groupId,
    episodeId,
    gridMode,
    shotNumbers,
    durationSec,
    previous: isRecord(value.previous) ? value.previous as ExistingVideoGroupRecord : null,
    sourceMode: value.sourceMode === 'asset_reference' ? 'asset_reference' : null,
    prompt: normalizeString(value.prompt) || null,
    referenceImageUrls: normalizeStringList(value.referenceImageUrls),
    blockIndex: typeof value.blockIndex === 'number' && Number.isInteger(value.blockIndex) ? value.blockIndex : undefined,
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

async function prepareVideoGroupRecordForPlan(metadata: PlannedVideoGroupTaskMetadata): Promise<void> {
  const resetReferenceImage = metadata.sourceMode === 'asset_reference'
  if (metadata.previous) {
    await prisma.projectVideoGroup.update({
      where: { id: metadata.groupId },
      data: {
        durationSec: metadata.durationSec,
        status: 'queued',
        taskId: null,
        errorCode: null,
        errorMessage: null,
        ...(resetReferenceImage ? {
          referenceImageUrl: null,
          referenceImageMediaId: null,
        } : {}),
      },
    })
    return
  }

  await prisma.projectVideoGroup.create({
    data: {
      id: metadata.groupId,
      projectId: metadata.projectId,
      episodeId: metadata.episodeId,
      gridMode: metadata.gridMode,
      shotNumbers: metadata.shotNumbers as unknown as Prisma.InputJsonValue,
      durationSec: metadata.durationSec,
      status: 'queued',
    },
  })
}

async function rollbackVideoGroupTaskRecord(params: {
  groupId: string
  previous: ExistingVideoGroupRecord | null
}) {
  try {
    if (!params.previous) {
      await prisma.projectVideoGroup.delete({ where: { id: params.groupId } })
      return
    }
    await prisma.projectVideoGroup.update({
      where: { id: params.groupId },
      data: {
        status: params.previous.status,
        taskId: params.previous.taskId,
        errorCode: params.previous.errorCode,
        errorMessage: params.previous.errorMessage,
        durationSec: params.previous.durationSec,
        prompt: params.previous.prompt,
        referenceImageUrl: params.previous.referenceImageUrl,
        referenceImageMediaId: params.previous.referenceImageMediaId,
        videoUrl: params.previous.videoUrl,
        videoMediaId: params.previous.videoMediaId,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`PROJECT_AGENT_VIDEO_GROUP_RECORD_ROLLBACK_FAILED:${params.groupId}:${message}`)
  }
}

export async function rollbackCommittedVideoGroups(committed: readonly CommittedVideoGroupTask[]): Promise<void> {
  const failures: string[] = []
  for (const item of committed) {
    try {
      await rollbackVideoGroupTaskRecord({
        groupId: item.metadata.groupId,
        previous: item.metadata.previous,
      })
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (failures.length > 0) {
    throw new Error(`PROJECT_AGENT_VIDEO_GROUP_BATCH_RECORD_ROLLBACK_FAILED:${failures.join(';')}`)
  }
}

export async function planAssetReferenceVideoBlockTask(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  episodeId: string
  item: VideoBlockPlanItem
  shots: readonly VideoGroupShot[]
  blockIndex?: number
}): Promise<{
  task: PlannedTask
  metadata: PlannedVideoGroupTaskMetadata
}> {
  const referenceImageUrls = normalizeStringList(params.input.referenceImageUrls)
  if (referenceImageUrls.length === 0) {
    throw new Error('PROJECT_AGENT_ASSET_REFERENCE_IMAGES_REQUIRED')
  }
  const shotNumbers = validateAssetReferenceShotNumbers(params.item.shotNumbers)
  const durationSec = durationForShotNumbers(params.shots, shotNumbers)
  if (durationSec < 1 || durationSec > 15) {
    throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_DURATION_UNSUPPORTED:${durationSec}`)
  }

  const { payload, localeForTask } = buildVideoTaskPayload({ ctx: params.ctx, input: params.input })
  applySystemVideoDuration(payload, durationSec)
  payload.episodeId = params.episodeId
  payload.gridMode = gridModeForAssetReferenceItem(params.item)
  payload.shotNumbers = shotNumbers
  payload.durationSec = durationSec
  payload.sourceMode = 'asset_reference'
  payload.prompt = params.item.prompt
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
    gridMode,
    shotNumbers,
  })
  const groupId = previous?.id ?? randomUUID()
  const planTaskId = `${params.operationId}:asset_reference:${params.blockIndex ?? shotNumbers.join('-')}:${groupId}`
  const billingInfo = requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.VIDEO_GROUP, payload, allowedApiTypes: ['video'] })
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
      gridMode,
      shotNumbers,
      durationSec,
      previous,
      sourceMode: 'asset_reference',
      prompt: params.item.prompt,
      referenceImageUrls,
      blockIndex: params.blockIndex,
    },
  }
}

export async function planVideoGroupTask(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  episodeId: string
  gridMode: VideoGridMode
  shotNumbers: readonly number[]
}): Promise<{
  task: PlannedTask
  metadata: PlannedVideoGroupTaskMetadata
}> {
  const resolved = await resolveVideoGroupInput({
    projectId: params.ctx.projectId,
    episodeId: params.episodeId,
    gridMode: params.gridMode,
    shotNumbers: params.shotNumbers,
  })
  const durationSec = totalVideoGroupDuration(resolved.selectedShots)
  const { payload, localeForTask } = buildVideoTaskPayload({ ctx: params.ctx, input: params.input })
  applySystemVideoDuration(payload, durationSec)
  payload.episodeId = params.episodeId
  payload.gridMode = params.gridMode
  payload.shotNumbers = resolved.shotNumbers
  payload.durationSec = durationSec

  await validateVideoTaskPayloadOrThrow({
    payload,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    modelPurpose: 'sequence-video',
  })

  const previous = await findExistingVideoGroup({
    episodeId: params.episodeId,
    gridMode: params.gridMode,
    shotNumbers: resolved.shotNumbers,
  })
  const groupId = previous?.id ?? randomUUID()
  const planTaskId = `${params.operationId}:${params.gridMode}:${resolved.shotNumbers.join('-')}:${groupId}`
  const billingInfo = requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.VIDEO_GROUP, payload, allowedApiTypes: ['video'] })
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
      gridMode: params.gridMode,
      shotNumbers: resolved.shotNumbers,
      durationSec,
      previous,
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
  await prepareVideoGroupRecordForPlan(params.metadata)
  let submittedTaskId: string | null = null
  try {
    const result = await submitPlannedOperationTask({
      ctx: params.ctx,
      task: params.task,
      operationId: params.operationId,
      confirmed: params.input.confirmed === true,
    })
    submittedTaskId = result.taskId
    await prisma.projectVideoGroup.update({
      where: { id: params.metadata.groupId },
      data: {
        taskId: result.taskId,
        status: result.status,
        ...(params.metadata.sourceMode === 'asset_reference' ? {
          prompt: params.metadata.prompt ?? null,
          referenceImageUrl: params.metadata.referenceImageUrls?.[0] ?? null,
          referenceImageMediaId: null,
        } : {}),
      },
    })
    return {
      metadata: params.metadata,
      result,
    }
  } catch (error) {
    if (submittedTaskId) {
      await compensateSubmittedTasks([submittedTaskId])
    }
    await rollbackVideoGroupTaskRecord({
      groupId: params.metadata.groupId,
      previous: params.metadata.previous,
    })
    throw error
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
  try {
    for (const task of params.plan.tasks) {
      const metadata = metadataByTaskId.get(task.id)
      if (!metadata) throw new Error(`PROJECT_AGENT_VIDEO_GROUP_PLAN_TASK_METADATA_MISSING:${task.id}`)
      committed.push(await commitPlannedVideoGroupTask({
        ctx: params.ctx,
        input: params.input,
        operationId: params.operationId,
        task,
        metadata,
      }))
    }
  } catch (error) {
    const failures: string[] = []
    await compensateSubmittedTasks(committed.map((item) => item.result.taskId)).catch((compensationError: unknown) => {
      failures.push(compensationError instanceof Error ? compensationError.message : String(compensationError))
    })
    await rollbackCommittedVideoGroups(committed).catch((rollbackError: unknown) => {
      failures.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
    })
    if (failures.length > 0) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`PROJECT_AGENT_VIDEO_GROUP_BATCH_COMPENSATION_FAILED:${message}:${failures.join(';')}`)
    }
    throw error
  }
  return committed
}
