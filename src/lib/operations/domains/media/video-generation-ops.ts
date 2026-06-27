import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { BillingOperationError } from '@/lib/billing/errors'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { resolveAiVideoTokenPricingContract } from '@/lib/ai-exec/video-token-pricing'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { resolveBuiltinPricing } from '@/lib/ai-registry/pricing-resolution'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'
import type {
  TaskBatchSubmittedPartData,
  TaskSubmittedPartData,
} from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  assertOperationPlanConfirmedCost,
  resolveConfirmedMaxCostForExecution,
  submitPlannedOperationTask,
  type OperationPlan,
  type PlannedTask,
} from '@/lib/operations/planning'
import { cancelTask } from '@/lib/task/service'
import { removeTaskJob } from '@/lib/task/queues'
import {
  refineTaskBatchSubmitOperationOutputSchema,
  refineTaskSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { chunkVideoGroupShots, totalVideoGroupDuration, validateVideoGroupShotNumbers } from '@/lib/video-groups/core'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import { VIDEO_GRID_MODES, type VideoBlockPlan, type VideoBlockPlanItem, type VideoGridMode, type VideoGroupShot } from '@/lib/video-groups/types'

type UnknownObject = { [key: string]: unknown }
type VideoTaskModelPurpose = 'single-shot-video' | 'sequence-video'
const ASSET_REFERENCE_GRID_MODE = 'asset_reference'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function resolveLocaleFromContext(locale?: unknown): string {
  const normalized = normalizeString(locale)
  return normalized || 'zh'
}

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toVideoRuntimeSelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      selections[field] = raw
    }
  }
  return selections
}

function mergeVideoRuntimeSelections(...sources: unknown[]): Record<string, CapabilityValue> {
  const merged: Record<string, CapabilityValue> = {}
  for (const source of sources) {
    Object.assign(merged, toVideoRuntimeSelections(source))
  }
  return merged
}

function hasRuntimeSelections(value: unknown): boolean {
  return Object.keys(toVideoRuntimeSelections(value)).length > 0
}

function resolveVideoGenerationMode(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

function usesVideoTokenPricing(modelKey: string): boolean {
  return !!resolveAiVideoTokenPricingContract(modelKey)
}

function resolveVideoModelKeyFromPayload(payload: UnknownObject): string | null {
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    return firstLast.flModel
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    return payload.videoModel
  }
  return null
}

function requireVideoModelKeyFromPayload(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.videoModel !== 'string' || !parseModelKeyStrict(payload.videoModel)) {
    throw new Error('PROJECT_AGENT_VIDEO_MODEL_REQUIRED')
  }
  return payload.videoModel
}

function rejectManagedVideoModelField(field: string): never {
  throw new ApiError('FORBIDDEN', {
    code: 'TASK_MODEL_MANAGED_BY_CONFIG',
    field,
  })
}

function assertNoManagedVideoModelInput(payload: UnknownObject): void {
  if (Object.prototype.hasOwnProperty.call(payload, 'videoModel')) {
    rejectManagedVideoModelField('videoModel')
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'groupVideoModel')) {
    rejectManagedVideoModelField('groupVideoModel')
  }
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && Object.prototype.hasOwnProperty.call(firstLast, 'flModel')) {
    rejectManagedVideoModelField('firstLastFrame.flModel')
  }
}

async function applySystemVideoModel(params: {
  payload: UnknownObject
  projectId: string
  userId: string
  purpose: VideoTaskModelPurpose
}): Promise<void> {
  assertNoManagedVideoModelInput(params.payload)

  const systemVideoModel = await resolveSystemModelKey({
    userId: params.userId,
    projectId: params.projectId,
    purpose: params.purpose,
  })

  const firstLast = isRecord(params.payload.firstLastFrame) ? params.payload.firstLastFrame : null
  params.payload.videoModel = systemVideoModel
  if (firstLast) {
    firstLast.flModel = systemVideoModel
  }

  if (getDeploymentConfig().edition !== 'cloud') return

  const plan = getPlatformRuntimePlan('video')
  if (systemVideoModel !== plan.modelKey) {
    throw new Error(`PLATFORM_RUNTIME_MODEL_MISMATCH: video=${systemVideoModel}`)
  }

  const suppliedOptions = isRecord(params.payload.generationOptions)
    ? params.payload.generationOptions
    : {}
  if (Object.prototype.hasOwnProperty.call(suppliedOptions, 'aspectRatio')) {
    throw new ApiError('FORBIDDEN', {
      code: 'TASK_VIDEO_RATIO_MANAGED_BY_PROJECT',
      field: 'generationOptions.aspectRatio',
    })
  }
  const suppliedRuntimeOptions = isRecord(suppliedOptions)
    ? toVideoRuntimeSelections(suppliedOptions)
    : {}
  const platformOptions = plan.generationOptions
  const internalFields = new Set(['duration', 'generationMode', 'containsVideoInput'])
  const internalOptions: Record<string, CapabilityValue> = {}

  for (const [field, value] of Object.entries(suppliedRuntimeOptions)) {
    if (internalFields.has(field)) {
      internalOptions[field] = value
      continue
    }
    const platformValue = platformOptions[field]
    if (platformValue !== undefined && platformValue === value) {
      continue
    }
    throw new ApiError('FORBIDDEN', {
      code: 'TASK_OPTIONS_MANAGED_BY_PLATFORM',
      field: `generationOptions.${field}`,
    })
  }

  params.payload.generationOptions = {
    ...platformOptions,
    ...internalOptions,
  }
}

