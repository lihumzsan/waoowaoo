import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { compensateSubmittedTasks, createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import { normalizeStoryboardPanelImageGenerationMode, planStoryboardPanelImageSubmissionGroups } from '@/lib/storyboard/grid-image-groups'
import { createTaskDedupeKey, isRecord, normalizeString, normalizeStringArray, resolveLocaleFromContext } from './shared'

export type GenerateEditScriptStoryboardImagesInput = {
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

export async function planGenerateEditScriptStoryboardImagesOperation(
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
      billingInfo: requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.IMAGE_PANEL, payload: billingPayload, allowedApiTypes: ['image'] }),
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

export async function commitGenerateEditScriptStoryboardImagesOperation(
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
