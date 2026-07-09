import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  readCompletedMusicScoreMix,
  readMusicScoreTimelineSignature,
} from '@/lib/music-score/project-data'
import { parseNullableEditScriptStyleBible } from '@/lib/edit-script/style-bible-prompt'
import { ensureMediaObjectFromStorageKey, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { generateUniqueKey, getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from './shared'
import {
  parseFinalRenderEditScriptCore,
  resolveFinalRenderDimensions,
  type FinalRenderClipPlan,
  type FinalRenderEditScriptInput,
} from '@/lib/video-compose/final-render-plan'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import {
  assertFinalRenderClipsHaveSources,
  normalizeFinalRenderErrorLocale,
} from '@/lib/video-compose/final-render-errors'
import {
  concatFinalRenderAudioClips,
  muxFinalRenderAudio,
  muxFinalRenderSourceAudio,
  renderFinalRenderClipAudio,
} from '@/lib/video-compose/final-render-audio'
import { buildBgmTimelineSignature } from '@/lib/bgm-score/timeline'
import {
  buildFfmpegExecFileOptions,
  resolveFfmpegBinary,
} from '@/lib/video-compose/ffmpeg-binaries'

type FinalVideoRenderPayload = {
  readonly episodeId?: unknown
  readonly bgmVolume?: unknown
}

type CommandResult = {
  readonly stdout: string
  readonly stderr: string
}

const execFileAsync = promisify(execFile)
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

function assertBgmMixMatchesTimeline(input: {
  readonly musicScore: {
    readonly status: string | null
    readonly timelineSignature?: string | null
  } | null
  readonly currentTimelineSignature: string
  readonly bgmDurationMs: number
  readonly renderDurationSeconds: number
}): void {
  const scoreSignature = readMusicScoreTimelineSignature(input.musicScore)
  if (!scoreSignature) {
    throw new Error('FINAL_VIDEO_RENDER_BGM_TIMELINE_SIGNATURE_MISSING')
  }
  if (scoreSignature !== input.currentTimelineSignature) {
    throw new Error(`FINAL_VIDEO_RENDER_BGM_TIMELINE_STALE:${scoreSignature}:${input.currentTimelineSignature}`)
  }
  const bgmDurationSeconds = input.bgmDurationMs / 1000
  if (bgmDurationSeconds + FINAL_RENDER_BGM_DURATION_TOLERANCE_SECONDS < input.renderDurationSeconds) {
    throw new Error(`FINAL_VIDEO_RENDER_BGM_DURATION_SHORT:${bgmDurationSeconds.toFixed(3)}:${input.renderDurationSeconds.toFixed(3)}`)
  }
}

function assertMusicScoreReadyForFinalRender(input: {
  readonly musicScore: {
    readonly status: string | null
  } | null
  readonly hasMix: boolean
}): void {
  if (!input.musicScore) {
    throw new Error('FINAL_VIDEO_RENDER_BGM_REQUIRED')
  }
  if (input.musicScore.status !== 'completed') {
    throw new Error(`FINAL_VIDEO_RENDER_BGM_NOT_READY:${input.musicScore.status ?? 'unknown'}`)
  }
  if (!input.hasMix) {
    throw new Error('FINAL_VIDEO_RENDER_BGM_MIX_INVALID')
  }
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}

export async function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  if (command !== 'ffmpeg' && command !== 'ffprobe') {
    const result = await execFileAsync(command, [...args], {
      maxBuffer: 32 * 1024 * 1024,
    })
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  }

  const execution = resolveFfmpegBinary(command)
  const result = await execFileAsync(execution.command, [...args], buildFfmpegExecFileOptions(execution, {
    maxBuffer: 32 * 1024 * 1024,
  }))
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

export async function probeDurationSeconds(filePath: string): Promise<number> {
  const result = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ])
  const duration = Number.parseFloat(result.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('FINAL_VIDEO_RENDER_PROBE_DURATION_FAILED')
  }
  return duration
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
  const core = parseFinalRenderEditScriptCore(script.corePlanJson)
  if (!core || core.shots.length === 0) return null
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
  await runCommand('ffmpeg', [
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
  ])
}

