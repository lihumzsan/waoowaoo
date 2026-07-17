import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import {
  readCompletedMusicScoreMix,
} from '@/lib/music-score/project-data'
import { buildGainAutomationVolumeFilter } from '@/lib/bgm-design/automation'
import { buildBgmDesignTimelineSignature, parseBgmDesignStrict } from '@/lib/bgm-design/contract'
import { parseNullableEditScriptStyleBible } from '@/lib/edit-script/style-bible-prompt'
import { ensureMediaObjectFromStorageKey, getMediaObjectById, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from './shared'
import { assertTaskActive } from './utils'
import {
  resolveFinalRenderDimensions,
  type FinalRenderClipPlan,
  type FinalRenderEditScriptInput,
} from '@/lib/video-compose/final-render-plan'
import { loadEditScriptCoreView } from '@/lib/edit-script/core-view'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import {
  assertFinalRenderClipsHaveSources,
  normalizeFinalRenderErrorLocale,
} from '@/lib/video-compose/final-render-errors'
import {
  concatFinalRenderAudioClips,
  applyFinalRenderMasterAutomation,
  muxFinalRenderAudio,
  renderFinalRenderAutomatedAudio,
  renderFinalRenderClipAudio,
} from '@/lib/video-compose/final-render-audio'
import {
  createFfmpegCommandRunner,
  runFfmpegCommand,
} from '@/lib/video-compose/ffmpeg-command'

type FinalVideoRenderPayload = {
  readonly episodeId?: unknown
  readonly bgmVolume?: unknown
}

const DEFAULT_FINAL_RENDER_BGM_VOLUME = 1
const FINAL_RENDER_BGM_DURATION_TOLERANCE_SECONDS = 0.25

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBgmVolume(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_FINAL_RENDER_BGM_VOLUME
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('FINAL_VIDEO_RENDER_BGM_VOLUME_INVALID')
  }
  return value
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}

export async function probeDurationSeconds(filePath: string): Promise<number> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { stage: 'final_render_probe' })
  const duration = Number.parseFloat(result.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('FINAL_VIDEO_RENDER_PROBE_DURATION_FAILED')
  }
  return duration
}

export async function probeVideoDimensions(filePath: string): Promise<{ readonly width: number; readonly height: number }> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    filePath,
  ], { stage: 'video_probe_dimensions' })
  const [rawWidth, rawHeight] = result.stdout.trim().split('x')
  const width = Number.parseInt(rawWidth ?? '', 10)
  const height = Number.parseInt(rawHeight ?? '', 10)
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('VIDEO_PROBE_DIMENSIONS_FAILED')
  }
  return { width, height }
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
}

export async function writeVideoSourceToFile(source: FinalRenderClipPlan['source'], outputPath: string): Promise<void> {
  const storageKey = await resolveStorageKeyFromMediaValue(source)
  if (storageKey) {
    await writeFile(outputPath, await getObjectBuffer(storageKey))
    return
  }

  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('FINAL_VIDEO_RENDER_SOURCE_INVALID')
  }

  const response = await fetch(toFetchableUrl(source))
  if (!response.ok) {
    throw new Error(`FINAL_VIDEO_RENDER_VIDEO_DOWNLOAD_FAILED:${response.status}`)
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
}

export async function buildEditScript(episodeId: string, chapterId: string): Promise<FinalRenderEditScriptInput | null> {
  const [script, editBible] = await Promise.all([
    prisma.projectEditScript.findUnique({
      where: { chapterId },
      select: {
        id: true,
        projectId: true,
        durationSec: true,
        corePlanJson: true,
        chapter: {
          select: {
            title: true,
            summary: true,
          },
        },
      },
    }),
    prisma.projectEditBible.findUnique({
      where: { episodeId },
      select: { styleBibleJson: true },
    }),
  ])
  if (!script) return null
  if (!script.corePlanJson) throw new Error(`EDIT_SCRIPT_CORE_PLAN_REQUIRED:${script.id}`)
  const core = await loadEditScriptCoreView(script.projectId, script.corePlanJson)
  if (core.shots.length === 0) return null
  const userPrompt = [script.chapter.title, script.chapter.summary]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
  return {
    id: script.id,
    userPrompt,
    durationSec: script.durationSec,
    styleBible: parseNullableEditScriptStyleBible(editBible?.styleBibleJson ?? null),
    shots: core.shots,
    generationSegments: core.generationSegments,
  }
}

export async function normalizeClip(input: {
  readonly sourcePath: string
  readonly outputPath: string
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
}): Promise<void> {
  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-i',
    input.sourcePath,
    '-t',
    input.durationSeconds.toFixed(3),
    '-vf',
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    input.outputPath,
  ], {
    stage: 'final_render_normalize_clip',
    expectedDurationSeconds: input.durationSeconds,
  })
}

