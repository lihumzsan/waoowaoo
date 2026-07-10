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
    },
    select: {
      id: true,
    },
  })
  if (!preview) throw new Error(`EDIT_STYLE_PREVIEW_NOT_FOUND:${stylePreviewId}`)

  await reportTaskProgress(job, 20, {
    stage: 'edit_style_preview_image_prepare',
    stageLabel: 'progress.stage.editStylePreviewImagePrepare',
    displayMode: 'detail',
  })

  await prisma.projectEditStylePreview.update({
    where: { id: preview.id },
    data: {
      status: 'generating',
      taskId: job.data.taskId,
      errorMessage: null,
    },
  })

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

  await prisma.projectEditStylePreview.update({
    where: { id: preview.id },
    data: {
      imageKey,
      status: 'completed',
      errorMessage: null,
    },
  })

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
