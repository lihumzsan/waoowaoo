import { prisma } from '@/lib/prisma'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { hasPanelImageOutput } from '@/lib/task/has-output'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { createMutationBatchInTransaction } from '@/lib/mutation-batch/service'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import { sanitizeImageInputsForTaskPayload } from '@/lib/media/outbound-image'
import {
  assertNoLegacyArtStyle,
  createReferenceSignature,
  formatReferenceImageNote,
  normalizeReferenceImageNotes,
  normalizeString,
  normalizeStringArray,
  resolveCandidateCount,
  resolveLocaleFromContext,
} from './shared'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'

export type RegeneratePanelImageInput = {
  panelId?: string
  storyboardId?: string
  panelIndex?: number
  count?: number
  referenceMode?: 'asset' | 'storyboard'
  referencePanelIds?: string[]
  extraImageUrls?: unknown[]
  referenceImageNotes?: unknown[]
}

export async function planRegeneratePanelImageOperation(
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

  const extraImageAudit = sanitizeImageInputsForTaskPayload(Array.isArray(input.extraImageUrls) ? input.extraImageUrls : [])
  if (extraImageAudit.issues.some((issue) => (issue as { reason?: unknown }).reason === 'relative_path_rejected')) {
    throw new Error('PROJECT_AGENT_REFERENCE_IMAGE_INVALID')
  }
  const rawReferenceNotes = normalizeReferenceImageNotes(input.referenceImageNotes)
  const notesByPanelId = new Map(rawReferenceNotes.filter((note) => note.referencePanelId).map((note) => [note.referencePanelId!, note]))
  const notesByUrl = new Map(rawReferenceNotes.filter((note) => note.url).map((note) => [note.url!, note]))
  const referenceImageNotes = [
    ...referencePanelIds.map((referencePanelId, index) =>
      formatReferenceImageNote(
        notesByPanelId.get(referencePanelId),
        `source=storyboard; label=previous storyboard panel ${index + 1}; usage=Use this previous storyboard panel as continuity reference for staging, placement, and spatial relationship.`,
      ),
    ),
    ...extraImageAudit.normalized.map((url, index) =>
      formatReferenceImageNote(
        notesByUrl.get(url),
        `source=custom; label=extra reference ${index + 1}; usage=Use this extra image only as directed by the user reference note.`,
      ),
    ),
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
      ...(extraImageAudit.issues.length > 0
        ? {
            outboundImageInputAudit: { extraImageUrls: extraImageAudit.issues },
          }
        : {}),
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
  const taskLocale = resolveOperationLocale(ctx.context)
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
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.IMAGE_PANEL,
          payload: billingPayload,
          allowedApiTypes: ['image'],
        }),
      }),
    ],
    metadata: {
      panelId,
    },
  }
}

export async function commitRegeneratePanelImageOperation(
  ctx: ProjectAgentOperationContext,
  input: RegeneratePanelImageInput,
  plan: OperationPlan,
) {
  const transaction = requireOperationExecutionTransaction(ctx)
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const panelId = typeof plan.metadata?.panelId === 'string' ? plan.metadata.panelId : task.target.targetId
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'regenerate_panel_image',
  })

  const mutationBatch = await createMutationBatchInTransaction(transaction, {
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
