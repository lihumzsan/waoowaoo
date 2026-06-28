import { createMutationBatch } from '@/lib/mutation-batch/service'
import { TASK_TYPE } from '@/lib/task/types'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { assertOperationPlanConfirmedCost, compensateSubmittedTasks, resolveConfirmedMaxCostForExecution, submitPlannedOperationTask, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import { type VideoBlockPlanItem, type VideoGridMode } from '@/lib/video-groups/types'
import { assertNoManagedVideoModelInput, isRecord, normalizeString, type UnknownObject } from './shared'
import { planGeneratePanelVideoOperation, readPlannedPanelVideoMetadata, type PlannedPanelVideoMetadata } from './panel-video'
import { buildEpisodeVideoBlockPlan, commitPlannedVideoGroupTask, parseShotNumbersJson, planVideoGroupTask, readPlannedVideoGroupMetadataByTaskId, resolvePanelIdForVideoBlockShot, rollbackCommittedVideoGroups, type CommittedVideoGroupTask, type PlannedVideoGroupTaskMetadata } from './video-group-planning'

export async function executeGenerateEpisodeVideosAutoOperation(params: {
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

export async function planGenerateEpisodeVideosAutoOperation(params: {
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

export async function commitGenerateEpisodeVideosAutoPlan(params: {
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
    await compensateSubmittedTasks(submitted.map((item) => item.result.taskId)).catch((compensationError: unknown) => {
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
