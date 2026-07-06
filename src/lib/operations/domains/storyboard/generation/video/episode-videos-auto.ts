import { TASK_TYPE } from '@/lib/task/types'
import { prisma } from '@/lib/prisma'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import type { TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { assertOperationPlanConfirmedCost, compensateSubmittedTasks, resolveConfirmedMaxCostForExecution, submitPlannedOperationTask, type OperationPlan, type PlannedTask } from '@/lib/operations/planning'
import { type GenerationSegmentVideoPlanItem } from '@/lib/video-groups/types'
import { assertNoManagedVideoModelInput, isRecord, normalizeString, type UnknownObject } from './shared'
import { buildEpisodeGenerationSegmentVideoPlan, commitPlannedVideoGroupTask, parseShotIdsJson, planVideoGroupTask, readPlannedVideoGroupMetadataByTaskId, resolveEditChapterId, rollbackCommittedVideoGroups, type CommittedVideoGroupTask, type PlannedVideoGroupTaskMetadata } from './video-group-planning'

function hasExistingVideoOutput(metadata: PlannedVideoGroupTaskMetadata): boolean {
  return Boolean(normalizeString(metadata.previous?.videoUrl) || normalizeString(metadata.previous?.videoMediaId))
}

async function resolveEpisodeVideoPlanningChapterIds(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
}): Promise<readonly string[]> {
  if (input.chapterId) {
    return [await resolveEditChapterId(input.episodeId, input.chapterId)]
  }
  const chapters = await prisma.projectEditChapter.findMany({
    where: {
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
      },
    },
    orderBy: { chapterIndex: 'asc' },
    select: { id: true },
  })
  if (chapters.length === 0) throw new Error(`PROJECT_AGENT_EDIT_CHAPTERS_REQUIRED:${input.episodeId}`)
  return chapters.map((chapter) => chapter.id)
}

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
  const chapterIds = await resolveEpisodeVideoPlanningChapterIds({
    projectId: params.ctx.projectId,
    episodeId,
    chapterId: normalizeString(params.input.chapterId),
  })

  const groupVideoModel = await resolveSystemModelKey({
    userId: params.ctx.userId,
    projectId: params.ctx.projectId,
    purpose: 'sequence-video',
  })
  const tasks: PlannedTask[] = []
  const items: Array<{
    readonly planTaskId: string
    readonly chapterId: string
    readonly kind: GenerationSegmentVideoPlanItem['kind']
    readonly refId: string
    readonly taskType: typeof TASK_TYPE.VIDEO_GROUP
    readonly targetType: 'ProjectVideoGroup'
    readonly shotIds: string[]
    readonly durationSec?: number
  }> = []
  const videoGroups: PlannedVideoGroupTaskMetadata[] = []
  const generationSegmentItems: Array<GenerationSegmentVideoPlanItem & {
    readonly chapterId: string
  }> = []

  for (const chapterId of chapterIds) {
    const planned = await buildEpisodeGenerationSegmentVideoPlan({
      ctx: params.ctx,
      episodeId,
      chapterId,
    })
    generationSegmentItems.push(...planned.plan.items.map((item) => ({
      ...item,
      shotIds: [...item.shotIds],
      chapterId,
    })))

    for (const item of planned.plan.items) {
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
        chapterId,
        gridMode: item.gridMode,
        shotIds: item.shotIds,
      })
      if (hasExistingVideoOutput(groupPlan.metadata)) continue
      tasks.push(groupPlan.task)
      videoGroups.push(groupPlan.metadata)
      items.push({
        planTaskId: groupPlan.task.id,
        chapterId,
        refId: groupPlan.metadata.groupId,
        taskType: TASK_TYPE.VIDEO_GROUP,
        targetType: 'ProjectVideoGroup',
        kind: 'group',
        shotIds: [...groupPlan.metadata.shotIds],
        durationSec: groupPlan.metadata.durationSec,
      })
    }
  }

  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks,
    metadata: {
      episodeId,
      chapterIds: [...chapterIds],
      items,
      videoGroups,
      generationSegmentItems,
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
  const rawItems = Array.isArray(metadata.items) ? metadata.items : []
  const items = rawItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const planTaskId = normalizeString(item.planTaskId)
    const refId = normalizeString(item.refId)
    const kind = 'group' as const
    const targetType = 'ProjectVideoGroup'
    const taskType = TASK_TYPE.VIDEO_GROUP
    if (!planTaskId || !refId) return []
    return [{
      planTaskId,
      refId,
      kind,
      targetType,
      taskType,
      shotIds: parseShotIdsJson(item.shotIds),
      durationSec: typeof item.durationSec === 'number' && Number.isInteger(item.durationSec) ? item.durationSec : undefined,
    }]
  })
  const itemByTaskId = new Map(items.map((item) => [item.planTaskId, item]))
  const generationSegmentItems: Array<{
    kind: 'group'
    shotIds: string[]
    continuity: string
    gridMode?: '2x2' | '3x3'
  }> = Array.isArray(metadata.generationSegmentItems)
    ? metadata.generationSegmentItems.flatMap((item) => {
      if (!isRecord(item)) return []
      const shotIds = parseShotIdsJson(item.shotIds)
      const continuity = normalizeString(item.continuity)
      const gridMode = item.gridMode === '2x2' || item.gridMode === '3x3' ? item.gridMode : undefined
      if (shotIds.length === 0 || !continuity) return []
      return [{
        kind: 'group' as const,
        shotIds,
        continuity,
        ...(gridMode ? { gridMode } : {}),
      }]
    })
    : []
  const videoGroupMetadataByTaskId = readPlannedVideoGroupMetadataByTaskId(params.plan)
  if (params.plan.tasks.length === 0) {
    return {
      success: true,
      async: true,
      total: 0,
      taskIds: [],
      results: [],
      noop: true,
      reason: 'NO_VIDEO_GROUPS_TO_GENERATE',
      plan: {
        items: generationSegmentItems,
      },
      groupVideoModel: normalizeString(metadata.groupVideoModel),
    }
  }
  const submitted: Array<{
    task: PlannedTask
    result: Awaited<ReturnType<typeof submitPlannedOperationTask>>
  }> = []
  const committedGroups: CommittedVideoGroupTask[] = []
  try {
    for (const task of params.plan.tasks) {
      const item = itemByTaskId.get(task.id)
      if (!item) throw new Error(`PROJECT_AGENT_AUTO_VIDEO_PLAN_ITEM_MISSING:${task.id}`)
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
    mutationBatchId: null,
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
        kind: 'group' as const,
        shotIds: plannedItem?.shotIds ?? [],
        durationSec: plannedItem?.durationSec,
      }
    }),
    plan: {
      items: generationSegmentItems,
    },
    groupVideoModel: normalizeString(metadata.groupVideoModel),
  }
}
