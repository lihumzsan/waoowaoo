import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { assertOperationPlanConfirmedCost, compensateSubmittedTasks, resolveConfirmedMaxCostForExecution, submitPlannedOperationTask, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import { assertNoManagedVideoModelInput, buildVideoTaskPayload, isRecord, normalizeString, type UnknownObject } from './shared'
import { planGeneratePanelVideoOperation, readPlannedPanelVideoMetadata } from './panel-video'

export async function executeGenerateEpisodeVideosOperation(params: {
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

export async function planGenerateEpisodeVideosOperation(params: {
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

export async function commitGenerateEpisodeVideosPlan(params: {
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
    await compensateSubmittedTasks(submitted.map((item) => item.result.taskId))
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