export async function concatClips(input: {
  readonly clipPaths: readonly string[]
  readonly listPath: string
  readonly outputPath: string
}): Promise<void> {
  const lines = input.clipPaths.map((clipPath) => `file '${escapeConcatPath(clipPath)}'`).join('\n')
  await writeFile(input.listPath, `${lines}\n`, 'utf8')
  await runCommand('ffmpeg', [
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
  ])
}

async function upsertEpisodeFinalOutput(input: {
  readonly episodeId: string
  readonly renderStatus: string
  readonly taskId: string
  readonly outputUrl?: string | null
  readonly outputMediaId?: string | null
}): Promise<void> {
  const updateData: Prisma.ProjectEpisodeFinalOutputUncheckedUpdateInput = {
    renderStatus: input.renderStatus,
    renderTaskId: input.taskId,
    ...(input.outputUrl !== undefined ? { outputUrl: input.outputUrl } : {}),
    ...(input.outputMediaId !== undefined ? { outputMediaId: input.outputMediaId } : {}),
  }
  await prisma.projectEpisodeFinalOutput.upsert({
    where: { episodeId: input.episodeId },
    update: updateData,
    create: {
      episodeId: input.episodeId,
      renderStatus: input.renderStatus,
      renderTaskId: input.taskId,
      outputUrl: input.outputUrl ?? null,
      outputMediaId: input.outputMediaId ?? null,
    },
  })
}

export async function handleFinalVideoRenderTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as FinalVideoRenderPayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  if (!episodeId) throw new Error('FINAL_VIDEO_RENDER_EPISODE_REQUIRED')

  await upsertEpisodeFinalOutput({
    episodeId,
    renderStatus: 'processing',
    taskId: job.data.taskId,
  })

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
    const [clips, musicScore] = await Promise.all([
      loadEpisodeChapterOutputClips({
        episodeId,
        projectId: job.data.projectId,
      }),
      prisma.projectEditMusicScore.findUnique({
        where: { episodeId },
        select: { status: true, mixJson: true, timelineSignature: true },
      }),
    ])
    const bgmMix = readCompletedMusicScoreMix(musicScore)
    assertMusicScoreReadyForFinalRender({
      musicScore,
      hasMix: Boolean(bgmMix),
    })
    if (clips.length === 0) throw new Error('FINAL_VIDEO_RENDER_NO_VIDEO_CLIPS')
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

    const stitchedPath = path.join(workspaceDir, 'stitched.mp4')
    await concatClips({
      clipPaths: normalizedPaths,
      listPath: path.join(workspaceDir, 'concat.txt'),
      outputPath: stitchedPath,
    })
    const stitchedDurationSeconds = await probeDurationSeconds(stitchedPath)
    const mainAudioPath = path.join(workspaceDir, 'main-audio.m4a')
    await concatFinalRenderAudioClips({
      runCommand,
      clipAudioPaths,
      outputPath: mainAudioPath,
    })

    await reportTaskProgress(job, 78, { stage: 'final_render_compose' })
    const finalPath = path.join(workspaceDir, 'final.mp4')
    if (bgmMix) {
      await reportTaskProgress(job, 55, { stage: 'final_render_music' })
      assertBgmMixMatchesTimeline({
        musicScore,
        currentTimelineSignature: buildBgmTimelineSignature(clips),
        bgmDurationMs: bgmMix.durationMs,
        renderDurationSeconds: stitchedDurationSeconds,
      })
      const musicPath = path.join(workspaceDir, `bgm.${extensionFromMimeType(bgmMix.mimeType)}`)
      await writeFile(musicPath, await getObjectBuffer(bgmMix.storageKey))
      await muxFinalRenderAudio({
        runCommand,
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        musicPath,
        outputPath: finalPath,
        durationSeconds: stitchedDurationSeconds,
        volume: readBgmVolume(payload.bgmVolume),
      })
    } else {
      await muxFinalRenderSourceAudio({
        runCommand,
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        outputPath: finalPath,
      })
    }
    const outputBuffer = await readFile(finalPath)

    await reportTaskProgress(job, 92, { stage: 'final_render_persist' })
    const storageKey = await uploadObject(
      outputBuffer,
      generateUniqueKey('final-video', 'mp4'),
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

    await upsertEpisodeFinalOutput({
      episodeId,
      renderStatus: 'completed',
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
  } catch (error) {
    await upsertEpisodeFinalOutput({
      episodeId,
      renderStatus: 'failed',
      taskId: job.data.taskId,
    })
    throw error
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
