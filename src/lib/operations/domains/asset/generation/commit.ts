import { ensureAssetGenerateCommitReady } from '@/lib/assets/services/asset-actions'
import { createMutationBatch } from '@/lib/mutation-batch/service'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import { readProjectAssetImagePlanMetadata } from './shared'

export async function commitAssetImageOperation(params: {
  ctx: ProjectAgentOperationContext
  input: { confirmed?: boolean }
  plan: OperationPlan
  operationId: string
}) {
  const task = params.plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const metadata = readProjectAssetImagePlanMetadata(params.plan)
  if (params.operationId === 'generate_character_image' || params.operationId === 'generate_location_image') {
    await ensureAssetGenerateCommitReady({
      request: params.ctx.request,
      kind: metadata.assetKind,
      assetId: metadata.assetId,
      body: task.payload,
      access: {
        scope: 'project',
        userId: params.ctx.userId,
        projectId: params.ctx.projectId,
      },
    })
  }
  const result = await submitPlannedOperationTask({
    ctx: params.ctx,
    task,
    operationId: params.operationId,
    confirmed: params.input.confirmed === true,
  })

  const mutationBatch = await createMutationBatch({
    projectId: params.ctx.projectId,
    userId: params.ctx.userId,
    source: params.ctx.source,
    operationId: params.operationId,
    episodeId: null,
    summary: `${params.operationId}:${metadata.assetId}`,
    entries: [
      {
        kind: 'asset_render_revert',
        targetType: metadata.mutationTargetType,
        targetId: metadata.mutationTargetId,
        payload: {
          kind: metadata.assetKind,
          assetId: metadata.assetId,
          ...(metadata.appearanceId ? { appearanceId: metadata.appearanceId } : {}),
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
    episodeId: null,
    taskType: task.taskType,
    targetType: metadata.mutationTargetType,
    targetId: metadata.mutationTargetId,
  })

  return {
    ...result,
    assetId: metadata.assetId,
    characterId: metadata.assetKind === 'character' ? metadata.assetId : '',
    locationId: metadata.assetKind === 'location' ? metadata.assetId : '',
    appearanceId: metadata.appearanceId,
    taskType: task.taskType,
    targetType: metadata.mutationTargetType,
    targetId: metadata.mutationTargetId,
    mutationBatchId: mutationBatch.id,
  }
}
