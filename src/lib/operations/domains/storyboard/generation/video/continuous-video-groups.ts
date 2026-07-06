import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import type { TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { assertOperationPlanConfirmedCost, resolveConfirmedMaxCostForExecution, type OperationPlan } from '@/lib/operations/planning'
import { inferVideoGridModeForShotCount } from '@/lib/video-groups/core'
import { type VideoGridMode } from '@/lib/video-groups/types'
import { normalizeEditScriptStructure } from '@/lib/edit-script/normalize'
import { assertNoManagedVideoModelInput, isRecord, normalizeString, type UnknownObject } from './shared'
import { commitPlannedVideoGroupBatch, commitPlannedVideoGroupTask, planVideoGroupTask, readPlannedVideoGroupMetadataList, readStoryboardVideoGridMode, resolveEditChapterId } from './video-group-planning'

export async function executeGenerateVideoGroupOperation(params: {
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

export async function planGenerateVideoGroupOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const chapterId = await resolveEditChapterId(episodeId, normalizeString(params.input.chapterId))
  const gridMode: '2x2' | '3x3' = params.input.gridMode === '3x3' ? '3x3' : '2x2'
  const shotIds = Array.isArray(params.input.shotIds)
    ? params.input.shotIds.map((value) => (typeof value === 'string' ? value.trim() : ''))
    : []
  const planned = await planVideoGroupTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    episodeId,
    chapterId,
    gridMode,
    shotIds,
  })
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [planned.task],
    metadata: {
      episodeId,
      chapterId,
      gridMode,
      videoGroups: [planned.metadata],
    },
  }
}

export async function commitGenerateVideoGroupPlan(params: {
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
    shotIds: submitted.metadata.shotIds,
    durationSec: submitted.metadata.durationSec,
  }
}

export async function executeGenerateEpisodeVideoGroupsOperation(params: {
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

export async function planGenerateEpisodeVideoGroupsOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const chapterId = await resolveEditChapterId(episodeId, normalizeString(params.input.chapterId))
  const editScript = await prisma.projectEditScript.findFirst({
    where: { episodeId, chapterId, projectId: params.ctx.projectId },
    select: { corePlanJson: true },
  })
  if (!editScript) throw new Error('PROJECT_AGENT_EDIT_SCRIPT_REQUIRED')
  const core = normalizeEditScriptStructure(editScript.corePlanJson)
  const generationSegments = core.generationSegments.filter((segment) => segment.shotIds.length >= 2)
  if (generationSegments.length === 0) {
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
        chapterId,
        videoGroups: [],
      },
    }
  }

  const planned = []
  for (const segment of generationSegments) {
    planned.push(await planVideoGroupTask({
      ctx: params.ctx,
      input: params.input,
      operationId: params.operationId,
      episodeId,
      chapterId,
      gridMode: inferVideoGridModeForShotCount(segment.shotIds.length),
      shotIds: segment.shotIds,
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
      chapterId,
      videoGroups: planned.map((item) => item.metadata),
    },
  }
}

export async function commitGenerateEpisodeVideoGroupsPlan(params: {
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
      shotIds: item.metadata.shotIds,
      durationSec: item.metadata.durationSec,
    })),
    gridMode,
  }
}
