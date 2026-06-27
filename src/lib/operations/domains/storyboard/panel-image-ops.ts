import { createHash, randomUUID } from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { cancelTask } from '@/lib/task/service'
import { removeTaskJob } from '@/lib/task/queues'
import {
  buildImageBillingPayload,
  getProjectModelConfig,
} from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { hasPanelImageOutput } from '@/lib/task/has-output'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
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
import {
  refineTaskSubmitOperationOutputSchema,
  refineTaskBatchSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { sanitizeImageInputsForTaskPayload } from '@/lib/media/outbound-image'
import {
  normalizeStoryboardPanelImageGenerationMode,
  planStoryboardPanelImageSubmissionGroups,
} from '@/lib/storyboard/grid-image-groups'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveLocaleFromContext(locale?: unknown): string {
  const normalized = normalizeString(locale)
  return normalized || 'zh'
}

function resolveCandidateCount(input?: unknown): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(4, Math.trunc(parsed)))
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input
    .map((item) => normalizeString(item))
    .filter(Boolean)))
}

type ReferenceImageNoteInput = {
  source: string
  label: string
  instruction: string
  url?: string
  referencePanelId?: string
}

function normalizeReferenceImageNotes(input: unknown): ReferenceImageNoteInput[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!isRecord(item)) return null
      const source = normalizeString(item.source) || 'custom'
      const label = normalizeString(item.label)
      const instruction = normalizeString(item.instruction)
      const url = normalizeString(item.url)
      const referencePanelId = normalizeString(item.referencePanelId)
      if (!label && !instruction && !url && !referencePanelId) return null
      return {
        source,
        label,
        instruction,
        ...(url ? { url } : {}),
        ...(referencePanelId ? { referencePanelId } : {}),
      }
    })
    .filter((item): item is ReferenceImageNoteInput => Boolean(item))
    .slice(0, 16)
}

