import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import { createTaskDedupeKey, normalizeString, normalizeStringArray, resolveLocaleFromContext } from './shared'

export type GenerateStoryboardGridImagesInput = {
  confirmed?: boolean
  confirmedMaxCost?: number
  episodeId: string
  editScriptId: string
  sourceVideoBlockId: string
  panelIds: readonly string[]
}

export async function planGenerateStoryboardGridImagesOperation(
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
        billingInfo: requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.IMAGE_PANEL, payload: billingPayload, allowedApiTypes: ['image'] }),
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

export async function commitGenerateStoryboardGridImagesOperation(
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