function validateFirstLastFrameModel(input: unknown) {
  if (input === undefined || input === null) return
  if (!isRecord(input)) {
    throw new Error('PROJECT_AGENT_FIRSTLASTFRAME_PAYLOAD_INVALID')
  }

  const flModel = input.flModel
  if (typeof flModel !== 'string' || !parseModelKeyStrict(flModel)) {
    throw new Error('PROJECT_AGENT_FIRSTLASTFRAME_MODEL_INVALID')
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', flModel)
  if (capabilities?.video?.firstlastframe !== true) {
    throw new Error('PROJECT_AGENT_FIRSTLASTFRAME_MODEL_UNSUPPORTED')
  }
}

async function resolveVideoCapabilityOptions(input: {
  payload: unknown
  projectId: string
  userId: string
  lastVideoGenerationOptions?: unknown
}) {
  const payload = input.payload
  if (!isRecord(payload)) return {}
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  if (!modelKey) return {}

  const builtinCaps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  if (!builtinCaps) return toVideoRuntimeSelections(payload.generationOptions)

  const explicitRuntimeSelections = toVideoRuntimeSelections(payload.generationOptions)
  const shouldApplyLastOptions = !hasRuntimeSelections(payload.generationOptions)
  const runtimeSelections = mergeVideoRuntimeSelections(
    shouldApplyLastOptions ? input.lastVideoGenerationOptions : undefined,
    explicitRuntimeSelections,
  )
  runtimeSelections.generationMode = resolveVideoGenerationMode(payload)

  const resolveOptions = (selections: Record<string, CapabilityValue>) =>
    resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'video',
      modelKey,
      runtimeSelections: selections,
    })

  let resolvedOptions: Record<string, CapabilityValue>
  try {
    resolvedOptions = await resolveOptions(runtimeSelections)
  } catch (error) {
    if (!shouldApplyLastOptions) throw error
    const fallbackSelections = { ...explicitRuntimeSelections }
    fallbackSelections.generationMode = resolveVideoGenerationMode(payload)
    resolvedOptions = await resolveOptions(fallbackSelections)
  }

  const resolution = resolveBuiltinPricing({
      apiType: 'video',
      model: modelKey,
      selections: {
        ...resolvedOptions,
        ...(usesVideoTokenPricing(modelKey) ? { containsVideoInput: false } : {}),
      },
    })
  if (resolution.status === 'missing_capability_match') {
    throw new Error('PROJECT_AGENT_VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED')
  }
  return resolvedOptions
}

function buildVideoPanelBillingInfoOrThrow(payload: unknown) {
  try {
    return buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, isRecord(payload) ? payload : null)
  } catch (error) {
    if (
      error instanceof BillingOperationError
      && (
        error.code === 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
        || error.code === 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
      )
    ) {
      throw new Error('PROJECT_AGENT_VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED')
    }
    if (error instanceof BillingOperationError && error.code === 'BILLING_UNKNOWN_MODEL') {
      return null
    }
    throw error
  }
}

function buildVideoGroupBillingInfoOrThrow(payload: unknown) {
  try {
    return buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_GROUP, isRecord(payload) ? payload : null)
  } catch (error) {
    if (
      error instanceof BillingOperationError
      && (
        error.code === 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
        || error.code === 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
      )
    ) {
      throw new Error('PROJECT_AGENT_VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED')
    }
    if (error instanceof BillingOperationError && error.code === 'BILLING_UNKNOWN_MODEL') {
      return null
    }
    throw error
  }
}

function requireVideoTaskBillingInfo(taskType: typeof TASK_TYPE.VIDEO_PANEL | typeof TASK_TYPE.VIDEO_GROUP, payload: Record<string, unknown>): TaskBillingInfo {
  const billingInfo = taskType === TASK_TYPE.VIDEO_PANEL
    ? buildVideoPanelBillingInfoOrThrow(payload)
    : buildVideoGroupBillingInfoOrThrow(payload)
  if (!billingInfo || billingInfo.billable !== true) {
    throw new Error(`PROJECT_AGENT_VIDEO_BILLING_INFO_REQUIRED:${taskType}`)
  }
  return billingInfo
}

function createVideoPlannedTask(params: {
  id: string
  taskType: typeof TASK_TYPE.VIDEO_PANEL | typeof TASK_TYPE.VIDEO_GROUP
  targetType: string
  targetId: string
  payload: Record<string, unknown>
  billingInfo: TaskBillingInfo
  locale: PlannedTask['locale']
  episodeId?: string | null
  dedupeKey?: string | null
}): PlannedTask {
  return {
    id: params.id,
    taskType: params.taskType,
    target: {
      targetType: params.targetType,
      targetId: params.targetId,
    },
    payload: params.payload,
    billingInfo: params.billingInfo,
    locale: params.locale,
    episodeId: params.episodeId ?? null,
    dedupeKey: params.dedupeKey ?? null,
  }
}

async function compensateSubmittedVideoTasks(taskIds: readonly string[]): Promise<void> {
  const failed: string[] = []
  for (const taskId of taskIds) {
    try {
      await cancelTask(taskId, 'Operation batch submit failed before completion')
      await removeTaskJob(taskId).catch(() => false)
    } catch {
      failed.push(taskId)
    }
  }
  if (failed.length > 0) {
    throw new Error(`PROJECT_AGENT_VIDEO_BATCH_TASK_COMPENSATION_FAILED:${failed.join(',')}`)
  }
}

function buildVideoTaskPayload(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
}) {
  const locale = resolveLocaleFromContext(params.ctx.context.locale)
  const existingMeta = isRecord(params.input.meta) ? params.input.meta : {}
  const payload: UnknownObject = {
    ...params.input,
    meta: {
      ...existingMeta,
      locale,
    },
  }
  delete payload.confirmed
  delete payload.confirmedMaxCost

  return {
    payload,
    localeForTask: resolveRequiredTaskLocale(params.ctx.request, payload),
  }
}

async function validateVideoTaskPayloadOrThrow(params: {
  payload: UnknownObject
  projectId: string
  userId: string
  modelPurpose: VideoTaskModelPurpose
  lastVideoGenerationOptions?: unknown
}) {
  await applySystemVideoModel({
    payload: params.payload,
    projectId: params.projectId,
    userId: params.userId,
    purpose: params.modelPurpose,
  })
  requireVideoModelKeyFromPayload(params.payload)
  validateFirstLastFrameModel(params.payload.firstLastFrame)
  const resolvedOptions = await resolveVideoCapabilityOptions({
    payload: params.payload,
    projectId: params.projectId,
    userId: params.userId,
    lastVideoGenerationOptions: params.lastVideoGenerationOptions,
  })
  params.payload.generationOptions = resolvedOptions
}

function requirePanelSystemVideoDurationSec(panelId: string, duration: unknown): number {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || !Number.isInteger(duration) || duration <= 0) {
    throw new Error(`PROJECT_AGENT_PANEL_VIDEO_DURATION_REQUIRED:${panelId}`)
  }
  return duration
}

function applySystemVideoDuration(payload: UnknownObject, durationSec: number): void {
  const rawGenerationOptions = isRecord(payload.generationOptions) ? payload.generationOptions : {}
  payload.generationOptions = {
    ...rawGenerationOptions,
    duration: durationSec,
  }
}

async function executeGenerateEpisodeVideosOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGenerateEpisodeVideosOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGenerateEpisodeVideosPlan({ ...params, plan })
}

async function planGenerateEpisodeVideosOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const { payload } = buildVideoTaskPayload({ ctx: params.ctx, input: params.input })

  const episodeId = normalizeString(payload.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) {
    throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  }
  const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? payload.limit : 20

  const panels = await prisma.projectPanel.findMany({
    where: {
      storyboard: { episodeId },
      imageUrl: { not: null },
      OR: [
        { videoUrl: null },
        { videoUrl: '' },
      ],
    },
    select: { id: true, videoUrl: true, duration: true, lastVideoGenerationOptions: true },
    take: limit,
  })

  if (panels.length === 0) {
    return {
      kind: 'task_submission',
      operationId: params.operationId,
      projectId: params.ctx.projectId,
      userId: params.ctx.userId,
      tasks: [],
      metadata: {
        noop: true,
        episodeId,
        panels: [],
      },
    }
  }

  const panelPlans = await Promise.all(panels.map(async (panel) => {
    const panelPlan = await planGeneratePanelVideoOperation({
      ctx: params.ctx,
      input: {
        ...payload,
        panelId: panel.id,
      },
      operationId: params.operationId,
    })
    return {
      panel,
      plan: panelPlan,
      metadata: readPlannedPanelVideoMetadata(panelPlan),
    }
  }))

  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: panelPlans.flatMap((item) => item.plan.tasks),
    metadata: {
      episodeId,
      panels: panelPlans.map((item) => ({
        panelId: item.metadata.panelId,
        previousVideoUrl: item.metadata.previousVideoUrl,
        previousLastVideoGenerationOptions: item.metadata.previousLastVideoGenerationOptions,
      })),
    },
  }
}

async function commitGenerateEpisodeVideosPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const episodeId = isRecord(params.plan.metadata) && typeof params.plan.metadata.episodeId === 'string'
    ? params.plan.metadata.episodeId
    : normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  const panelMetadata = isRecord(params.plan.metadata) && Array.isArray(params.plan.metadata.panels)
    ? params.plan.metadata.panels.flatMap((item) => {
      if (!isRecord(item)) return []
      const panelId = normalizeString(item.panelId)
      return panelId ? [{
        panelId,
        previousVideoUrl: normalizeString(item.previousVideoUrl) || null,
        previousLastVideoGenerationOptions: item.previousLastVideoGenerationOptions,
      }] : []
    })
    : []
  if (params.plan.tasks.length === 0) {
    return {
      success: true,
      async: true,
      total: 0,
      taskIds: [],
      results: [],
      noop: true,
      reason: 'NO_PANEL_VIDEOS_TO_GENERATE',
    }
  }
  const submitted: Array<{
    task: PlannedTask
    result: Awaited<ReturnType<typeof submitPlannedOperationTask>>
  }> = []
  try {
    for (const task of params.plan.tasks) {
      const result = await submitPlannedOperationTask({
        ctx: params.ctx,
        task,
        operationId: params.operationId,
        confirmed: params.input.confirmed === true,
      })
      submitted.push({ task, result })
    }
  } catch (error) {
    await compensateSubmittedVideoTasks(submitted.map((item) => item.result.taskId))
    throw error
  }
  const taskIds = submitted.map((item) => item.result.taskId)
  const mutationBatch = await createMutationBatch({
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    source: params.ctx.source,
    operationId: params.operationId,
    episodeId,
    summary: `${params.operationId}:${episodeId}:batch`,
    entries: panelMetadata.map((panel) => ({
      kind: 'panel_video_restore',
      targetType: 'ProjectPanel',
      targetId: panel.panelId,
      payload: {
        previousVideoUrl: panel.previousVideoUrl,
        previousLastVideoGenerationOptions: panel.previousLastVideoGenerationOptions,
      },
    })),
  })
  writeOperationDataPart<TaskBatchSubmittedPartData>(params.ctx.writer, 'data-task-batch-submitted', {
    operationId: params.operationId,
    total: submitted.length,
    taskIds,
    results: submitted.map((item, index) => ({
      refId: item.task.target.targetId,
      taskId: taskIds[index] || '',
      taskType: TASK_TYPE.VIDEO_PANEL,
      targetType: 'ProjectPanel',
      targetId: item.task.target.targetId,
      billingReceipt: item.result.billingReceiptView,
    })),
    mutationBatchId: mutationBatch.id,
  })

  return {
    success: true,
    async: true,
    tasks: submitted.map((item) => item.result),
    total: submitted.length,
    taskIds,
    results: submitted.map((item, index) => ({
      refId: item.task.target.targetId,
      taskId: taskIds[index] || '',
      taskType: TASK_TYPE.VIDEO_PANEL,
      targetType: 'ProjectPanel',
      targetId: item.task.target.targetId,
    })),
    mutationBatchId: mutationBatch.id,
  }
}