function formatReferenceImageNote(note: ReferenceImageNoteInput | undefined, fallback: string): string {
  if (!note) return fallback
  const parts = [
    note.source ? `source=${note.source}` : '',
    note.label ? `label=${note.label}` : '',
    note.instruction ? `usage=${note.instruction}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('; ') : fallback
}

function createReferenceSignature(input: unknown): string {
  const serialized = JSON.stringify(input)
  return createHash('sha1').update(serialized).digest('hex').slice(0, 12)
}

function createTaskDedupeKey(prefix: string, input: unknown): string {
  const serialized = JSON.stringify(input)
  const digest = createHash('sha1').update(serialized).digest('hex').slice(0, 32)
  return `${prefix}:${digest}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

function createPanelVariantId(): string {
  try {
    return randomUUID()
  } catch {
    return `panel-variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function requireTaskBillingInfo(taskType: typeof TASK_TYPE.IMAGE_PANEL | typeof TASK_TYPE.PANEL_VARIANT, payload: Record<string, unknown>): TaskBillingInfo {
  const billingInfo = buildDefaultTaskBillingInfo(taskType, payload)
  if (!billingInfo || billingInfo.billable !== true) {
    throw new Error(`PROJECT_AGENT_MEDIA_BILLING_INFO_REQUIRED:${taskType}`)
  }
  return billingInfo
}

function createPlannedTask(params: {
  id: string
  taskType: typeof TASK_TYPE.IMAGE_PANEL | typeof TASK_TYPE.PANEL_VARIANT
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

async function compensateSubmittedTasks(taskIds: readonly string[]): Promise<void> {
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
    throw new Error(`PROJECT_AGENT_BATCH_TASK_COMPENSATION_FAILED:${failed.join(',')}`)
  }
}

async function rollbackCreatedVariantPanel(params: {
  panelId: string
  storyboardId: string
  panelIndex: number
}) {
  await prisma.$transaction(async (tx) => {
    await tx.projectPanel.delete({
      where: { id: params.panelId },
    })

    const maxPanel = await tx.projectPanel.findFirst({
      where: { storyboardId: params.storyboardId },
      orderBy: { panelIndex: 'desc' },
      select: { panelIndex: true },
    })
    const maxPanelIndex = maxPanel?.panelIndex ?? -1
    const offset = maxPanelIndex + 1000

    await tx.projectPanel.updateMany({
      where: {
        storyboardId: params.storyboardId,
        panelIndex: { gt: params.panelIndex },
      },
      data: {
        panelIndex: { increment: offset },
        panelNumber: { increment: offset },
      },
    })

    await tx.projectPanel.updateMany({
      where: {
        storyboardId: params.storyboardId,
        panelIndex: { gt: params.panelIndex + offset },
      },
      data: {
        panelIndex: { decrement: offset + 1 },
        panelNumber: { decrement: offset + 1 },
      },
    })

    const panelCount = await tx.projectPanel.count({
      where: { storyboardId: params.storyboardId },
    })

    await tx.projectStoryboard.update({
      where: { id: params.storyboardId },
      data: { panelCount },
    })
  })
}

type RegeneratePanelImageInput = {
  confirmed?: boolean
  confirmedMaxCost?: number
  panelId?: string
  storyboardId?: string
  panelIndex?: number
  count?: number
  referenceMode?: 'asset' | 'storyboard'
  referencePanelIds?: string[]
  extraImageUrls?: unknown[]
  referenceImageNotes?: unknown[]
}

async function planRegeneratePanelImageOperation(
  ctx: ProjectAgentOperationContext,
  input: RegeneratePanelImageInput,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input as Record<string, unknown>)
  const locale = resolveLocaleFromContext(ctx.context.locale)

  let panelId = normalizeString(input.panelId)
  if (!panelId) {
    const storyboardId = normalizeString(input.storyboardId)
    const panelIndex = typeof input.panelIndex === 'number' ? input.panelIndex : NaN
    if (!storyboardId || !Number.isFinite(panelIndex)) {
      throw new Error('PROJECT_AGENT_PANEL_REQUIRED')
    }
    const panel = await prisma.projectPanel.findFirst({
      where: {
        storyboardId,
        panelIndex,
      },
      select: { id: true },
    })
    panelId = panel?.id || ''
  }

  if (!panelId) {
    throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
  }

  const candidateCount = resolveCandidateCount(input.count)
  const referencePanelIds = normalizeStringArray(input.referencePanelIds).slice(0, 8)
  const referencePanelImageUrls: string[] = []
  if (referencePanelIds.length > 0) {
    const referencePanels = await prisma.projectPanel.findMany({
      where: {
        id: { in: referencePanelIds },
        storyboard: {
          episode: {
            projectId: ctx.projectId,
          },
        },
      },
      select: {
        id: true,
        imageUrl: true,
      },
    })
    const panelById = new Map(referencePanels.map((panel) => [panel.id, panel]))
    for (const referencePanelId of referencePanelIds) {
      const referencePanel = panelById.get(referencePanelId)
      if (!referencePanel || !referencePanel.imageUrl) {
        throw new Error('PROJECT_AGENT_REFERENCE_PANEL_NOT_FOUND')
      }
      referencePanelImageUrls.push(referencePanel.imageUrl)
    }
  }

  const extraImageAudit = sanitizeImageInputsForTaskPayload(
    Array.isArray(input.extraImageUrls) ? input.extraImageUrls : [],
  )
  if (extraImageAudit.issues.some((issue) => (issue as { reason?: unknown }).reason === 'relative_path_rejected')) {
    throw new Error('PROJECT_AGENT_REFERENCE_IMAGE_INVALID')
  }
  const rawReferenceNotes = normalizeReferenceImageNotes(input.referenceImageNotes)
  const notesByPanelId = new Map(rawReferenceNotes
    .filter((note) => note.referencePanelId)
    .map((note) => [note.referencePanelId!, note]))
  const notesByUrl = new Map(rawReferenceNotes
    .filter((note) => note.url)
    .map((note) => [note.url!, note]))
  const referenceImageNotes = [
    ...referencePanelIds.map((referencePanelId, index) => formatReferenceImageNote(
      notesByPanelId.get(referencePanelId),
      `source=storyboard; label=previous storyboard panel ${index + 1}; usage=Use this previous storyboard panel as continuity reference for staging, placement, and spatial relationship.`,
    )),
    ...extraImageAudit.normalized.map((url, index) => formatReferenceImageNote(
      notesByUrl.get(url),
      `source=custom; label=extra reference ${index + 1}; usage=Use this extra image only as directed by the user reference note.`,
    )),
  ].slice(0, 16)
  const referenceSignature = createReferenceSignature({
    referenceMode: input.referenceMode === 'storyboard' ? 'storyboard' : 'asset',
    referencePanelIds,
    referencePanelImageUrls,
    extraImageUrls: extraImageAudit.normalized,
    referenceImageNotes,
  })
  const body = {
    panelId,
    candidateCount,
    count: candidateCount,
    referenceMode: input.referenceMode === 'storyboard' ? 'storyboard' : 'asset',
    ...(referencePanelIds.length > 0 ? { referencePanelIds } : {}),
    ...(referencePanelImageUrls.length > 0 ? { referencePanelImageUrls } : {}),
    ...(extraImageAudit.normalized.length > 0 ? { extraImageUrls: extraImageAudit.normalized } : {}),
    ...(referenceImageNotes.length > 0 ? { referenceImageNotes } : {}),
    meta: {
      locale,
      ...(extraImageAudit.issues.length > 0 ? { outboundImageInputAudit: { extraImageUrls: extraImageAudit.issues } } : {}),
    },
  }

  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  if (!projectModelConfig.storyboardModel) {
    throw new Error('STORYBOARD_MODEL_NOT_CONFIGURED')
  }
  await resolveModelSelection(ctx.userId, projectModelConfig.storyboardModel, 'image')

  const billingPayload = await buildImageBillingPayload({
    projectId: ctx.projectId,
    userId: ctx.userId,
    imageModel: projectModelConfig.storyboardModel,
    basePayload: body,
    aspectRatio: projectModelConfig.videoRatio,
  })

  const hasOutputAtStart = await hasPanelImageOutput(panelId)
  const taskLocale = resolveRequiredTaskLocale(ctx.request, body)
  const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
    projectId: ctx.projectId,
    storyboardId: normalizeString(input.storyboardId) || null,
  })

  return {
    kind: 'task_submission',
    operationId: 'regenerate_panel_image',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `regenerate_panel_image:${panelId}`,
        taskType: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: panelId,
        locale: taskLocale,
        payload: withTaskUiPayload(billingPayload, {
          intent: 'regenerate',
          hasOutputAtStart,
        }),
        dedupeKey: `image_panel:${panelId}:${candidateCount}:${styleBibleSignature}:${referenceSignature}`,
        billingInfo: requireTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
      }),
    ],
    metadata: {
      panelId,
    },
  }
}

async function commitRegeneratePanelImageOperation(
  ctx: ProjectAgentOperationContext,
  input: RegeneratePanelImageInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const panelId = typeof plan.metadata?.panelId === 'string' ? plan.metadata.panelId : task.target.targetId
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'regenerate_panel_image',
    confirmed: input.confirmed === true,
  })

  const mutationBatch = await createMutationBatch({
    projectId: ctx.projectId,
    userId: ctx.userId,
    source: ctx.source,
    operationId: 'regenerate_panel_image',
    episodeId: null,
    summary: `regenerate_panel_image:${panelId}`,
    entries: [
      {
        kind: 'panel_candidate_cancel',
        targetType: 'ProjectPanel',
        targetId: panelId,
      },
    ],
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'regenerate_panel_image',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    mutationBatchId: mutationBatch.id,
    projectId: ctx.projectId,
    episodeId: null,
    taskType: TASK_TYPE.IMAGE_PANEL,
    targetType: 'ProjectPanel',
    targetId: panelId,
  })

  return {
    ...result,
    panelId,
    taskType: TASK_TYPE.IMAGE_PANEL,
    targetType: 'ProjectPanel',
    targetId: panelId,
    mutationBatchId: mutationBatch.id,
  }
}

type GenerateStoryboardGridImagesInput = {
  confirmed?: boolean
  confirmedMaxCost?: number
  episodeId: string
  editScriptId: string
  sourceVideoBlockId: string
  panelIds: readonly string[]
}

async function planGenerateStoryboardGridImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: GenerateStoryboardGridImagesInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId)
  const editScriptId = normalizeString(input.editScriptId)
  const sourceVideoBlockId = normalizeString(input.sourceVideoBlockId)
  const panelIds = normalizeStringArray(input.panelIds).slice(0, 4)
  if (!episodeId || !editScriptId || !sourceVideoBlockId || panelIds.length < 2) {
    throw new Error('STORYBOARD_GRID_IMAGE_INPUT_INVALID')
  }

  const editScript = await prisma.projectEditScript.findFirst({
    where: {
      id: editScriptId,
      episodeId,
      projectId: ctx.projectId,
    },
    select: { id: true },
  })
  if (!editScript) throw new Error('EDIT_SCRIPT_NOT_FOUND')

  const rawPanels = await prisma.projectPanel.findMany({
    where: {
      id: { in: panelIds },
      storyboard: {
        episodeId,
        episode: {
          projectId: ctx.projectId,
        },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      imageUrl: true,
      imageMediaId: true,
    },
  })
  const panelById = new Map(rawPanels.map((panel) => [panel.id, panel]))
  const panels = panelIds.map((panelId) => panelById.get(panelId))
  const missingPanelIds = panelIds.filter((panelId, index) => !panels[index])
  if (missingPanelIds.length > 0) {
    throw new Error(`STORYBOARD_GRID_PANEL_NOT_FOUND:${missingPanelIds.join(',')}`)
  }
  const orderedPanels = panels.filter((panel): panel is NonNullable<typeof panel> => Boolean(panel))
  const storyboardIds = new Set(orderedPanels.map((panel) => panel.storyboardId))
  if (storyboardIds.size !== 1) {
    throw new Error('STORYBOARD_GRID_PANEL_STORYBOARD_MISMATCH')
  }

  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  if (!projectModelConfig.storyboardModel) {
    throw new Error('STORYBOARD_MODEL_NOT_CONFIGURED')
  }
  await resolveModelSelection(ctx.userId, projectModelConfig.storyboardModel, 'image')
  const locale = resolveLocaleFromContext(ctx.context.locale)
  const primaryGridPanelId = orderedPanels[0]?.id || panelIds[0]
  if (!primaryGridPanelId) throw new Error('PROJECT_AGENT_GRID_IMAGE_PANEL_ID_REQUIRED')
  const body = {
    panelId: primaryGridPanelId,
    candidateCount: 1,
    count: 1,
    referenceMode: 'asset',
    storyboardGrid: {
      mode: '2x2',
      sourceVideoBlockId,
      panelIds,
    },
    meta: {
      locale,
    },
  }
  const billingPayload = await buildImageBillingPayload({
    projectId: ctx.projectId,
    userId: ctx.userId,
    imageModel: projectModelConfig.storyboardModel,
    basePayload: body,
    aspectRatio: projectModelConfig.videoRatio,
  })
  const hasOutputAtStart = orderedPanels.some((panel) => normalizeString(panel.imageUrl) || normalizeString(panel.imageMediaId))
  const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
    projectId: ctx.projectId,
    storyboardId: orderedPanels[0]?.storyboardId || null,
  })
  const taskLocale = resolveRequiredTaskLocale(ctx.request, body)

  return {
    kind: 'task_submission',
    operationId: 'generate_storyboard_grid_images',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `generate_storyboard_grid_images:${sourceVideoBlockId}`,
        taskType: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: primaryGridPanelId,
        locale: taskLocale,
        episodeId,
        payload: withTaskUiPayload(billingPayload, {
          intent: hasOutputAtStart ? 'regenerate' : 'generate',
          hasOutputAtStart,
        }),
        dedupeKey: createTaskDedupeKey('storyboard_grid_image', {
          sourceVideoBlockId,
          panelIds,
          styleBibleSignature,
        }),
        billingInfo: requireTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
      }),
    ],
    metadata: {
      episodeId,
      sourceVideoBlockId,
      panelIds,
      primaryGridPanelId,
    },
  }
}

async function commitGenerateStoryboardGridImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: GenerateStoryboardGridImagesInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const episodeId = typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : input.episodeId
  const sourceVideoBlockId = typeof plan.metadata?.sourceVideoBlockId === 'string'
    ? plan.metadata.sourceVideoBlockId
    : input.sourceVideoBlockId
  const panelIds = Array.isArray(plan.metadata?.panelIds)
    ? normalizeStringArray(plan.metadata.panelIds)
    : normalizeStringArray(input.panelIds)
  const primaryGridPanelId = typeof plan.metadata?.primaryGridPanelId === 'string'
    ? plan.metadata.primaryGridPanelId
    : task.target.targetId
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_storyboard_grid_images',
    confirmed: input.confirmed === true,
  })

  const mutationBatch = await createMutationBatch({
    projectId: ctx.projectId,
    userId: ctx.userId,
    source: ctx.source,
    operationId: 'generate_storyboard_grid_images',
    episodeId,
    summary: `generate_storyboard_grid_images:${sourceVideoBlockId}`,
    entries: panelIds.map((panelId) => ({
      kind: 'panel_candidate_cancel',
      targetType: 'ProjectPanel',
      targetId: panelId,
    })),
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'generate_storyboard_grid_images',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    mutationBatchId: mutationBatch.id,
    projectId: ctx.projectId,
    episodeId,
    taskType: TASK_TYPE.IMAGE_PANEL,
    targetType: 'ProjectPanel',
    targetId: primaryGridPanelId,
  })

  return {
    ...result,
    episodeId,
    sourceVideoBlockId,
    panelIds,
    taskType: TASK_TYPE.IMAGE_PANEL,
    targetType: 'ProjectPanel',
    targetId: primaryGridPanelId,
    mutationBatchId: mutationBatch.id,
  }
}

type GenerateEditScriptStoryboardImagesInput = {
  confirmed?: boolean
  confirmedMaxCost?: number
  episodeId?: string
  storyboardId?: string
  generationMode?: 'single' | 'grid'
}

type StoryboardImagePlanGroupMetadata = {
  planTaskId: string
  panelIds: string[]
}

async function planGenerateEditScriptStoryboardImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: GenerateEditScriptStoryboardImagesInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const storyboardId = normalizeString(input.storyboardId)
  const generationMode = normalizeStoryboardPanelImageGenerationMode(input.generationMode)
  const panels = await prisma.projectPanel.findMany({
    where: {
      storyboard: {
        ...(storyboardId ? { id: storyboardId } : {}),
        episodeId,
        episode: {
          projectId: ctx.projectId,
        },
      },
    },
    orderBy: [
      { storyboardId: 'asc' },
      { panelIndex: 'asc' },
      { panelIndex: 'asc' },
    ],
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      imageUrl: true,
      imageMediaId: true,
      photographyRules: true,
    },
  })
  const missingPanels = panels.filter((panel) => !normalizeString(panel.imageUrl) && !normalizeString(panel.imageMediaId))
  if (missingPanels.length === 0) {
    return {
      kind: 'task_submission',
      operationId: 'generate_edit_script_storyboard_images',
      projectId: ctx.projectId,
      userId: ctx.userId,
      tasks: [],
      metadata: {
        noop: true,
        episodeId,
        storyboardIds: [],
        panelIds: [],
        generationMode,
        groups: [],
      },
    }
  }

  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  if (!projectModelConfig.storyboardModel) {
    throw new Error('STORYBOARD_MODEL_NOT_CONFIGURED')
  }
  await resolveModelSelection(ctx.userId, projectModelConfig.storyboardModel, 'image')
  const locale = resolveLocaleFromContext(ctx.context.locale)
  const taskLocale = resolveRequiredTaskLocale(ctx.request, {
    count: 1,
    meta: { locale },
  })
  const styleBibleSignatures = new Map<string, string>()
  const readStyleBibleSignature = async (panelStoryboardId: string) => {
    const cached = styleBibleSignatures.get(panelStoryboardId)
    if (cached) return cached
    const signature = await resolveEditScriptStyleBibleSignatureForTask({
      projectId: ctx.projectId,
      storyboardId: panelStoryboardId,
    })
    styleBibleSignatures.set(panelStoryboardId, signature)
    return signature
  }

  const submissionGroups = planStoryboardPanelImageSubmissionGroups(missingPanels, generationMode)
  const plannedTasks: PlannedTask[] = []
  const groups: StoryboardImagePlanGroupMetadata[] = []
  for (const group of submissionGroups) {
    const primaryPanel = group.panels[0]
    if (!primaryPanel) throw new Error('STORYBOARD_IMAGE_SUBMISSION_GROUP_EMPTY')
    const styleBibleSignature = await readStyleBibleSignature(primaryPanel.storyboardId)
    const body = {
      panelId: primaryPanel.id,
      candidateCount: 1,
      count: 1,
      referenceMode: 'asset',
      ...(group.kind === 'grid2x2'
        ? {
          storyboardGrid: {
            mode: '2x2',
            sourceVideoBlockId: group.sourceVideoBlockId,
            panelIds: group.panels.map((panel) => panel.id),
          },
        }
        : {}),
      meta: {
        locale,
      },
    }
    const billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel: projectModelConfig.storyboardModel,
      basePayload: body,
      aspectRatio: projectModelConfig.videoRatio,
    })
    const planTaskId = group.kind === 'grid2x2'
      ? `generate_edit_script_storyboard_images:grid:${group.sourceVideoBlockId}`
      : `generate_edit_script_storyboard_images:panel:${primaryPanel.id}`
    plannedTasks.push(createPlannedTask({
      id: planTaskId,
      taskType: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: primaryPanel.id,
      locale: taskLocale,
      episodeId,
      payload: withTaskUiPayload(billingPayload, {
        intent: 'generate',
        hasOutputAtStart: false,
      }),
      dedupeKey: group.kind === 'grid2x2'
        ? createTaskDedupeKey('edit_first_panel_grid_image', {
          sourceVideoBlockId: group.sourceVideoBlockId,
          panelIds: group.panels.map((panel) => panel.id),
          styleBibleSignature,
        })
        : `edit_first_panel_image:${primaryPanel.id}:${styleBibleSignature}`,
      billingInfo: requireTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload),
    }))
    groups.push({
      planTaskId,
      panelIds: group.panels.map((panel) => panel.id),
    })
  }

  return {
    kind: 'task_submission',
    operationId: 'generate_edit_script_storyboard_images',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: plannedTasks,
    metadata: {
      episodeId,
      storyboardIds: Array.from(new Set(missingPanels.map((panel) => panel.storyboardId))),
      panelIds: missingPanels.map((panel) => panel.id),
      generationMode,
      groups,
    },
  }
}

async function commitGenerateEditScriptStoryboardImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: GenerateEditScriptStoryboardImagesInput,
  plan: OperationPlan,
) {
  const episodeId = typeof plan.metadata?.episodeId === 'string'
    ? plan.metadata.episodeId
    : normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  const generationMode: 'single' | 'grid' = plan.metadata?.generationMode === 'grid' ? 'grid' : 'single'
  const storyboardIds = Array.isArray(plan.metadata?.storyboardIds)
    ? normalizeStringArray(plan.metadata.storyboardIds)
    : []
  const panelIds = Array.isArray(plan.metadata?.panelIds)
    ? normalizeStringArray(plan.metadata.panelIds)
    : []
  const groupMetadata = Array.isArray(plan.metadata?.groups)
    ? plan.metadata.groups.flatMap((item): StoryboardImagePlanGroupMetadata[] => {
      if (!isRecord(item)) return []
      const planTaskId = normalizeString(item.planTaskId)
      const groupPanelIds = normalizeStringArray(item.panelIds)
      return planTaskId && groupPanelIds.length > 0 ? [{ planTaskId, panelIds: groupPanelIds }] : []
    })
    : []

  if (plan.tasks.length === 0) {
    return {
      success: true,
      async: true,
      total: 0,
      taskIds: [],
      results: [],
      episodeId,
      storyboardIds,
      panelIds,
      generationMode,
      noop: true,
    }
  }

  const taskResults: Array<{
    task: PlannedTask
    result: Awaited<ReturnType<typeof submitPlannedOperationTask>>
  }> = []
  try {
    for (const task of plan.tasks) {
      const result = await submitPlannedOperationTask({
        ctx,
        task,
        operationId: 'generate_edit_script_storyboard_images',
        confirmed: input.confirmed === true,
      })
      taskResults.push({ task, result })
    }
  } catch (error) {
    await compensateSubmittedTasks(taskResults.map((item) => item.result.taskId))
    throw error
  }

  const mutationBatch = await createMutationBatch({
    projectId: ctx.projectId,
    userId: ctx.userId,
    source: ctx.source,
    operationId: 'generate_edit_script_storyboard_images',
    episodeId,
    summary: `generate_edit_script_storyboard_images:${episodeId}`,
    entries: panelIds.map((panelId) => ({
      kind: 'panel_candidate_cancel',
      targetType: 'ProjectPanel',
      targetId: panelId,
    })),
  })
  const taskIds = taskResults.map((item) => item.result.taskId)
  const taskIdByPlanTaskId = new Map(taskResults.map((item) => [item.task.id, item.result.taskId]))
  const receiptByPlanTaskId = new Map(taskResults.map((item) => [item.task.id, item.result.billingReceiptView]))
  const resultRefs = groupMetadata.flatMap((group) => {
    const taskId = taskIdByPlanTaskId.get(group.planTaskId) || ''
    const billingReceipt = receiptByPlanTaskId.get(group.planTaskId) ?? null
    return group.panelIds.map((panelId) => ({
      refId: panelId,
      taskId,
      taskType: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: panelId,
      billingReceipt,
    }))
  })

  writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
    operationId: 'generate_edit_script_storyboard_images',
    total: taskResults.length,
    taskTotal: taskResults.length,
    targetTotal: panelIds.length,
    taskIds,
    results: resultRefs,
    billingReceipt: taskResults.length === 1 ? taskResults[0]?.result.billingReceiptView ?? null : null,
    mutationBatchId: mutationBatch.id,
  })

  return {
    success: true,
    async: true,
    total: taskResults.length,
    taskTotal: taskResults.length,
    targetTotal: panelIds.length,
    taskIds,
    results: resultRefs,
    mutationBatchId: mutationBatch.id,
    episodeId,
    storyboardIds,
    panelIds,
    generationMode,
  }
}

type PanelVariantInput = {
  confirmed?: boolean
  confirmedMaxCost?: number
  storyboardId: string
  insertAfterPanelId: string
  sourcePanelId: string
  variant: Record<string, unknown>
}

type PanelVariantPlanMetadata = {
  storyboardId: string
  episodeId: string | null
  createdPanelId: string
  insertAfterPanelId: string
  sourcePanelId: string
  insertAfterPanelIndex: number
  sourcePanel: {
    shotType: string | null
    cameraMove: string | null
    description: string | null
    videoPrompt: string | null
    location: string | null
    characters: string | null
    srtSegment: string | null
    duration: number | null
  }
  variant: Record<string, unknown>
}

function readPanelVariantPlanMetadata(plan: OperationPlan): PanelVariantPlanMetadata {
  const metadata = plan.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('PROJECT_AGENT_PANEL_VARIANT_PLAN_METADATA_INVALID')
  }
  const sourcePanel = isRecord(metadata.sourcePanel) ? metadata.sourcePanel : null
  const variant = isRecord(metadata.variant) ? metadata.variant : null
  const storyboardId = normalizeString(metadata.storyboardId)
  const createdPanelId = normalizeString(metadata.createdPanelId)
  const insertAfterPanelId = normalizeString(metadata.insertAfterPanelId)
  const sourcePanelId = normalizeString(metadata.sourcePanelId)
  const insertAfterPanelIndex = typeof metadata.insertAfterPanelIndex === 'number' ? metadata.insertAfterPanelIndex : NaN
  if (!sourcePanel || !variant || !storyboardId || !createdPanelId || !insertAfterPanelId || !sourcePanelId || !Number.isInteger(insertAfterPanelIndex)) {
    throw new Error('PROJECT_AGENT_PANEL_VARIANT_PLAN_METADATA_INVALID')
  }
  return {
    storyboardId,
    episodeId: typeof metadata.episodeId === 'string' ? metadata.episodeId : null,
    createdPanelId,
    insertAfterPanelId,
    sourcePanelId,
    insertAfterPanelIndex,
    sourcePanel: {
      shotType: typeof sourcePanel.shotType === 'string' ? sourcePanel.shotType : null,
      cameraMove: typeof sourcePanel.cameraMove === 'string' ? sourcePanel.cameraMove : null,
      description: typeof sourcePanel.description === 'string' ? sourcePanel.description : null,
      videoPrompt: typeof sourcePanel.videoPrompt === 'string' ? sourcePanel.videoPrompt : null,
      location: typeof sourcePanel.location === 'string' ? sourcePanel.location : null,
      characters: typeof sourcePanel.characters === 'string' ? sourcePanel.characters : null,
      srtSegment: typeof sourcePanel.srtSegment === 'string' ? sourcePanel.srtSegment : null,
      duration: typeof sourcePanel.duration === 'number' && Number.isFinite(sourcePanel.duration) ? sourcePanel.duration : null,
    },
    variant,
  }
}

async function planPanelVariantOperation(
  ctx: ProjectAgentOperationContext,
  input: PanelVariantInput,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input as Record<string, unknown>)
  const locale = resolveLocaleFromContext(ctx.context.locale)
  const storyboardId = input.storyboardId.trim()
  const insertAfterPanelId = input.insertAfterPanelId.trim()
  const sourcePanelId = input.sourcePanelId.trim()
  const variant = input.variant || {}

  const variantVideoPrompt = typeof variant.video_prompt === 'string' ? variant.video_prompt.trim() : ''
  if (!variantVideoPrompt) {
    throw new Error('PROJECT_AGENT_PANEL_VARIANT_INVALID')
  }

  const storyboard = await prisma.projectStoryboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      episodeId: true,
      episode: {
        select: {
          projectId: true,
        },
      },
    },
  })
  if (!storyboard || storyboard.episode.projectId !== ctx.projectId) {
    throw new Error('PROJECT_AGENT_STORYBOARD_NOT_FOUND')
  }

  const [sourcePanel, insertAfter] = await Promise.all([
    prisma.projectPanel.findUnique({
      where: { id: sourcePanelId },
      select: {
        id: true,
        storyboardId: true,
        shotType: true,
        cameraMove: true,
        description: true,
        videoPrompt: true,
        location: true,
        characters: true,
        srtSegment: true,
        duration: true,
      },
    }),
    prisma.projectPanel.findUnique({
      where: { id: insertAfterPanelId },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
      },
    }),
  ])
  if (!sourcePanel || sourcePanel.storyboardId !== storyboardId) {
    throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
  }
  if (!insertAfter || insertAfter.storyboardId !== storyboardId) {
    throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
  }

  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  const imageModel = projectModelConfig.storyboardModel
  const createdPanelId = createPanelVariantId()

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel,
      basePayload: { ...input, newPanelId: createdPanelId, meta: { locale } },
      aspectRatio: projectModelConfig.videoRatio,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new Error(message)
  }
  const taskLocale = resolveRequiredTaskLocale(ctx.request, billingPayload)
  const styleBibleSignature = await resolveEditScriptStyleBibleSignatureForTask({
    projectId: ctx.projectId,
    storyboardId,
  })

  return {
    kind: 'task_submission',
    operationId: 'panel_variant',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `panel_variant:${createdPanelId}`,
        taskType: TASK_TYPE.PANEL_VARIANT,
        targetType: 'ProjectPanel',
        targetId: createdPanelId,
        locale: taskLocale,
        episodeId: storyboard.episodeId,
        payload: billingPayload,
        dedupeKey: `panel_variant:${storyboardId}:${insertAfterPanelId}:${sourcePanelId}:${styleBibleSignature}`,
        billingInfo: requireTaskBillingInfo(TASK_TYPE.PANEL_VARIANT, billingPayload),
      }),
    ],
    metadata: {
      storyboardId,
      episodeId: storyboard.episodeId,
      createdPanelId,
      insertAfterPanelId,
      sourcePanelId,
      insertAfterPanelIndex: insertAfter.panelIndex,
      sourcePanel: {
        shotType: sourcePanel.shotType,
        cameraMove: sourcePanel.cameraMove,
        description: sourcePanel.description,
        videoPrompt: sourcePanel.videoPrompt,
        location: sourcePanel.location,
        characters: sourcePanel.characters,
        srtSegment: sourcePanel.srtSegment,
        duration: sourcePanel.duration,
      },
      variant,
    },
  }
}

async function commitPanelVariantOperation(
  ctx: ProjectAgentOperationContext,
  input: PanelVariantInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const metadata = readPanelVariantPlanMetadata(plan)
  const variantVideoPrompt = typeof metadata.variant.video_prompt === 'string' ? metadata.variant.video_prompt.trim() : ''
  if (!variantVideoPrompt) throw new Error('PROJECT_AGENT_PANEL_VARIANT_INVALID')

  const createdPanel = await prisma.$transaction(async (tx) => {
    const affectedPanels = await tx.projectPanel.findMany({
      where: { storyboardId: metadata.storyboardId, panelIndex: { gt: metadata.insertAfterPanelIndex } },
      select: { id: true, panelIndex: true },
      orderBy: { panelIndex: 'asc' },
    })

    for (const panel of affectedPanels) {
      await tx.projectPanel.update({
        where: { id: panel.id },
        data: { panelIndex: -(panel.panelIndex + 1) },
      })
    }

    for (const panel of affectedPanels) {
      await tx.projectPanel.update({
        where: { id: panel.id },
        data: { panelIndex: panel.panelIndex + 1 },
      })
    }

    const created = await tx.projectPanel.create({
      data: {
        id: metadata.createdPanelId,
        storyboardId: metadata.storyboardId,
        panelIndex: metadata.insertAfterPanelIndex + 1,
        panelNumber: metadata.insertAfterPanelIndex + 2,
        shotType: typeof metadata.variant.shot_type === 'string' ? metadata.variant.shot_type : metadata.sourcePanel.shotType,
        cameraMove: typeof metadata.variant.camera_move === 'string' ? metadata.variant.camera_move : metadata.sourcePanel.cameraMove,
        description: typeof metadata.variant.description === 'string' ? metadata.variant.description : metadata.sourcePanel.description,
        videoPrompt: variantVideoPrompt,
        location: typeof metadata.variant.location === 'string' ? metadata.variant.location : metadata.sourcePanel.location,
        characters: metadata.variant.characters ? JSON.stringify(metadata.variant.characters) : metadata.sourcePanel.characters,
        srtSegment: metadata.sourcePanel.srtSegment,
        duration: metadata.sourcePanel.duration,
      },
    })

    const panelCount = await tx.projectPanel.count({
      where: { storyboardId: metadata.storyboardId },
    })

    await tx.projectStoryboard.update({
      where: { id: metadata.storyboardId },
      data: { panelCount },
    })

    return created
  })

  let result: Awaited<ReturnType<typeof submitPlannedOperationTask>>
  try {
    result = await submitPlannedOperationTask({
      ctx,
      task,
      operationId: 'panel_variant',
      confirmed: input.confirmed === true,
    })
  } catch (error) {
    await rollbackCreatedVariantPanel({
      panelId: createdPanel.id,
      storyboardId: metadata.storyboardId,
      panelIndex: createdPanel.panelIndex,
    })
    throw error
  }

  const mutationBatch = await createMutationBatch({
    projectId: ctx.projectId,
    userId: ctx.userId,
    source: ctx.source,
    operationId: 'panel_variant',
    episodeId: metadata.episodeId,
    summary: `panel_variant:${createdPanel.id}`,
    entries: [
      {
        kind: 'panel_variant_delete',
        targetType: 'ProjectPanel',
        targetId: createdPanel.id,
        payload: {
          storyboardId: metadata.storyboardId,
          panelIndex: createdPanel.panelIndex,
        },
      },
    ],
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'panel_variant',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    mutationBatchId: mutationBatch.id,
    projectId: ctx.projectId,
    episodeId: metadata.episodeId,
    taskType: TASK_TYPE.PANEL_VARIANT,
    targetType: 'ProjectPanel',
    targetId: createdPanel.id,
  })

  return {
    ...result,
    panelId: createdPanel.id,
    taskType: TASK_TYPE.PANEL_VARIANT,
    targetType: 'ProjectPanel',
    targetId: createdPanel.id,
    mutationBatchId: mutationBatch.id,
  }
}

export function createStoryboardPanelImageOperations(): ProjectAgentOperationRegistryDraft {
  const withMutationBatchBase = taskSubmitOperationOutputSchemaBase.extend({
    mutationBatchId: z.string().min(1),
  }).passthrough()

  const taskSubmitOutputWithMutationBatch = <TShape extends z.ZodRawShape>(shape: TShape) => refineTaskSubmitOperationOutputSchema(
    withMutationBatchBase.extend(shape).passthrough(),
  )
  const storyboardImageBatchOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
    taskBatchSubmitOperationOutputSchemaBase.extend({
      episodeId: z.string().min(1),
      storyboardIds: z.array(z.string().min(1)),
      panelIds: z.array(z.string().min(1)),
      generationMode: z.enum(['single', 'grid']),
    }).passthrough(),
  )

  return {
    generate_edit_script_storyboard_images: defineOperation({
      id: 'generate_edit_script_storyboard_images',
      summary: 'Generate missing storyboard panel images for the edit-first storyboard.',
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
        summary: '将为当前剪辑先行分镜中缺失图片的格子批量生成分镜图片，可能消耗额度或产生计费。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        episodeId: z.string().trim().min(1).optional(),
        storyboardId: z.string().trim().min(1).optional(),
        generationMode: z.enum(['single', 'grid']).optional(),
      }).passthrough(),
      outputSchema: storyboardImageBatchOutputSchema,
      plan: async (ctx, input) => planGenerateEditScriptStoryboardImagesOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateEditScriptStoryboardImagesOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateEditScriptStoryboardImagesOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return storyboardImageBatchOutputSchema.parse(
          await commitGenerateEditScriptStoryboardImagesOperation(ctx, input, plan),
        )
      },
    }),
    generate_storyboard_grid_images: defineOperation({
      id: 'generate_storyboard_grid_images',
      summary: 'Generate storyboard panel images as one 2x2 grid for a selected storyboard group.',
      intent: 'act',
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
        summary: '将把本组分镜作为一张四宫格图片生成，再裁剪回单张分镜图，可能消耗额度或产生计费。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        episodeId: z.string().trim().min(1),
        editScriptId: z.string().trim().min(1),
        sourceVideoBlockId: z.string().trim().min(1),
        panelIds: z.array(z.string().trim().min(1)).min(2).max(4),
      }).passthrough(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        episodeId: z.string().min(1),
        sourceVideoBlockId: z.string().min(1),
        panelIds: z.array(z.string().min(1)),
      }),
      plan: async (ctx, input) => planGenerateStoryboardGridImagesOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateStoryboardGridImagesOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateStoryboardGridImagesOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitGenerateStoryboardGridImagesOperation(ctx, input, plan)
      },
    }),
    regenerate_panel_image: defineOperation({
      id: 'regenerate_panel_image',
      summary: 'Regenerate storyboard panel images (async task submission).',
      intent: 'act',
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
        summary: '将为分镜格子重新生成图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        panelId: z.string().min(1).optional(),
        storyboardId: z.string().min(1).optional(),
        panelIndex: z.number().int().min(0).max(1000).optional(),
        count: z.number().int().positive().max(4).optional(),
        referenceMode: z.enum(['asset', 'storyboard']).optional(),
        referencePanelIds: z.array(z.string().min(1)).max(8).optional(),
        extraImageUrls: z.array(z.unknown()).max(8).optional(),
        referenceImageNotes: z.array(z.unknown()).max(16).optional(),
      }).refine((value) => Boolean(value.panelId || (value.storyboardId && typeof value.panelIndex === 'number')), {
        message: 'panelId or (storyboardId + panelIndex) is required',
        path: ['panelId'],
      }),
      outputSchema: taskSubmitOutputWithMutationBatch({
        panelId: z.string().min(1),
      }),
      plan: async (ctx, input) => planRegeneratePanelImageOperation(ctx, input),
      commit: async (ctx, input, plan) => commitRegeneratePanelImageOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planRegeneratePanelImageOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitRegeneratePanelImageOperation(ctx, input, plan)
      },
    }),

    panel_variant: defineOperation({
      id: 'panel_variant',
      summary: 'Insert a variant panel after an existing panel and enqueue image generation (async task submission).',
      intent: 'act',
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
        summary: '将创建新的分镜格并生成变体图片（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        confirmedMaxCost: z.number().nonnegative().optional(),
        storyboardId: z.string().min(1),
        insertAfterPanelId: z.string().min(1),
        sourcePanelId: z.string().min(1),
        variant: z.record(z.string(), z.unknown()),
      }).passthrough(),
      outputSchema: taskSubmitOutputWithMutationBatch({
        panelId: z.string().min(1),
      }),
      plan: async (ctx, input) => planPanelVariantOperation(ctx, input),
      commit: async (ctx, input, plan) => commitPanelVariantOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planPanelVariantOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitPanelVariantOperation(ctx, input, plan)
      },
    }),
  }
}
