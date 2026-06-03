import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { generateCleanImageToStorage } from './image-task-handler-shared'

const EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_READY = 'style_preview_ready'
const EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO = '1:1'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function readGenerationOptions(value: unknown): { resolution?: string; quality?: string; size?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    ...(typeof record.resolution === 'string' && record.resolution.trim()
      ? { resolution: record.resolution.trim() }
      : {}),
    ...(typeof record.quality === 'string' && record.quality.trim()
      ? { quality: record.quality.trim() }
      : {}),
    ...(typeof record.size === 'string' && record.size.trim()
      ? { size: record.size.trim() }
      : {}),
  }
}

async function updateScreenplayStatusIfAllPreviewsCompleted(editScreenplayId: string) {
  const previews = await prisma.projectEditStylePreview.findMany({
    where: { editScreenplayId },
    select: { status: true },
  })
  if (previews.length !== 3) return
  if (!previews.every((preview) => preview.status === 'completed')) return
  await prisma.projectEditScreenplay.update({
    where: { id: editScreenplayId },
    data: { status: EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_READY },
  })
}

export async function handleEditStylePreviewImageTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const stylePreviewId = readRequiredString(payload.stylePreviewId ?? job.data.targetId, 'stylePreviewId')
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const prompt = readRequiredString(payload.prompt, 'prompt')
  const generationOptions = readGenerationOptions(payload.generationOptions)

  const preview = await prisma.projectEditStylePreview.findFirst({
    where: {
      id: stylePreviewId,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId ?? undefined,
    },
    select: {
      id: true,
      editScreenplayId: true,
    },
  })
  if (!preview) throw new Error(`EDIT_STYLE_PREVIEW_NOT_FOUND:${stylePreviewId}`)

  await reportTaskProgress(job, 20, {
    stage: 'edit_style_preview_image_prepare',
    stageLabel: 'progress.stage.editStylePreviewImagePrepare',
    displayMode: 'detail',
  })

  try {
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
      options: {
        aspectRatio: EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO,
        ...generationOptions,
      },
    })

    await prisma.projectEditStylePreview.update({
      where: { id: preview.id },
      data: {
        imageKey,
        status: 'completed',
        errorMessage: null,
      },
    })
    await updateScreenplayStatusIfAllPreviewsCompleted(preview.editScreenplayId)

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
      aspectRatio: EDIT_STYLE_PREVIEW_GRID_ASPECT_RATIO,
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    await prisma.projectEditStylePreview.update({
      where: { id: preview.id },
      data: {
        status: 'failed',
        errorMessage: message,
      },
    })
    throw caught
  }
}