export async function concatClips(input: {
  readonly clipPaths: readonly string[]
  readonly listPath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  const lines = input.clipPaths.map((clipPath) => `file '${escapeConcatPath(clipPath)}'`).join('\n')
  await writeFile(input.listPath, `${lines}\n`, 'utf8')
  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    input.listPath,
    '-c',
    'copy',
    input.outputPath,
  ], {
    stage: 'final_render_concat_video',
    expectedDurationSeconds: input.durationSeconds,
  })
}

async function persistEpisodeFinalOutputSuccess(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly outputUrl: string
  readonly outputMediaId: string
}): Promise<void> {
  const persisted = await prisma.projectEpisodeFinalOutput.updateMany({
    where: {
      episodeId: input.episodeId,
      renderTaskId: input.taskId,
      renderStatus: 'processing',
    },
    data: {
      renderStatus: 'completed',
      outputUrl: input.outputUrl,
      outputMediaId: input.outputMediaId,
    },
  })
  if (persisted.count !== 1) {
    throw new Error(`FINAL_VIDEO_RENDER_SUCCESS_OWNERSHIP_STALE:${input.episodeId}:${input.taskId}`)
  }
}

export async function handleFinalVideoRenderTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as FinalVideoRenderPayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  if (!episodeId) throw new Error('FINAL_VIDEO_RENDER_EPISODE_REQUIRED')

  const renderTarget = await prisma.projectEpisodeFinalOutput.findFirst({
    where: {
      episodeId,
    },
    select: { renderStatus: true, renderTaskId: true, outputMediaId: true },
  })
  if (
    renderTarget?.renderStatus === 'completed'
    && renderTarget.renderTaskId === job.data.taskId
    && renderTarget.outputMediaId
  ) {
    const media = await getMediaObjectById(renderTarget.outputMediaId)
    if (!media) throw new Error(`FINAL_VIDEO_RENDER_OUTPUT_MEDIA_MISSING:${episodeId}`)
    if (!media.durationMs || !media.width || !media.height) {
      throw new Error(`FINAL_VIDEO_RENDER_OUTPUT_METADATA_MISSING:${episodeId}`)
    }
    return {
      videoMediaId: media.id,
      outputUrl: media.url,
      storageKey: media.storageKey,
      episodeId,
      durationSeconds: media.durationMs / 1000,
      width: media.width,
      height: media.height,
    }
  }
  if (
    !renderTarget
    || renderTarget.renderTaskId !== job.data.taskId
    || renderTarget.renderStatus !== 'processing'
  ) {
    throw new Error(`FINAL_VIDEO_RENDER_TASK_OWNERSHIP_STALE:${episodeId}:${job.data.taskId}`)
  }

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-final-render-${randomUUID()}-`))
  try {
    await reportTaskProgress(job, 10, { stage: 'final_render_prepare' })
    const [project, episode] = await Promise.all([
      prisma.project.findUnique({
        where: { id: job.data.projectId },
        select: {
          videoRatio: true,
        },
      }),
      prisma.projectEpisode.findFirst({
        where: { id: episodeId, projectId: job.data.projectId },
        select: { id: true },
      }),
    ])
    if (!project) throw new Error('FINAL_VIDEO_RENDER_PROJECT_NOT_FOUND')
    if (!episode) throw new Error('FINAL_VIDEO_RENDER_EPISODE_NOT_FOUND')
    const [clips, musicScore, bgmDesignRow] = await Promise.all([
      loadEpisodeChapterOutputClips({
        episodeId,
        projectId: job.data.projectId,
      }),
      prisma.projectEditMusicScore.findUnique({
        where: { episodeId },
        select: { status: true, mixJson: true, timelineSignature: true, designSignature: true },
      }),
      prisma.projectEditBgmDesign.findUnique({
        where: { episodeId },
        select: { status: true, designJson: true, timelineSignature: true, designSignature: true },
      }),
    ])
    if (bgmDesignRow?.status !== 'planned') throw new Error('FINAL_VIDEO_RENDER_BGM_DESIGN_REQUIRED')
    if (!bgmDesignRow.designSignature) throw new Error('FINAL_VIDEO_RENDER_BGM_DESIGN_SIGNATURE_REQUIRED')
    const bgmDesign = parseBgmDesignStrict(bgmDesignRow.designJson)
    const bgmMix = readCompletedMusicScoreMix(musicScore)
    if (musicScore?.status !== 'completed' || !bgmMix) {
      throw new Error(`FINAL_VIDEO_RENDER_BGM_NOT_READY:${musicScore?.status ?? 'missing'}`)
    }
    if (musicScore.designSignature !== bgmDesignRow.designSignature) {
      throw new Error('FINAL_VIDEO_RENDER_BGM_DESIGN_STALE')
    }
    if (clips.length === 0) throw new Error('FINAL_VIDEO_RENDER_NO_VIDEO_CLIPS')
    assertFinalRenderClipsHaveSources({
      clips,
      locale: normalizeFinalRenderErrorLocale(job.data.locale),
    })

    const dimensions = resolveFinalRenderDimensions(project.videoRatio)
    const plannedDurationSeconds = clips.reduce((sum, clip) => sum + clip.durationSeconds, 0)
    const designDurationSeconds = bgmDesign.clock.totalFrames / bgmDesign.clock.fps
    if (Math.abs(plannedDurationSeconds - designDurationSeconds) > 1 / bgmDesign.clock.fps) {
      throw new Error(`FINAL_VIDEO_RENDER_BGM_DESIGN_DURATION_STALE:${designDurationSeconds.toFixed(6)}:${plannedDurationSeconds.toFixed(6)}`)
    }
    const currentTimelineSignature = buildBgmDesignTimelineSignature(clips)
    if (bgmDesignRow.timelineSignature !== currentTimelineSignature) {
      throw new Error(`FINAL_VIDEO_RENDER_BGM_DESIGN_TIMELINE_STALE:${bgmDesignRow.timelineSignature ?? 'missing'}:${currentTimelineSignature}`)
    }
    if (bgmMix) {
      if (musicScore?.timelineSignature !== currentTimelineSignature) throw new Error('FINAL_VIDEO_RENDER_BGM_TIMELINE_STALE')
      if (bgmMix.durationMs / 1000 + FINAL_RENDER_BGM_DURATION_TOLERANCE_SECONDS < plannedDurationSeconds) throw new Error('FINAL_VIDEO_RENDER_BGM_DURATION_SHORT')
    }
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
          stage: 'final_render_clip_audio',
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

    const stitchedPath = path.join(workspaceDir, 'stitched.mp4')
    await concatClips({
      clipPaths: normalizedPaths,
      listPath: path.join(workspaceDir, 'concat.txt'),
      outputPath: stitchedPath,
      durationSeconds: plannedDurationSeconds,
    })
    const stitchedDurationSeconds = await probeDurationSeconds(stitchedPath)
    const mainAudioPath = path.join(workspaceDir, 'main-audio.wav')
    await concatFinalRenderAudioClips({
      runCommand: createFfmpegCommandRunner({
        stage: 'final_render_concat_audio',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      clipAudioPaths,
      outputPath: mainAudioPath,
      durationSeconds: stitchedDurationSeconds,
    })

    await reportTaskProgress(job, 78, { stage: 'final_render_compose' })
    const finalPath = path.join(workspaceDir, 'final.mp4')
    await reportTaskProgress(job, 55, { stage: 'final_render_music' })
    const rawMusicPath = path.join(workspaceDir, `bgm-raw.${extensionFromMimeType(bgmMix.mimeType)}`)
    const musicPath = path.join(workspaceDir, 'bgm-automated.wav')
    await writeFile(rawMusicPath, await getObjectBuffer(bgmMix.storageKey))
    await renderFinalRenderAutomatedAudio({
      runCommand: createFfmpegCommandRunner({ stage: 'final_render_score_automation', expectedDurationSeconds: stitchedDurationSeconds }),
      inputPath: rawMusicPath,
      outputPath: musicPath,
      durationSeconds: stitchedDurationSeconds,
      volumeFilter: buildGainAutomationVolumeFilter({
        baseVolume: 1,
        lanes: bgmDesign.automationLanes.filter((lane) => lane.targetBus === 'score'),
        clock: bgmDesign.clock,
      }),
    })
    await muxFinalRenderAudio({
      runCommand: createFfmpegCommandRunner({
        stage: 'final_render_mux_audio',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      stitchedPath,
      mainAudioPath,
      hasSourceAudio,
      musicPath,
      outputPath: finalPath,
      durationSeconds: stitchedDurationSeconds,
      volume: readBgmVolume(payload.bgmVolume),
    })
    const masterLanes = bgmDesign.automationLanes.filter((lane) => lane.targetBus === 'master')
    const outputPath = masterLanes.length > 0 ? path.join(workspaceDir, 'final-mastered.mp4') : finalPath
    if (masterLanes.length > 0) {
      await applyFinalRenderMasterAutomation({
        runCommand: createFfmpegCommandRunner({ stage: 'final_render_master_automation', expectedDurationSeconds: stitchedDurationSeconds }),
        inputPath: finalPath,
        outputPath,
        durationSeconds: stitchedDurationSeconds,
        volumeFilter: buildGainAutomationVolumeFilter({ baseVolume: 1, lanes: masterLanes, clock: bgmDesign.clock }),
      })
    }
    const outputBuffer = await readFile(outputPath)

    await reportTaskProgress(job, 92, { stage: 'final_render_persist' })
    const storageKey = await uploadObject(
      outputBuffer,
      buildTaskArtifactStorageKey({
        taskId: job.data.taskId,
        artifact: `final-video:${episodeId}`,
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
      durationMs: Math.round(stitchedDurationSeconds * 1000),
    })

    await assertTaskActive(job, 'persist_final_video_render')
    await persistEpisodeFinalOutputSuccess({
      episodeId,
      taskId: job.data.taskId,
      outputUrl: media.url,
      outputMediaId: media.id,
    })

    return {
      videoMediaId: media.id,
      outputUrl: media.url,
      storageKey,
      episodeId,
      clipCount: clips.length,
      durationSeconds: stitchedDurationSeconds,
      width: dimensions.width,
      height: dimensions.height,
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
