import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { createMutationBatchInTransaction } from '@/lib/mutation-batch/service'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import {
  applySystemVideoDuration,
  assertNoManagedVideoModelInput,
  buildVideoTaskPayload,
  isRecord,
  normalizeString,
  requirePanelSystemVideoDurationSec,
  validateVideoTaskPayloadOrThrow,
  type UnknownObject,
} from './shared'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'

export type PlannedPanelVideoMetadata = {
  panelId: string
  episodeId: string | null
  previousVideoUrl: string | null
  previousLastVideoGenerationOptions: unknown
}

export function readPlannedPanelVideoMetadata(plan: OperationPlan): PlannedPanelVideoMetadata {
  const metadata = isRecord(plan.metadata) ? plan.metadata : {}
  const panelId = normalizeString(metadata.panelId)
  if (!panelId) throw new Error('PROJECT_AGENT_PANEL_VIDEO_PLAN_METADATA_INVALID')
  return {
    panelId,
    episodeId: normalizeString(metadata.episodeId) || null,
    previousVideoUrl: normalizeString(metadata.previousVideoUrl) || null,
    previousLastVideoGenerationOptions: metadata.previousLastVideoGenerationOptions,
  }
}

export async function planGeneratePanelVideoOperation(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
}): Promise<OperationPlan> {
  assertNoManagedVideoModelInput(params.input)
  const { payload, localeForTask } = buildVideoTaskPayload({
    ctx: params.ctx,
    input: params.input,
  })
  let panelId = normalizeString(payload.panelId)
  let previousVideoUrl: string | null = null
  let previousLastVideoGenerationOptions: unknown = null
  let episodeId: string | null = null
  if (!panelId) {
    const storyboardId = normalizeString(payload.storyboardId)
    const panelIndex = typeof payload.panelIndex === 'number' ? payload.panelIndex : NaN
    if (!storyboardId || !Number.isFinite(panelIndex)) {
      throw new Error('PROJECT_AGENT_PANEL_REQUIRED')
    }
    const panel = await prisma.projectPanel.findFirst({
      where: { storyboardId, panelIndex: Number(panelIndex) },
      select: {
        id: true,
        videoUrl: true,
        duration: true,
        lastVideoGenerationOptions: true,
        storyboard: { select: { episodeId: true } },
      },
    })
    panelId = panel?.id || ''
    previousVideoUrl = panel?.videoUrl ?? null
    previousLastVideoGenerationOptions = panel?.lastVideoGenerationOptions ?? null
    episodeId = panel?.storyboard.episodeId ?? null
    if (panel) applySystemVideoDuration(payload, requirePanelSystemVideoDurationSec(panel.id, panel.duration))
  }
  if (!panelId) {
    throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
  }
  if (normalizeString(payload.panelId)) {
    const panel = await prisma.projectPanel.findUnique({
      where: { id: panelId },
      select: {
        videoUrl: true,
        duration: true,
        lastVideoGenerationOptions: true,
        storyboard: { select: { episodeId: true } },
      },
    })
    if (!panel) {
      throw new Error('PROJECT_AGENT_PANEL_NOT_FOUND')
    }
    previousVideoUrl = panel.videoUrl ?? null
    previousLastVideoGenerationOptions = panel.lastVideoGenerationOptions ?? null
    episodeId = panel.storyboard.episodeId
    applySystemVideoDuration(payload, requirePanelSystemVideoDurationSec(panelId, panel.duration))
  }

  await validateVideoTaskPayloadOrThrow({
    payload,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    modelPurpose: 'single-shot-video',
    lastVideoGenerationOptions: previousLastVideoGenerationOptions,
  })

  return {
    kind: 'task_submission',
    operationId: params.operationId,
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    tasks: [
      createPlannedTask({
        id: `${params.operationId}:${panelId}`,
        taskType: TASK_TYPE.VIDEO_PANEL,
        targetType: 'ProjectPanel',
        targetId: panelId,
        locale: localeForTask,
        episodeId,
        payload: withTaskUiPayload(payload, {
          hasOutputAtStart: await hasPanelVideoOutput(panelId),
        }),
        dedupeKey: `video_panel:${panelId}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.VIDEO_PANEL,
          payload,
          allowedApiTypes: ['video'],
        }),
      }),
    ],
    metadata: {
      panelId,
      episodeId,
      previousVideoUrl,
      previousLastVideoGenerationOptions,
    },
  }
}

export async function commitGeneratePanelVideoPlan(params: {
  ctx: ProjectAgentOperationContext
  input: UnknownObject
  operationId: string
  plan: OperationPlan
}) {
  const transaction = requireOperationExecutionTransaction(params.ctx)
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const metadata = readPlannedPanelVideoMetadata(params.plan)
  const result = await submitPlannedOperationTask({
    ctx: params.ctx,
    task,
    operationId: params.operationId,
  })

  const mutationBatch = await createMutationBatchInTransaction(transaction, {
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    source: params.ctx.source,
    operationId: params.operationId,
    episodeId: metadata.episodeId,
    summary: `${params.operationId}:${metadata.panelId}`,
    entries: [
      {
        kind: 'panel_video_restore',
        targetType: 'ProjectPanel',
        targetId: metadata.panelId,
        payload: {
          previousVideoUrl: metadata.previousVideoUrl,
          previousLastVideoGenerationOptions: metadata.previousLastVideoGenerationOptions,
        },
      },
    ],
  })

  writeOperationDataPart<TaskSubmittedPartData>(params.ctx.writer, 'data-task-submitted', {
    operationId: params.operationId,
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    mutationBatchId: mutationBatch.id,
    projectId: params.ctx.projectId,
    episodeId: metadata.episodeId,
    taskType: TASK_TYPE.VIDEO_PANEL,
    targetType: 'ProjectPanel',
    targetId: metadata.panelId,
  })

  return {
    ...result,
    panelId: metadata.panelId,
    taskType: TASK_TYPE.VIDEO_PANEL,
    targetType: 'ProjectPanel',
    targetId: metadata.panelId,
    mutationBatchId: mutationBatch.id,
  }
}
