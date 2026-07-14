import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { ensureMediaObjectFromStorageKey, getMediaObjectById } from '@/lib/media/service'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import type { TaskJobData } from '@/lib/task/types'
import { assertFinalRenderClipsHaveSources, normalizeFinalRenderErrorLocale } from '@/lib/video-compose/final-render-errors'
import { buildFinalRenderClips, resolveFinalRenderDimensions } from '@/lib/video-compose/final-render-plan'
import { concatFinalRenderAudioClips, muxFinalRenderSourceAudio, renderFinalRenderClipAudio } from '@/lib/video-compose/final-render-audio'
import { createFfmpegCommandRunner } from '@/lib/video-compose/ffmpeg-command'
import { reportTaskProgress } from './shared'
import { assertTaskActive } from './utils'
import {
  buildEditScript,
  concatClips,
  normalizeClip,
  probeDurationSeconds,
  writeVideoSourceToFile,
} from './final-video-render'

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

async function persistChapterRenderSuccess(input: {
  readonly chapterId: string
  readonly episodeId: string
  readonly taskId: string
  readonly outputMediaId: string
}): Promise<void> {
  const persisted = await prisma.projectEditChapter.updateMany({
    where: {
      id: input.chapterId,
      episodeId: input.episodeId,
      renderTaskId: input.taskId,
      renderStatus: 'processing',
    },
    data: {
      renderStatus: 'completed',
      outputMediaId: input.outputMediaId,
    },
  })
  if (persisted.count !== 1) {
    throw new Error(`CHAPTER_RENDER_SUCCESS_OWNERSHIP_STALE:${input.chapterId}:${input.taskId}`)
  }
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
      select: {
        id: true,
        renderStatus: true,
        renderTaskId: true,
        outputMediaId: true,
      },
    }),
  ])
  if (!project) throw new Error('CHAPTER_RENDER_PROJECT_NOT_FOUND')
  if (!chapter) throw new Error('CHAPTER_RENDER_CHAPTER_NOT_FOUND')
  if (
    chapter.renderStatus === 'completed'
    && chapter.renderTaskId === job.data.taskId
    && chapter.outputMediaId
  ) {
    const media = await getMediaObjectById(chapter.outputMediaId)
    if (!media) throw new Error(`CHAPTER_RENDER_OUTPUT_MEDIA_MISSING:${chapter.id}`)
    if (!media.durationMs || !media.width || !media.height) {
      throw new Error(`CHAPTER_RENDER_OUTPUT_METADATA_MISSING:${chapter.id}`)
    }
    return {
      episodeId,
      chapterId,
      mediaId: media.id,
      outputUrl: media.url,
      storageKey: media.storageKey,
      durationSeconds: media.durationMs / 1000,
      width: media.width,
      height: media.height,
    }
  }
  if (chapter.renderTaskId !== job.data.taskId || chapter.renderStatus !== 'processing') {
    throw new Error(`CHAPTER_RENDER_TASK_OWNERSHIP_STALE:${chapterId}:${job.data.taskId}`)
  }

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-chapter-render-${randomUUID()}-`))
  try {
    await reportTaskProgress(job, 10, { stage: 'chapter_render_prepare', chapterId })
    const [editScript, videoSegments] = await Promise.all([
      buildEditScript(episodeId, chapterId),
      prisma.projectVideoSegment.findMany({
        where: { episodeId, chapterId, projectId: job.data.projectId },
        include: { videoMedia: true },
      }),
    ])
    if (!editScript) throw new Error(`CHAPTER_RENDER_EDIT_SCRIPT_REQUIRED:${chapterId}`)
    const clips = buildFinalRenderClips({ videoSegments, editScript })
    if (clips.length === 0) throw new Error(`CHAPTER_RENDER_NO_VIDEO_CLIPS:${chapterId}`)
    assertFinalRenderClipsHaveSources({
      clips,
      locale: normalizeFinalRenderErrorLocale(job.data.locale),
    })

    const dimensions = resolveFinalRenderDimensions(project.videoRatio)
    const plannedDurationSeconds = clips.reduce((sum, clip) => sum + clip.durationSeconds, 0)
    const normalizedPaths: string[] = []
    const clipAudioPaths: string[] = []
    let hasSourceAudio = false
    for (const clip of clips) {
      const sourcePath = path.join(workspaceDir, `source-${clip.order}.mp4`)
      const normalizedPath = path.join(workspaceDir, `clip-${clip.order}.mp4`)
      const clipAudioPath = path.join(workspaceDir, `clip-audio-${clip.order}.wav`)
      await writeVideoSourceToFile(clip.source, sourcePath)
      await normalizeClip({
        sourcePath,
        outputPath: normalizedPath,
        durationSeconds: clip.durationSeconds,
        width: dimensions.width,
        height: dimensions.height,
      })
      const clipHasAudio = await renderFinalRenderClipAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'chapter_render_clip_audio',
          expectedDurationSeconds: clip.durationSeconds,
        }),
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
      durationSeconds: plannedDurationSeconds,
    })
    const durationSeconds = await probeDurationSeconds(stitchedPath)
    const mainAudioPath = path.join(workspaceDir, 'main-audio.wav')
    await concatFinalRenderAudioClips({
      runCommand: createFfmpegCommandRunner({
        stage: 'chapter_render_concat_audio',
        expectedDurationSeconds: durationSeconds,
      }),
      clipAudioPaths,
      outputPath: mainAudioPath,
      durationSeconds,
    })
    const outputPath = path.join(workspaceDir, 'chapter.mp4')
    await muxFinalRenderSourceAudio({
      runCommand: createFfmpegCommandRunner({
        stage: 'chapter_render_mux_source_audio',
        expectedDurationSeconds: durationSeconds,
      }),
      stitchedPath,
      mainAudioPath,
      hasSourceAudio,
      outputPath,
      durationSeconds,
    })

    await reportTaskProgress(job, 92, { stage: 'chapter_render_persist', chapterId })
    const outputBuffer = await readFile(outputPath)
    const storageKey = await uploadObject(
      outputBuffer,
      buildTaskArtifactStorageKey({
        taskId: job.data.taskId,
        artifact: `chapter-video:${chapterId}`,
        extension: 'mp4',
      }),
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
    await assertTaskActive(job, 'persist_chapter_render')
    await persistChapterRenderSuccess({
      chapterId,
      episodeId,
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
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
