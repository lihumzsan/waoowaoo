import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Job } from 'bullmq'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { assertFinalRenderClipsHaveSources, normalizeFinalRenderErrorLocale } from '@/lib/video-compose/final-render-errors'
import { buildFinalRenderClips, resolveFinalRenderDimensions } from '@/lib/video-compose/final-render-plan'
import { concatFinalRenderAudioClips, muxFinalRenderSourceAudio, renderFinalRenderClipAudio } from '@/lib/video-compose/final-render-audio'
import { reportTaskProgress } from './shared'
import {
  buildEditScript,
  concatClips,
  normalizeClip,
  probeDurationSeconds,
  runCommand,
  writeVideoSourceToFile,
} from './final-video-render'

const logger = createScopedLogger({ module: 'worker.chapter-render' })

type ChapterRenderPayload = {
  readonly episodeId?: unknown
  readonly chapterId?: unknown
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveChapterIdFromJob(job: Job<TaskJobData>, payload: ChapterRenderPayload): string {
  const explicit = readString(payload.chapterId)
  if (explicit) return explicit
  if (job.data.targetType === 'ProjectEditChapter') return job.data.targetId
  throw new Error('CHAPTER_RENDER_CHAPTER_REQUIRED')
}

async function markChapterRenderStatus(input: {
  readonly chapterId: string
  readonly renderStatus: string
  readonly taskId: string
  readonly outputMediaId?: string | null
}): Promise<void> {
  await prisma.projectEditChapter.update({
    where: { id: input.chapterId },
    data: {
      renderStatus: input.renderStatus,
      renderTaskId: input.taskId,
      ...(input.outputMediaId !== undefined ? { outputMediaId: input.outputMediaId } : {}),
    },
  })
}

export async function handleChapterRenderTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as ChapterRenderPayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const chapterId = resolveChapterIdFromJob(job, payload)
  if (!episodeId) throw new Error('CHAPTER_RENDER_EPISODE_REQUIRED')

  const [project, chapter] = await Promise.all([
    prisma.project.findUnique({
      where: { id: job.data.projectId },
      select: { videoRatio: true },
    }),
    prisma.projectEditChapter.findFirst({
      where: {
        id: chapterId,
        episodeId,
        episode: { projectId: job.data.projectId },
      },
      select: { id: true },
    }),
  ])
  if (!project) throw new Error('CHAPTER_RENDER_PROJECT_NOT_FOUND')
  if (!chapter) throw new Error('CHAPTER_RENDER_CHAPTER_NOT_FOUND')

  await markChapterRenderStatus({
    chapterId,
    renderStatus: 'processing',
    taskId: job.data.taskId,
  })

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-chapter-render-${randomUUID()}-`))
  try {
    await reportTaskProgress(job, 10, { stage: 'chapter_render_prepare', chapterId })
    const [editScript, panels, videoGroups] = await Promise.all([
      buildEditScript(episodeId, chapterId),
      prisma.projectPanel.findMany({
        where: { storyboard: { episodeId, chapterId } },
        include: {
          videoMedia: true,
          storyboard: {
            select: {
              id: true,
              editScriptId: true,
              createdAt: true,
              storyboardTextJson: true,
            },
          },
        },
      }),
      prisma.projectVideoGroup.findMany({
        where: { episodeId, chapterId, projectId: job.data.projectId },
        include: { videoMedia: true },
      }),
    ])
    if (!editScript) throw new Error(`CHAPTER_RENDER_EDIT_SCRIPT_REQUIRED:${chapterId}`)
    const clips = buildFinalRenderClips({ panels, videoGroups, editScript })
    if (clips.length === 0) throw new Error(`CHAPTER_RENDER_NO_VIDEO_CLIPS:${chapterId}`)
    assertFinalRenderClipsHaveSources({
      clips,
      locale: normalizeFinalRenderErrorLocale(job.data.locale),
    })

    const dimensions = resolveFinalRenderDimensions(project.videoRatio)
    const normalizedPaths: string[] = []
    const clipAudioPaths: string[] = []
    let hasSourceAudio = false
    for (const clip of clips) {
      const sourcePath = path.join(workspaceDir, `source-${clip.order}.mp4`)
      const normalizedPath = path.join(workspaceDir, `clip-${clip.order}.mp4`)
      const clipAudioPath = path.join(workspaceDir, `clip-audio-${clip.order}.m4a`)
      await writeVideoSourceToFile(clip.source, sourcePath)
      await normalizeClip({
        sourcePath,
        outputPath: normalizedPath,
        durationSeconds: clip.durationSeconds,
        width: dimensions.width,
        height: dimensions.height,
      })
      const clipHasAudio = await renderFinalRenderClipAudio({
        runCommand,
        sourcePath,
        outputPath: clipAudioPath,
        durationSeconds: clip.durationSeconds,
      })
      hasSourceAudio = hasSourceAudio || clipHasAudio
      normalizedPaths.push(normalizedPath)
      clipAudioPaths.push(clipAudioPath)
    }

    await reportTaskProgress(job, 60, { stage: 'chapter_render_compose', chapterId })
    const stitchedPath = path.join(workspaceDir, 'stitched.mp4')
    await concatClips({
      clipPaths: normalizedPaths,
      listPath: path.join(workspaceDir, 'concat.txt'),
      outputPath: stitchedPath,
    })
    const durationSeconds = await probeDurationSeconds(stitchedPath)
    const mainAudioPath = path.join(workspaceDir, 'main-audio.m4a')
    await concatFinalRenderAudioClips({
      runCommand,
      clipAudioPaths,
      outputPath: mainAudioPath,
    })
    const outputPath = path.join(workspaceDir, 'chapter.mp4')
    await muxFinalRenderSourceAudio({
      runCommand,
      stitchedPath,
      mainAudioPath,
      hasSourceAudio,
      outputPath,
    })

    await reportTaskProgress(job, 92, { stage: 'chapter_render_persist', chapterId })
    const outputBuffer = await readFile(outputPath)
    const storageKey = await uploadObject(
      outputBuffer,
      generateUniqueKey('chapter-video', 'mp4'),
      1,
      'video/mp4',
    )
    const media = await ensureMediaObjectFromStorageKey(storageKey, {
      mimeType: 'video/mp4',
      sizeBytes: outputBuffer.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      durationMs: Math.round(durationSeconds * 1000),
    })
    await markChapterRenderStatus({
      chapterId,
      renderStatus: 'completed',
      taskId: job.data.taskId,
      outputMediaId: media.id,
    })

    return {
      episodeId,
      chapterId,
      mediaId: media.id,
      outputUrl: media.url,
      storageKey,
      clipCount: clips.length,
      durationSeconds,
      width: dimensions.width,
      height: dimensions.height,
    }
  } catch (error) {
    try {
      await markChapterRenderStatus({
        chapterId,
        renderStatus: 'failed',
        taskId: job.data.taskId,
      })
    } catch (statusError) {
      logger.warn({
        action: 'chapter_render.mark_failed_status_failed',
        message: 'failed to mark chapter render status after render error',
        details: {
          chapterId,
          taskId: job.data.taskId,
          error: statusError instanceof Error ? statusError.message : String(statusError),
        },
      })
    }
    throw error
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
