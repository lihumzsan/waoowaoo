import type { Job } from 'bullmq'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  buildImageProviderRuntimeOptions,
  generateCleanImageToStorage,
} from './image-task-handler-shared'

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`CONTINUITY_EXPERIMENT_${field.toUpperCase()}_REQUIRED`)
  }
  return value.trim()
}

export async function handleContinuityExperimentImageTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const runId = requireString(payload.runId, 'run_id')
  const cellId = requireString(payload.cellId, 'cell_id')
  const modelId = requireString(payload.imageModel, 'image_model')
  const prompt = requireString(payload.prompt, 'prompt')
  const runtimeOptions = buildImageProviderRuntimeOptions({
    generationOptions: payload.generationOptions,
    context: 'continuity_experiment_image',
  })

  await reportTaskProgress(job, 20, {
    stage: 'continuity_experiment_prepare',
    stageLabel: 'progress.stage.continuityExperimentPrepare',
    displayMode: 'detail',
  })
  await reportTaskProgress(job, 42, {
    stage: 'continuity_experiment_generate',
    stageLabel: 'progress.stage.continuityExperimentGenerate',
    displayMode: 'detail',
  })

  const imageKey = await generateCleanImageToStorage({
    job,
    userId: job.data.userId,
    modelId,
    prompt,
    targetId: `${runId}-${cellId}`,
    keyPrefix: 'continuity-experiment',
    allowTaskExternalIdResume: true,
    options: runtimeOptions,
  })

  await reportTaskProgress(job, 95, {
    stage: 'continuity_experiment_complete',
    stageLabel: 'progress.stage.continuityExperimentComplete',
    displayMode: 'detail',
  })

  return {
    runId,
    cellId,
    storyId: requireString(payload.storyId, 'story_id'),
    variantId: requireString(payload.variantId, 'variant_id'),
    shotId: requireString(payload.shotId, 'shot_id'),
    imageKey,
    imageUrl: getSignedUrl(imageKey, 7 * 24 * 3600),
    prompt,
    promptPacket: payload.promptPacket || null,
    model: modelId,
  }
}
