import { TASK_TYPE } from '@/lib/task/types'
import type { TaskBatchSubmittedPartData, TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import type { OperationPlan } from '@/lib/operations/planning'
import { assertNoManagedVideoModelInput, isRecord, normalizeString, type UnknownObject } from './shared'
import { buildEpisodeGenerationSegmentVideoPlan, commitPlannedVideoGroupBatch, commitPlannedVideoGroupTask, planAssetReferenceGenerationSegmentTask, readPlannedVideoGroupMetadataList, resolveEditChapterId } from './video-group-planning'

export async function planGenerateAssetReferenceVideoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const chapterId = await resolveEditChapterId(episodeId, normalizeString(params.input.chapterId))
  const segmentIndex = typeof params.input.segmentIndex === 'number' && Number.isInteger(params.input.segmentIndex)
    ? params.input.segmentIndex
    : -1
  if (segmentIndex < 0) throw new Error('PROJECT_AGENT_ASSET_REFERENCE_SEGMENT_REQUIRED')
  const planned = await buildEpisodeGenerationSegmentVideoPlan({
    ctx: params.ctx,
    episodeId,
    chapterId,
  })
  const item = planned.plan.items[segmentIndex]
  if (!item) throw new Error(`PROJECT_AGENT_ASSET_REFERENCE_SEGMENT_NOT_FOUND:${segmentIndex}`)

  const plannedTask = await planAssetReferenceGenerationSegmentTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    episodeId,
    chapterId,
    editScriptId: planned.editScript.id,
    item,
    shots: planned.shots,
    segmentIndex,
  })
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [plannedTask.task],
    metadata: {
      episodeId,
      chapterId,
      sourceMode: 'asset_reference',
      segmentIndex,
      videoGroups: [plannedTask.metadata],
    },
  }
}

export async function commitGenerateAssetReferenceVideoPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const metadata = isRecord(params.plan.metadata) ? params.plan.metadata : {}
  const segmentIndex = typeof metadata.segmentIndex === 'number' && Number.isInteger(metadata.segmentIndex)
    ? metadata.segmentIndex
    : -1
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const groupMetadata = readPlannedVideoGroupMetadataList(params.plan)[0]
  if (!groupMetadata) throw new Error('PROJECT_AGENT_VIDEO_GROUP_PLAN_METADATA_MISSING')
  const submitted = await commitPlannedVideoGroupTask({
    ctx: params.ctx,
    input: params.input,
    operationId: params.operationId,
    task,
    metadata: groupMetadata,
  })
  writeOperationDataPart<TaskSubmittedPartData>(params.ctx.writer, 'data-task-submitted', {
    operationId: params.operationId,
    taskId: submitted.result.taskId,
    status: submitted.result.status,
    runId: submitted.result.runId || null,
    deduped: submitted.result.deduped,
    billingReceipt: submitted.result.billingReceiptView,
    projectId: params.ctx.projectId,
    episodeId: groupMetadata.episodeId,
    taskType: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: groupMetadata.groupId,
  })
  return {
    ...submitted.result,
    groupId: groupMetadata.groupId,
    taskType: TASK_TYPE.VIDEO_GROUP,
    targetType: 'ProjectVideoGroup',
    targetId: groupMetadata.groupId,
    episodeId: groupMetadata.episodeId,
    chapterId: groupMetadata.chapterId,
    sourceMode: 'asset_reference' as const,
    segmentIndex,
    shotIds: groupMetadata.shotIds,
    durationSec: groupMetadata.durationSec,
  }
}

export async function planGenerateEpisodeAssetReferenceVideosOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const episodeId = normalizeString(params.input.episodeId) || normalizeString(params.ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const chapterId = await resolveEditChapterId(episodeId, normalizeString(params.input.chapterId))
  const planned = await buildEpisodeGenerationSegmentVideoPlan({
    ctx: params.ctx,
    episodeId,
    chapterId,
  })

  const plannedTasks = []
  for (const [segmentIndex, item] of planned.plan.items.entries()) {
    plannedTasks.push(await planAssetReferenceGenerationSegmentTask({
      ctx: params.ctx,
      input: params.input,
      operationId: params.operationId,
      episodeId,
      chapterId,
      editScriptId: planned.editScript.id,
      item,
      shots: planned.shots,
      segmentIndex,
    }))
  }
  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: plannedTasks.map((item) => item.task),
    metadata: {
      episodeId,
      chapterId,
      sourceMode: 'asset_reference',
      videoGroups: plannedTasks.map((item) => item.metadata),
    },
  }
}

export async function commitGenerateEpisodeAssetReferenceVideosPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
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
    sourceMode: 'asset_reference' as const,
  }
}
