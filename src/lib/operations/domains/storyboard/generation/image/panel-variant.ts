import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import { assertNoLegacyArtStyle, createPanelVariantId, isRecord, normalizeString, resolveLocaleFromContext, rollbackCreatedVariantPanel } from './shared'

export type PanelVariantInput = {
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

export async function planPanelVariantOperation(
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
        billingInfo: requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.PANEL_VARIANT, payload: billingPayload, allowedApiTypes: ['image'] }),
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

export async function commitPanelVariantOperation(
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