function parseShotNumbersJson(value: unknown): number[] {
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

function parseEditScriptShots(value: unknown): VideoGroupShot[] {
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

async function buildEpisodeVideoBlockPlan(params: {
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

async function resolvePanelIdForVideoBlockShot(params: {
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

function readStoryboardVideoGridMode(value: unknown): VideoGridMode {
  return value === '3x3' ? '3x3' : '2x2'
}

type ExistingVideoGroupRecord = NonNullable<Awaited<ReturnType<typeof findExistingVideoGroup>>>

type PlannedVideoGroupTaskMetadata = {
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

type CommittedVideoGroupTask = {
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

function readPlannedVideoGroupMetadataList(plan: OperationPlan): PlannedVideoGroupTaskMetadata[] {
  const metadata = isRecord(plan.metadata) ? plan.metadata : {}
  const groups = Array.isArray(metadata.videoGroups) ? metadata.videoGroups : []
  return groups.map(readPlannedVideoGroupTaskMetadata)
}

function readPlannedVideoGroupMetadataByTaskId(plan: OperationPlan): Map<string, PlannedVideoGroupTaskMetadata> {
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

async function rollbackCommittedVideoGroups(committed: readonly CommittedVideoGroupTask[]): Promise<void> {
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

async function planAssetReferenceVideoBlockTask(params: {
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
  const billingInfo = requireVideoTaskBillingInfo(TASK_TYPE.VIDEO_GROUP, payload)
  return {
    task: createVideoPlannedTask({
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

async function planVideoGroupTask(params: {
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
  const billingInfo = requireVideoTaskBillingInfo(TASK_TYPE.VIDEO_GROUP, payload)
  return {
    task: createVideoPlannedTask({
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

async function commitPlannedVideoGroupTask(params: {
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
      await compensateSubmittedVideoTasks([submittedTaskId])
    }
    await rollbackVideoGroupTaskRecord({
      groupId: params.metadata.groupId,
      previous: params.metadata.previous,
    })
    throw error
  }
}

async function commitPlannedVideoGroupBatch(params: {
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
    await compensateSubmittedVideoTasks(committed.map((item) => item.result.taskId)).catch((compensationError: unknown) => {
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

async function executeGenerateVideoGroupOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGenerateVideoGroupOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGenerateVideoGroupPlan({ ...params, plan })
}

async function planGenerateVideoGroupOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const gridMode: '2x2' | '3x3' = params.input.gridMode === '3x3' ? '3x3' : '2x2'
  const shotNumbers = Array.isArray(params.input.shotNumbers)
    ? params.input.shotNumbers.map((value) => Number(value))
    : []
  const planned = await planVideoGroupTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    episodeId,
    gridMode,
    shotNumbers,
  })
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [planned.task],
    metadata: {
      episodeId,
      gridMode,
      videoGroups: [planned.metadata],
    },
  }
}

async function commitGenerateVideoGroupPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const metadata = readPlannedVideoGroupMetadataList(params.plan)[0]
  if (!metadata) throw new Error('PROJECT_AGENT_VIDEO_GROUP_PLAN_METADATA_MISSING')
  const submitted = await commitPlannedVideoGroupTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    task,
    metadata,
  })
  writeOperationDataPart<TaskSubmittedPartData>(params.ctx.writer, 'data-task-submitted', {
    operationId: params.operationId,
    taskId: submitted.result.taskId,
    status: submitted.result.status,
    runId: submitted.result.runId || null,
    deduped: submitted.result.deduped,
    billingReceipt: submitted.result.billingReceiptView,
    projectId: params.ctx.projectId,
    episodeId: submitted.metadata.episodeId,
    taskType: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: submitted.metadata.groupId,
  })
  return {
    ...submitted.result,
    groupId: submitted.metadata.groupId,
    taskType: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: submitted.metadata.groupId,
    episodeId: submitted.metadata.episodeId,
    gridMode: readStoryboardVideoGridMode(submitted.metadata.gridMode),
    shotNumbers: submitted.metadata.shotNumbers,
    durationSec: submitted.metadata.durationSec,
  }
}

async function executeGenerateEpisodeVideoGroupsOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGenerateEpisodeVideoGroupsOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGenerateEpisodeVideoGroupsPlan({ ...params, plan })
}

async function planGenerateEpisodeVideoGroupsOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const gridMode: '2x2' | '3x3' = params.input.gridMode === '3x3' ? '3x3' : '2x2'
  const editScript = await prisma.projectEditScript.findFirst({
    where: { episodeId, projectId: params.ctx.projectId },
    select: { shotsJson: true },
  })
  if (!editScript) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_REQUIRED')
  const shots = parseEditScriptShots(editScript.shotsJson)
  const chunks = chunkVideoGroupShots({
    gridMode,
    shotNumbers: shots.map((shot) => shot.shotNumber),
  })
  if (chunks.length === 0) {
    return {
      kind: 'task_submission',
      operationId: params.operationId,
      projectId: params.ctx.projectId,
      userId: params.ctx.userId,
      tasks: [],
      metadata: {
        noop: true,
        reason: 'NO_VIDEO_GROUPS_TO_GENERATE',
        episodeId,
        gridMode,
        videoGroups: [],
      },
    }
  }

  const planned = []
  for (const shotNumbers of chunks) {
    planned.push(await planVideoGroupTask({
      ctx: params.ctx,
      input: params.input,
      operationId: params.operationId,
      episodeId,
      gridMode,
      shotNumbers,
    }))
  }
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: planned.map((item) => item.task),
    metadata: {
      episodeId,
      gridMode,
      videoGroups: planned.map((item) => item.metadata),
    },
  }
}

async function commitGenerateEpisodeVideoGroupsPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const metadata = isRecord(params.plan.metadata) ? params.plan.metadata : {}
  const gridMode: VideoGridMode = readStoryboardVideoGridMode(metadata.gridMode)
  if (params.plan.tasks.length === 0) {
    return {
      success: true,
      async: true,
      total: 0,
      taskIds: [],
      results: [],
      noop: true,
      reason: normalizeString(metadata.reason) || 'NO_VIDEO_GROUPS_TO_GENERATE',
      gridMode,
    }
  }
  const submitted = await commitPlannedVideoGroupBatch(params)
  const taskIds = submitted.map((item) => item.result.taskId)
  writeOperationDataPart<TaskBatchSubmittedPartData>(params.ctx.writer, 'data-task-batch-submitted', {
    operationId: params.operationId,
    total: submitted.length,
    taskIds,
    results: submitted.map((item) => ({
      refId: item.metadata.groupId,
      taskId: item.result.taskId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: item.metadata.groupId,
      billingReceipt: item.result.billingReceiptView,
    })),
  })
  return {
    success: true,
    async: true,
    total: submitted.length,
    taskIds,
    results: submitted.map((item) => ({
      refId: item.metadata.groupId,
      taskId: item.result.taskId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: item.metadata.groupId,
      shotNumbers: item.metadata.shotNumbers,
      durationSec: item.metadata.durationSec,
    })),
    gridMode,
  }
}

async function executeGenerateEpisodeVideosAutoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGenerateEpisodeVideosAutoOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGenerateEpisodeVideosAutoPlan({ ...params, plan })
}

async function planGenerateEpisodeVideosAutoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')

  const [singleVideoModel, groupVideoModel] = await Promise.all([
    resolveSystemModelKey({
      userId: params.ctx.userId,
      projectId: params.ctx.projectId,
      purpose: 'single-shot-video',
    }),
    resolveSystemModelKey({
      userId: params.ctx.userId,
      projectId: params.ctx.projectId,
      purpose: 'sequence-video',
    }),
  ])
  const planned = await buildEpisodeVideoBlockPlan({
    ctx: params.ctx,
    episodeId,
  })

  const tasks: PlannedTask[] = []
  const items: Array<{
    readonly planTaskId: string
    readonly kind: VideoBlockPlanItem['kind']
    readonly refId: string
    readonly taskType: typeof TASK_TYPE.VIDEO_PANEL | typeof TASK_TYPE.VIDEO_GROUP
    readonly targetType: 'ProjectPanel' | 'ProjectVideoGroup'
    readonly shotNumbers: number[]
    readonly durationSec?: number
  }> = []
  const panelMetadata: Array<PlannedPanelVideoMetadata & { planTaskId: string }> = []
  const videoGroups: PlannedVideoGroupTaskMetadata[] = []

  for (const item of planned.plan.items) {
    if (item.kind === 'single') {
      const panelId = await resolvePanelIdForVideoBlockShot({
        episodeId,
        shotNumber: item.shotNumbers[0],
      })
      const panelPlan = await planGeneratePanelVideoOperation({
        ctx: params.ctx,
        input: {
          confirmed: params.input.confirmed,
          panelId,
          customPrompt: item.prompt,
          generationOptions: params.input.generationOptions,
        },
        operationId: params.operationId,
      })
      const task = panelPlan.tasks[0]
      if (!task) throw new Error('PROJECT_AGENT_AUTO_VIDEO_PANEL_PLAN_EMPTY')
      tasks.push(task)
      const metadata = readPlannedPanelVideoMetadata(panelPlan)
      panelMetadata.push({
        ...metadata,
        planTaskId: task.id,
      })
      items.push({
        planTaskId: task.id,
        refId: panelId,
        taskType: TASK_TYPE.VIDEO_PANEL,
        targetType: 'ProjectPanel',
        kind: 'single',
        shotNumbers: [...item.shotNumbers],
      })
      continue
    }

    if (!item.gridMode) throw new Error('PROJECT_AGENT_AUTO_VIDEO_GROUP_GRID_MODE_REQUIRED')
    const groupPlan = await planVideoGroupTask({
      ctx: params.ctx,
      input: {
        confirmed: params.input.confirmed,
        confirmedMaxCost: params.input.confirmedMaxCost,
        generationOptions: params.input.generationOptions,
      },
      operationId: params.operationId,
      episodeId,
      gridMode: item.gridMode,
      shotNumbers: item.shotNumbers,
    })
    tasks.push(groupPlan.task)
    videoGroups.push(groupPlan.metadata)
    items.push({
      planTaskId: groupPlan.task.id,
      refId: groupPlan.metadata.groupId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      kind: 'group',
      shotNumbers: [...groupPlan.metadata.shotNumbers],
      durationSec: groupPlan.metadata.durationSec,
    })
  }

  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks,
    metadata: {
      episodeId,
      items,
      panels: panelMetadata,
      videoGroups,
      videoBlockItems: planned.plan.items.map((item) => ({
        ...item,
        shotNumbers: [...item.shotNumbers],
      })),
      singleVideoModel,
      groupVideoModel,
    },
  }
}

async function commitGenerateEpisodeVideosAutoPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const metadata = isRecord(params.plan.metadata) ? params.plan.metadata : {}
  const episodeId = normalizeString(metadata.episodeId) || normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  const rawItems = Array.isArray(metadata.items) ? metadata.items : []
  const items = rawItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const planTaskId = normalizeString(item.planTaskId)
    const refId = normalizeString(item.refId)
    const kind: 'single' | 'group' = item.kind === 'group' ? 'group' : 'single'
    const targetType = item.targetType === 'ProjectVideoGroup' ? 'ProjectVideoGroup' : 'ProjectPanel'
    const taskType = item.taskType === TASK_TYPE.VIDEO_GROUP ? TASK_TYPE.VIDEO_GROUP : TASK_TYPE.VIDEO_PANEL
    if (!planTaskId || !refId) return []
    return [{
      planTaskId,
      refId,
      kind,
      targetType,
      taskType,
      shotNumbers: parseShotNumbersJson(item.shotNumbers),
      durationSec: typeof item.durationSec === 'number' && Number.isInteger(item.durationSec) ? item.durationSec : undefined,
    }]
  })
  const itemByTaskId = new Map(items.map((item) => [item.planTaskId, item]))
  const videoBlockItems: Array<{
    kind: 'single' | 'group'
    shotNumbers: number[]
    reason: string
    prompt: string
    gridMode?: VideoGridMode
  }> = Array.isArray(metadata.videoBlockItems)
    ? metadata.videoBlockItems.flatMap((item) => {
      if (!isRecord(item)) return []
      const kind: 'single' | 'group' = item.kind === 'group' ? 'group' : 'single'
      const shotNumbers = parseShotNumbersJson(item.shotNumbers)
      const reason = normalizeString(item.reason)
      const prompt = normalizeString(item.prompt)
      const gridMode = item.gridMode === '2x2' || item.gridMode === '3x3' ? item.gridMode : undefined
      if (shotNumbers.length === 0 || !reason || !prompt) return []
      return [{
        kind,
        shotNumbers,
        reason,
        prompt,
        ...(gridMode ? { gridMode } : {}),
      }]
    })
    : []
  const panelMetadata = Array.isArray(metadata.panels)
    ? metadata.panels.flatMap((item) => {
      if (!isRecord(item)) return []
      const panelId = normalizeString(item.panelId)
      const planTaskId = normalizeString(item.planTaskId)
      return panelId && planTaskId ? [{
        planTaskId,
        panelId,
        previousVideoUrl: normalizeString(item.previousVideoUrl) || null,
        previousLastVideoGenerationOptions: item.previousLastVideoGenerationOptions,
      }] : []
    })
    : []
  const videoGroupMetadataByTaskId = readPlannedVideoGroupMetadataByTaskId(params.plan)
  const submitted: Array<{
    task: PlannedTask
    result: Awaited<ReturnType<typeof submitPlannedOperationTask>>
  }> = []
  const committedGroups: CommittedVideoGroupTask[] = []
  try {
    for (const task of params.plan.tasks) {
      const item = itemByTaskId.get(task.id)
      if (!item) throw new Error(`PROJECT_AGENT_AUTO_VIDEO_PLAN_ITEM_MISSING:${task.id}`)
      if (item.taskType === TASK_TYPE.VIDEO_GROUP) {
        const groupMetadata = videoGroupMetadataByTaskId.get(task.id)
        if (!groupMetadata) throw new Error(`PROJECT_AGENT_AUTO_VIDEO_GROUP_METADATA_MISSING:${task.id}`)
        const committed = await commitPlannedVideoGroupTask({
          ctx: params.ctx,
          input: params.input,
          operationId: params.operationId,
          task,
          metadata: groupMetadata,
        })
        committedGroups.push(committed)
        submitted.push({ task, result: committed.result })
        continue
      }
      const result = await submitPlannedOperationTask({
        ctx: params.ctx,
        task,
        operationId: params.operationId,
        confirmed: params.input.confirmed === true,
      })
      submitted.push({ task, result })
    }
  } catch (error) {
    const failures: string[] = []
    await compensateSubmittedVideoTasks(submitted.map((item) => item.result.taskId)).catch((compensationError: unknown) => {
      failures.push(compensationError instanceof Error ? compensationError.message : String(compensationError))
    })
    await rollbackCommittedVideoGroups(committedGroups).catch((rollbackError: unknown) => {
      failures.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
    })
    if (failures.length > 0) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`PROJECT_AGENT_AUTO_VIDEO_BATCH_COMPENSATION_FAILED:${message}:${failures.join(';')}`)
    }
    throw error
  }

  const taskIds = submitted.map((item) => item.result.taskId)
  const mutationBatch = panelMetadata.length > 0
    ? await createMutationBatch({
      projectId: params.ctx.projectId,
      userId: params.ctx.userId,
      source: params.ctx.source,
      operationId: params.operationId,
      episodeId,
      summary: `${params.operationId}:${episodeId}:auto`,
      entries: panelMetadata.map((panel) => ({
        kind: 'panel_video_restore',
        targetType: 'ProjectPanel',
        targetId: panel.panelId,
        payload: {
          previousVideoUrl: panel.previousVideoUrl,
          previousLastVideoGenerationOptions: panel.previousLastVideoGenerationOptions,
        },
      })),
    })
    : null

  writeOperationDataPart<TaskBatchSubmittedPartData>(params.ctx.writer, 'data-task-batch-submitted', {
    operationId: params.operationId,
    total: submitted.length,
    taskIds,
    results: submitted.map((item, index) => {
      const plannedItem = itemByTaskId.get(item.task.id)
      return {
        refId: plannedItem?.refId ?? item.task.target.targetId,
        taskId: taskIds[index] || '',
        taskType: item.task.taskType,
        targetType: item.task.target.targetType,
        targetId: item.task.target.targetId,
        billingReceipt: item.result.billingReceiptView,
      }
    }),
    mutationBatchId: mutationBatch?.id ?? null,
  })

  return {
    success: true,
    async: true,
    total: submitted.length,
    taskIds,
    results: submitted.map((item, index) => {
      const plannedItem = itemByTaskId.get(item.task.id)
      return {
        refId: plannedItem?.refId ?? item.task.target.targetId,
        taskId: taskIds[index] || '',
        taskType: item.task.taskType,
        targetType: item.task.target.targetType,
        targetId: item.task.target.targetId,
        kind: plannedItem?.kind ?? ('single' as const),
        shotNumbers: plannedItem?.shotNumbers ?? [],
        durationSec: plannedItem?.durationSec,
      }
    }),
    plan: {
      items: videoBlockItems,
    },
    singleVideoModel: normalizeString(metadata.singleVideoModel),
    groupVideoModel: normalizeString(metadata.groupVideoModel),
    mutationBatchId: mutationBatch?.id ?? undefined,
  }
}

async function executeGenerateAssetReferenceVideoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGenerateAssetReferenceVideoOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGenerateAssetReferenceVideoPlan({ ...params, plan })
}

async function planGenerateAssetReferenceVideoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const blockIndex = typeof params.input.blockIndex === 'number' && Number.isInteger(params.input.blockIndex)
    ? params.input.blockIndex
    : -1
  if (blockIndex < 0) throw new Error('PROJECT_AGENT_ASSET_REFERENCE_BLOCK_REQUIRED')
  const planned = await buildEpisodeVideoBlockPlan({
    ctx: params.ctx,
    episodeId,
  })
  const item = planned.plan.items[blockIndex]
  if (!item) throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_BLOCK_NOT_FOUND:${blockIndex}`)

  const plannedTask = await planAssetReferenceVideoBlockTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    episodeId,
    item,
    shots: planned.shots,
    blockIndex,
  })
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [plannedTask.task],
    metadata: {
      episodeId,
      sourceMode: 'asset_reference',
      blockIndex,
      videoGroups: [plannedTask.metadata],
    },
  }
}

async function commitGenerateAssetReferenceVideoPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const metadata = isRecord(params.plan.metadata) ? params.plan.metadata : {}
  const blockIndex = typeof metadata.blockIndex === 'number' && Number.isInteger(metadata.blockIndex)
    ? metadata.blockIndex
    : -1
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const groupMetadata = readPlannedVideoGroupMetadataList(params.plan)[0]
  if (!groupMetadata) throw new Error('PROJECT_AGENT_VIDEO_GROUP_PLAN_METADATA_MISSING')
  const submitted = await commitPlannedVideoGroupTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    task,
    metadata: groupMetadata,
  })
  writeOperationDataPart<TaskSubmittedPartData>(params.ctx.writer, 'data-task-submitted', {
    operationId: params.operationId,
    taskId: submitted.result.taskId,
    status: submitted.result.status,
    runId: submitted.result.runId || null,
    deduped: submitted.result.deduped,
    billingReceipt: submitted.result.billingReceiptView,
    projectId: params.ctx.projectId,
    episodeId: groupMetadata.episodeId,
    taskType: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: groupMetadata.groupId,
  })
  return {
    ...submitted.result,
    groupId: groupMetadata.groupId,
    taskType: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: groupMetadata.groupId,
    episodeId: groupMetadata.episodeId,
    sourceMode: 'asset_reference' as const,
    blockIndex,
    shotNumbers: groupMetadata.shotNumbers,
    durationSec: groupMetadata.durationSec,
  }
}

async function executeGenerateEpisodeAssetReferenceVideosOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGenerateEpisodeAssetReferenceVideosOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGenerateEpisodeAssetReferenceVideosPlan({ ...params, plan })
}

async function planGenerateEpisodeAssetReferenceVideosOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const planned = await buildEpisodeVideoBlockPlan({
    ctx: params.ctx,
    episodeId,
  })

  const plannedTasks = []
  for (const [blockIndex, item] of planned.plan.items.entries()) {
    plannedTasks.push(await planAssetReferenceVideoBlockTask({
      ctx: params.ctx,
      input: params.input,
      operationId: params.operationId,
      episodeId,
      item,
      shots: planned.shots,
      blockIndex,
    }))
  }
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: plannedTasks.map((item) => item.task),
    metadata: {
      episodeId,
      sourceMode: 'asset_reference',
      videoGroups: plannedTasks.map((item) => item.metadata),
    },
  }
}

async function commitGenerateEpisodeAssetReferenceVideosPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const submitted = await commitPlannedVideoGroupBatch(params)
  const taskIds = submitted.map((item) => item.result.taskId)
  writeOperationDataPart<TaskBatchSubmittedPartData>(params.ctx.writer, 'data-task-batch-submitted', {
    operationId: params.operationId,
    total: submitted.length,
    taskIds,
    results: submitted.map((item) => ({
      refId: item.metadata.groupId,
      taskId: item.result.taskId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: item.metadata.groupId,
      billingReceipt: item.result.billingReceiptView,
    })),
  })

  return {
    success: true,
    async: true,
    total: submitted.length,
    taskIds,
    results: submitted.map((item) => ({
      refId: item.metadata.groupId,
      taskId: item.result.taskId,
      taskType: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: item.metadata.groupId,
      shotNumbers: item.metadata.shotNumbers,
      durationSec: item.metadata.durationSec,
    })),
    sourceMode: 'asset_reference' as const,
  }
}

type PlannedPanelVideoMetadata = {
  panelId: string
  episodeId: string | null
  previousVideoUrl: string | null
  previousLastVideoGenerationOptions: unknown
}

function readPlannedPanelVideoMetadata(plan: OperationPlan): PlannedPanelVideoMetadata {
  const metadata = isRecord(plan.metadata) ? plan.metadata : {}
  const panelId = normalizeString(metadata.panelId)
  if (!panelId) throw new Error('PROJECT_AGENT_PANEL_VIDEO_PLAN_METADATA_INVALID')
  return {
    panelId,
    episodeId: normalizeString(metadata.episodeId) || null,
    previousVideoUrl: normalizeString(metadata.previousVideoUrl) || null,
    previousLastVideoGenerationOptions: metadata.previousLastVideoGenerationOptions,
  }
}

async function planGeneratePanelVideoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const { payload, localeForTask } = buildVideoTaskPayload({ ctx: params.ctx, input: params.input })
  let panelId = normalizeString(payload.panelId)
  let previousVideoUrl: string | null = null
  let previousLastVideoGenerationOptions: unknown = null
  let episodeId: string | null = null
  if (!panelId) {
    const storyboardId = normalizeString(payload.storyboardId)
    const panelIndex = typeof payload.panelIndex === 'number' ? payload.panelIndex : NaN
    if (!storyboardId || !Number.isFinite(panelIndex)) {
      throw new Error('PROJECT_AGENT_PANEL_REQUIRED')
    }
    const panel = await prisma.projectPanel.findFirst({
      where: { storyboardId, panelIndex: Number(panelIndex) },
      select: { id: true, videoUrl: true, duration: true, lastVideoGenerationOptions: true, storyboard: { select: { episodeId: true } } },
    })
    panelId = panel?.id || ''
    previousVideoUrl = panel?.videoUrl ?? null
    previousLastVideoGenerationOptions = panel?.lastVideoGenerationOptions ?? null
    episodeId = panel?.storyboard.episodeId ?? null
    if (panel) applySystemVideoDuration(payload, requirePanelSystemVideoDurationSec(panel.id, panel.duration))
  }
  if (!panelId) {
    throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
  }
  if (normalizeString(payload.panelId)) {
    const panel = await prisma.projectPanel.findUnique({
      where: { id: panelId },
      select: { videoUrl: true, duration: true, lastVideoGenerationOptions: true, storyboard: { select: { episodeId: true } } },
    })
    if (!panel) {
      throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
    }
    previousVideoUrl = panel.videoUrl ?? null
    previousLastVideoGenerationOptions = panel.lastVideoGenerationOptions ?? null
    episodeId = panel.storyboard.episodeId
    applySystemVideoDuration(payload, requirePanelSystemVideoDurationSec(panelId, panel.duration))
  }

  await validateVideoTaskPayloadOrThrow({
    payload,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    modelPurpose: 'single-shot-video',
    lastVideoGenerationOptions: previousLastVideoGenerationOptions,
  })

  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [
      createVideoPlannedTask({
        id: `${params.operationId}:${panelId}`,
        taskType: TASK_TYPE.VIDEO_PANEL,
        targetType: 'ProjectPanel',
        targetId: panelId,
        locale: localeForTask,
        episodeId,
        payload: withTaskUiPayload(payload, {
          hasOutputAtStart: await hasPanelVideoOutput(panelId),
        }),
        dedupeKey: `video_panel:${panelId}`,
        billingInfo: requireVideoTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, payload),
      }),
    ],
    metadata: {
      panelId,
      episodeId,
      previousVideoUrl,
      previousLastVideoGenerationOptions,
    },
  }
}

async function commitGeneratePanelVideoPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const metadata = readPlannedPanelVideoMetadata(params.plan)
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
    episodeId: metadata.episodeId,
    summary: `${params.operationId}:${metadata.panelId}`,
    entries: [
      {
        kind: 'panel_video_restore',
        targetType: 'ProjectPanel',
        targetId: metadata.panelId,
        payload: {
          previousVideoUrl: metadata.previousVideoUrl,
          previousLastVideoGenerationOptions: metadata.previousLastVideoGenerationOptions,
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
    episodeId: metadata.episodeId,
    taskType: TASK_TYPE.VIDEO_PANEL,
    targetType: 'ProjectPanel',
    targetId: metadata.panelId,
  })

  return {
    ...result,
    panelId: metadata.panelId,
    taskType: TASK_TYPE.VIDEO_PANEL,
    targetType: 'ProjectPanel',
    targetId: metadata.panelId,
    mutationBatchId: mutationBatch.id,
  }
}

async function executeGeneratePanelVideoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}) {
  const plan = await planGeneratePanelVideoOperation(params)
  await assertOperationPlanConfirmedCost({
    plan,
    confirmedMaxCost: await resolveConfirmedMaxCostForExecution({
      ctx: params.ctx,
      input: params.input,
      plan,
    }),
  })
  return await commitGeneratePanelVideoPlan({ ...params, plan })
}

const generatePanelVideoInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  panelId: z.string().min(1).optional(),
  storyboardId: z.string().min(1).optional(),
  panelIndex: z.number().int().min(0).max(2000).optional(),
  firstLastFrame: z.unknown().optional(),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().refine((value) => Boolean(value.panelId || (value.storyboardId && typeof value.panelIndex === 'number')), {
  message: 'panelId or (storyboardId + panelIndex) is required',
  path: ['panelId'],
})

const generateEpisodeVideosInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(50).optional(),
  firstLastFrame: z.unknown().optional(),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateVideoGroupInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  gridMode: z.enum(VIDEO_GRID_MODES),
  shotNumbers: z.array(z.number().int().positive()).min(1).max(9),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateEpisodeVideoGroupsInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  gridMode: z.enum(VIDEO_GRID_MODES),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateEpisodeVideosAutoInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateAssetReferenceVideoInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  blockIndex: z.number().int().min(0).max(59),
  referenceImageUrls: z.array(z.string().trim().min(1)).min(1).max(8),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const generateEpisodeAssetReferenceVideosInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  referenceImageUrls: z.array(z.string().trim().min(1)).min(1).max(8),
  generationOptions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export function createVideoGenerationOperations(): ProjectAgentOperationRegistryDraft {
  const generatePanelVideoOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      mutationBatchId: z.string().min(1),
      panelId: z.string().min(1),
    }).passthrough(),
  )

  const generateEpisodeVideosOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
      }).passthrough()),
    }).passthrough(),
  )

  const generateVideoGroupOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      groupId: z.string().min(1),
      episodeId: z.string().min(1),
      gridMode: z.enum(VIDEO_GRID_MODES),
      shotNumbers: z.array(z.number().int().positive()),
      durationSec: z.number().int().positive(),
    }).passthrough(),
  )

  const generateEpisodeVideoGroupsOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        shotNumbers: z.array(z.number().int().positive()),
        durationSec: z.number().int().positive(),
      }).passthrough()),
      gridMode: z.enum(VIDEO_GRID_MODES),
    }).passthrough(),
  )

  const generateEpisodeVideosAutoOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        kind: z.enum(['single', 'group']),
        shotNumbers: z.array(z.number().int().positive()),
        durationSec: z.number().int().positive().optional(),
      }).passthrough()),
      singleVideoModel: z.string().min(1),
      groupVideoModel: z.string().min(1),
      plan: z.object({
        items: z.array(z.object({
          kind: z.enum(['single', 'group']),
          shotNumbers: z.array(z.number().int().positive()),
          gridMode: z.enum(VIDEO_GRID_MODES).optional(),
          reason: z.string().min(1),
          prompt: z.string().min(1),
        })),
      }),
    }).passthrough(),
  )

  const generateAssetReferenceVideoOutputSchema = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      groupId: z.string().min(1),
      episodeId: z.string().min(1),
      sourceMode: z.literal('asset_reference'),
      blockIndex: z.number().int().min(0),
      shotNumbers: z.array(z.number().int().positive()),
      durationSec: z.number().int().positive(),
    }).passthrough(),
  )

  const generateEpisodeAssetReferenceVideosOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      results: z.array(z.object({
        refId: z.string().min(1),
        taskId: z.string().min(1),
        shotNumbers: z.array(z.number().int().positive()),
        durationSec: z.number().int().positive(),
      }).passthrough()),
      sourceMode: z.literal('asset_reference'),
    }).passthrough(),
  )

  return {
    generate_panel_video: defineOperation({
      id: 'generate_panel_video',
      summary: 'Generate video for a single storyboard panel.',
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
        summary: '将为单个分镜格生成视频（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generatePanelVideoInputSchema,
      outputSchema: generatePanelVideoOutputSchema,
      plan: async (ctx, input) => planGeneratePanelVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_panel_video',
      }),
      commit: async (ctx, input, plan) => commitGeneratePanelVideoPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_panel_video',
        plan,
      }),
      execute: async (ctx, input) => executeGeneratePanelVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_panel_video',
      }),
    }),

    generate_episode_videos: defineOperation({
      id: 'generate_episode_videos',
      summary: 'Batch generate videos for pending panels in an episode.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将为整集待生成分镜批量生成视频（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeVideosInputSchema,
      outputSchema: generateEpisodeVideosOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeVideosPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos',
      }),
    }),

    generate_video_group: defineOperation({
      id: 'generate_video_group',
      summary: 'Generate one continuous video segment from ordered storyboard reference images.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
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
        summary: '将使用一组有序分镜参考图生成连续视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateVideoGroupInputSchema,
      outputSchema: generateVideoGroupOutputSchema,
      plan: async (ctx, input) => planGenerateVideoGroupOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_video_group',
      }),
      commit: async (ctx, input, plan) => commitGenerateVideoGroupPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_video_group',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateVideoGroupOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_video_group',
      }),
    }),

    generate_episode_video_groups: defineOperation({
      id: 'generate_episode_video_groups',
      summary: 'Batch generate continuous video segments for an episode.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将按剪辑先行顺序批量生成连续视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeVideoGroupsInputSchema,
      outputSchema: generateEpisodeVideoGroupsOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeVideoGroupsOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_video_groups',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeVideoGroupsPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_video_groups',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeVideoGroupsOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_video_groups',
      }),
    }),

    generate_episode_videos_auto: defineOperation({
      id: 'generate_episode_videos_auto',
      summary: 'Generate episode videos from edit-first videoBlocks, using single-shot tasks and Seedance 2.0 continuous groups.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将按剪辑先行表中的视频片段提交单镜头和 Seedance 2.0 连续片段任务（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeVideosAutoInputSchema,
      outputSchema: generateEpisodeVideosAutoOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeVideosAutoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos_auto',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeVideosAutoPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos_auto',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeVideosAutoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_videos_auto',
      }),
    }),

    generate_asset_reference_video: defineOperation({
      id: 'generate_asset_reference_video',
      summary: 'Generate one edit-first video block directly from reference assets and text prompt.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
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
        summary: '将使用参考资产图和剪辑先行提示词直接生成一个视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateAssetReferenceVideoInputSchema,
      outputSchema: generateAssetReferenceVideoOutputSchema,
      plan: async (ctx, input) => planGenerateAssetReferenceVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_asset_reference_video',
      }),
      commit: async (ctx, input, plan) => commitGenerateAssetReferenceVideoPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_asset_reference_video',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateAssetReferenceVideoOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_asset_reference_video',
      }),
    }),

    generate_episode_asset_reference_videos: defineOperation({
      id: 'generate_episode_asset_reference_videos',
      summary: 'Batch generate edit-first video blocks directly from reference assets and text prompts.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将使用参考资产图和剪辑先行提示词批量直接生成视频片段（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: generateEpisodeAssetReferenceVideosInputSchema,
      outputSchema: generateEpisodeAssetReferenceVideosOutputSchema,
      plan: async (ctx, input) => planGenerateEpisodeAssetReferenceVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_asset_reference_videos',
      }),
      commit: async (ctx, input, plan) => commitGenerateEpisodeAssetReferenceVideosPlan({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_asset_reference_videos',
        plan,
      }),
      execute: async (ctx, input) => executeGenerateEpisodeAssetReferenceVideosOperation({
        ctx,
        input: input as UnknownObject,
        operationId: 'generate_episode_asset_reference_videos',
      }),
    }),
  }
}
ensureAiCatalogsRegistered()
