import { z } from 'zod'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import {
  CONTINUITY_EXPERIMENT_STORY_IDS,
  CONTINUITY_EXPERIMENT_VARIANT_IDS,
  findContinuityExperimentShot,
  findContinuityExperimentStory,
} from '@/lib/continuity-experiment/catalog'
import {
  compileContinuityExperimentCell,
  type ContinuityExperimentCellInput,
} from '@/lib/continuity-experiment/compiler'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
} from '@/lib/operations/planning'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'
import { resolveLocaleFromContext } from '@/lib/operations/domains/storyboard/generation/image/shared'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'

export const continuityExperimentCellInputSchema = z.object({
  storyId: z.enum(CONTINUITY_EXPERIMENT_STORY_IDS),
  variantId: z.enum(CONTINUITY_EXPERIMENT_VARIANT_IDS),
  shotId: z.string().trim().min(1).max(16),
}).strict()

export const continuityExperimentInputSchema = z.object({
  runId: z.string().uuid(),
  cells: z.array(continuityExperimentCellInputSchema).min(1).max(54),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>()
  for (const [index, cell] of value.cells.entries()) {
    const story = findContinuityExperimentStory(cell.storyId)
    try {
      findContinuityExperimentShot(story, cell.shotId)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown shot ${cell.storyId}:${cell.shotId}`,
        path: ['cells', index, 'shotId'],
      })
    }
    const key = `${cell.storyId}:${cell.variantId}:${cell.shotId}`
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate experiment cell ${key}`,
        path: ['cells', index],
      })
    }
    seen.add(key)
  }
})

export type ContinuityExperimentInput = z.infer<typeof continuityExperimentInputSchema>

export async function planContinuityExperimentImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: ContinuityExperimentInput,
): Promise<OperationPlan> {
  const projectModelConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
  if (!projectModelConfig.storyboardModel) throw new Error('STORYBOARD_MODEL_NOT_CONFIGURED')
  await resolveModelSelection(ctx.userId, projectModelConfig.storyboardModel, 'image')

  const locale = resolveLocaleFromContext(ctx.context.locale)
  const tasks = await Promise.all(input.cells.map(async (cell) => {
    const compiled = compileContinuityExperimentCell({
      ...(cell as ContinuityExperimentCellInput),
      locale,
    })
    const basePayload = {
      runId: input.runId,
      cellId: compiled.cellId,
      storyId: compiled.storyId,
      variantId: compiled.variantId,
      shotId: compiled.shotId,
      prompt: compiled.prompt,
      promptPacket: compiled.packet,
      meta: { locale },
    }
    const billingPayload = await buildImageBillingPayload({
      projectId: ctx.projectId,
      userId: ctx.userId,
      imageModel: projectModelConfig.storyboardModel,
      basePayload,
      aspectRatio: projectModelConfig.videoRatio,
    })
    return createPlannedTask({
      id: `continuity_experiment:${compiled.cellId}`,
      taskType: TASK_TYPE.CONTINUITY_EXPERIMENT_IMAGE,
      targetType: 'Project',
      targetId: ctx.projectId,
      locale,
      payload: withTaskUiPayload(billingPayload, {
        intent: 'generate',
        hasOutputAtStart: false,
      }),
      dedupeKey: `continuity_experiment:${input.runId}:${compiled.cellId}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.CONTINUITY_EXPERIMENT_IMAGE,
        payload: billingPayload,
        allowedApiTypes: ['image'],
      }),
    })
  }))

  return {
    kind: 'task_submission',
    operationId: 'generate_continuity_experiment_images',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    metadata: {
      runId: input.runId,
      cellIds: input.cells.map((cell) => `${cell.storyId}:${cell.variantId}:${cell.shotId}`),
    },
  }
}

export async function commitContinuityExperimentImagesOperation(
  ctx: ProjectAgentOperationContext,
  input: ContinuityExperimentInput,
  plan: OperationPlan,
) {
  requireOperationExecutionTransaction(ctx)
  const submitted = await submitPlannedOperationTasks({
    ctx,
    operationId: 'generate_continuity_experiment_images',
  })
  const results = plan.tasks.map((task) => {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`CONTINUITY_EXPERIMENT_TASK_RESULT_MISSING:${task.id}`)
    const refId = task.id.replace(/^continuity_experiment:/, '')
    return {
      refId,
      taskId: result.taskId,
      taskType: task.taskType,
      targetType: task.target.targetType,
      targetId: task.target.targetId,
      billingReceipt: result.billingReceiptView,
    }
  })
  return {
    success: true,
    async: true,
    total: results.length,
    taskIds: results.map((item) => item.taskId),
    results,
    runId: input.runId,
  }
}
