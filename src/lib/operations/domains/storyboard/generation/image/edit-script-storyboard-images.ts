import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { buildImageBillingPayload, getProjectModelConfig } from '@/lib/config-service'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { resolveEditScriptStyleBibleSignatureForTask } from '@/lib/edit-script/style-bible-prompt'
import { createMutationBatchInTransaction } from '@/lib/mutation-batch/service'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
  type PlannedTask,
} from '@/lib/operations/planning'
import { normalizeString, normalizeStringArray, resolveLocaleFromContext } from './shared'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'

export type GenerateEditScriptStoryboardImagesInput = {
  episodeId?: string
  storyboardId?: string
}

export async function planGenerateEditScriptStoryboardImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: GenerateEditScriptStoryboardImagesInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const storyboardId = normalizeString(input.storyboardId)
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
    orderBy: [{ storyboardId: 'asc' }, { panelIndex: 'asc' }, { panelIndex: 'asc' }],
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      imageUrl: true,
      imageMediaId: true,
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

  const plannedTasks: PlannedTask[] = []
  for (const panel of missingPanels) {
    const styleBibleSignature = await readStyleBibleSignature(panel.storyboardId)
    const body = {
      panelId: panel.id,
      candidateCount: 1,
      count: 1,
      referenceMode: 'asset',
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
    plannedTasks.push(
      createPlannedTask({
        id: `generate_edit_script_storyboard_images:panel:${panel.id}`,
        taskType: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: panel.id,
        locale: taskLocale,
        episodeId,
        payload: withTaskUiPayload(billingPayload, {
          intent: 'generate',
          hasOutputAtStart: false,
        }),
        dedupeKey: `edit_first_panel_image:${panel.id}:${styleBibleSignature}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.IMAGE_PANEL,
          payload: billingPayload,
          allowedApiTypes: ['image'],
        }),
      }),
    )
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
    },
  }
}

export async function commitGenerateEditScriptStoryboardImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: GenerateEditScriptStoryboardImagesInput,
  plan: OperationPlan,
) {
  const transaction = requireOperationExecutionTransaction(ctx)
  const episodeId =
    typeof plan.metadata?.episodeId === 'string'
      ? plan.metadata.episodeId
      : normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  const storyboardIds = Array.isArray(plan.metadata?.storyboardIds) ? normalizeStringArray(plan.metadata.storyboardIds) : []
  const panelIds = Array.isArray(plan.metadata?.panelIds) ? normalizeStringArray(plan.metadata.panelIds) : []

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
      noop: true,
    }
  }

  const taskResults: Array<{
    task: PlannedTask
    result: Awaited<ReturnType<typeof submitPlannedOperationTasks>> extends Map<string, infer Result> ? Result : never
  }> = []
  const submitted = await submitPlannedOperationTasks({
    ctx,
    operationId: 'generate_edit_script_storyboard_images',
  })
  for (const task of plan.tasks) {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`EDIT_SCRIPT_STORYBOARD_IMAGE_TASK_RESULT_MISSING:${task.id}`)
    taskResults.push({ task, result })
  }

  const mutationBatch = await createMutationBatchInTransaction(transaction, {
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
  const resultRefs = taskResults.map(({ task, result }) => ({
    refId: task.target.targetId,
    taskId: result.taskId,
    taskType: TASK_TYPE.IMAGE_PANEL,
    targetType: task.target.targetType,
    targetId: task.target.targetId,
    billingReceipt: result.billingReceiptView,
  }))

  writeOperationDataPart<TaskBatchSubmittedPartData>(ctx.writer, 'data-task-batch-submitted', {
    operationId: 'generate_edit_script_storyboard_images',
    total: taskResults.length,
    taskTotal: taskResults.length,
    targetTotal: panelIds.length,
    taskIds,
    results: resultRefs,
    billingReceipt: taskResults.length === 1 ? (taskResults[0]?.result.billingReceiptView ?? null) : null,
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
  }
}
