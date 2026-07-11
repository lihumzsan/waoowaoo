import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  EDIT_STYLE_PREVIEW_GRID_TARGET_RESOLUTION,
} from '@/lib/edit-script/style-preview-image-constants'
import { buildImageProviderRuntimeOptions, generateCleanImageToStorage } from './image-task-handler-shared'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

export async function handleEditStylePreviewImageTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const stylePreviewId = readRequiredString(payload.stylePreviewId ?? job.data.targetId, 'stylePreviewId')
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const prompt = readRequiredString(payload.prompt, 'prompt')
  const imageRuntimeOptions = buildImageProviderRuntimeOptions({
    generationOptions: payload.generationOptions,
    context: 'edit_style_preview_image',
  })

  const preview = await prisma.projectEditStylePreview.findFirst({
    where: {
      id: stylePreviewId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId ?? undefined,
      taskId: job.data.taskId,
    },
    select: {
      id: true,
      status: true,
      imageKey: true,
    },
  })
  if (!preview) throw new Error(`EDIT_STYLE_PREVIEW_NOT_FOUND:${stylePreviewId}`)
  if (preview.status === 'completed') {
    if (!preview.imageKey) throw new Error(`EDIT_STYLE_PREVIEW_COMPLETED_IMAGE_MISSING:${preview.id}`)
    return {
      stylePreviewId: preview.id,
      imageKey: preview.imageKey,
      imageUrl: getSignedUrl(preview.imageKey, 7 * 24 * 3600),
      prompt,
      aspectRatio: imageRuntimeOptions.aspectRatio,
      targetResolution: EDIT_STYLE_PREVIEW_GRID_TARGET_RESOLUTION,
    }
  }
  if (preview.status !== 'pending' && preview.status !== 'generating') {
    throw new Error(`EDIT_STYLE_PREVIEW_TASK_OWNERSHIP_STALE:${preview.id}:${job.data.taskId}`)
  }

  await reportTaskProgress(job, 20, {
    stage: 'edit_style_preview_image_prepare',
    stageLabel: 'progress.stage.editStylePreviewImagePrepare',
    displayMode: 'detail',
  })

  const started = await prisma.projectEditStylePreview.updateMany({
    where: { id: preview.id, taskId: job.data.taskId, status: { in: ['pending', 'generating'] } },
    data: {
      status: 'generating',
      taskId: job.data.taskId,
      errorMessage: null,
    },
  })
  if (started.count !== 1) throw new Error(`EDIT_STYLE_PREVIEW_TASK_OWNERSHIP_STALE:${preview.id}:${job.data.taskId}`)

  await reportTaskProgress(job, 45, {
    stage: 'edit_style_preview_image_generate',
    stageLabel: 'progress.stage.editStylePreviewImageGenerate',
    displayMode: 'detail',
  })

  const imageKey = await generateCleanImageToStorage({
    job,
    userId: job.data.userId,
    modelId,
    prompt,
    targetId: preview.id,
    keyPrefix: 'edit-style-preview',
    options: imageRuntimeOptions,
  })

  const completed = await prisma.projectEditStylePreview.updateMany({
    where: { id: preview.id, taskId: job.data.taskId, status: 'generating' },
    data: {
      imageKey,
      status: 'completed',
      errorMessage: null,
    },
  })
  if (completed.count !== 1) throw new Error(`EDIT_STYLE_PREVIEW_TASK_OWNERSHIP_STALE:${preview.id}:${job.data.taskId}`)

  await reportTaskProgress(job, 95, {
    stage: 'edit_style_preview_image_persist',
    stageLabel: 'progress.stage.editStylePreviewImagePersist',
    displayMode: 'detail',
  })

  return {
    stylePreviewId: preview.id,
    imageKey,
    imageUrl: getSignedUrl(imageKey, 7 * 24 * 3600),
    prompt,
    aspectRatio: imageRuntimeOptions.aspectRatio,
    targetResolution: EDIT_STYLE_PREVIEW_GRID_TARGET_RESOLUTION,
  }
}
