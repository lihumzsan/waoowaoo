import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { parseEditorProjectData, readCompletedBgmScoreMix } from '@/lib/bgm-score/project-data'
import { parseNullableEditScriptStyleBible } from '@/lib/edit-script/style-bible-prompt'
import { ensureMediaObjectFromStorageKey, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { generateUniqueKey, getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from './shared'
import {
  buildFinalRenderClips,
  parseFinalRenderEditScriptShots,
  parseFinalRenderEditScriptVideoBlocks,
  resolveFinalRenderDimensions,
  type FinalRenderClipPlan,
  type FinalRenderEditScriptInput,
} from '@/lib/video-compose/final-render-plan'
import {
  assertFinalRenderClipsHaveSources,
  normalizeFinalRenderErrorLocale,
} from '@/lib/video-compose/final-render-errors'
import {
  BGM_AUDIO_TARGET,
  MAIN_AUDIO_TARGET,
  concatFinalRenderAudioClips,
  muxFinalRenderAudio,
  renderFinalRenderClipAudio,
} from '@/lib/video-compose/final-render-audio'

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

async function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  const result = await execFileAsync(command, [...args], {
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

async function probeDurationSeconds(filePath: string): Promise<number> {
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

async function writeVideoSourceToFile(source: FinalRenderClipPlan['source'], outputPath: string): Promise<void> {
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

async function buildEditScript(episodeId: string): Promise<FinalRenderEditScriptInput | null> {
  const script = await prisma.projectEditScript.findUnique({
    where: { episodeId },
    select: {
      id: true,
      userPrompt: true,
      title: true,
      logline: true,
      durationSec: true,
      styleBibleJson: true,
      shotsJson: true,
      videoBlocksJson: true,
    },
  })
  if (!script) return null
  const shots = parseFinalRenderEditScriptShots(script.shotsJson)
  if (shots.length === 0) return null
  const videoBlocks = parseFinalRenderEditScriptVideoBlocks({
    value: script.videoBlocksJson,
    shots,
  })
  return {
    id: script.id,
    userPrompt: script.userPrompt,
    title: script.title,
    logline: script.logline,
    durationSec: script.durationSec,
    styleBible: parseNullableEditScriptStyleBible(script.styleBibleJson),
    shots,
    videoBlocks,
  }
}

async function normalizeClip(input: {
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

async function concatClips(input: {
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

async function upsertEditorProject(input: {
  readonly episodeId: string
  readonly renderStatus: string
  readonly taskId: string
  readonly outputUrl?: string | null
  readonly projectData?: Record<string, unknown>
}): Promise<void> {
  const projectData = JSON.stringify(input.projectData ?? {
    schemaVersion: 1,
    updatedBy: 'final_video_render',
  })
  await prisma.videoEditorProject.upsert({
    where: { episodeId: input.episodeId },
    update: {
      renderStatus: input.renderStatus,
      renderTaskId: input.taskId,
      ...(input.outputUrl !== undefined ? { outputUrl: input.outputUrl } : {}),
      ...(input.projectData ? { projectData } : {}),
    },
    create: {
      episodeId: input.episodeId,
      projectData,
      renderStatus: input.renderStatus,
      renderTaskId: input.taskId,
      outputUrl: input.outputUrl ?? null,
    },
  })
}

export async function handleFinalVideoRenderTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as FinalVideoRenderPayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  if (!episodeId) throw new Error('FINAL_VIDEO_RENDER_EPISODE_REQUIRED')

  await upsertEditorProject({
    episodeId,
    renderStatus: 'rendering',
    taskId: job.data.taskId,
  })

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-final-render-${randomUUID()}-`))
  try {
    await reportTaskProgress(job, 10, { stage: 'final_render_prepare' })
    const [project, episode, editScript, panels, videoGroups, editorProject] = await Promise.all([
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
      buildEditScript(episodeId),
      prisma.projectPanel.findMany({
        where: { storyboard: { episodeId } },
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
        where: { episodeId, projectId: job.data.projectId },
        include: { videoMedia: true },
      }),
      prisma.videoEditorProject.findUnique({
        where: { episodeId },
        select: { projectData: true },
      }),
    ])
    if (!project) throw new Error('FINAL_VIDEO_RENDER_PROJECT_NOT_FOUND')
    if (!episode) throw new Error('FINAL_VIDEO_RENDER_EPISODE_NOT_FOUND')
    const bgmMix = readCompletedBgmScoreMix(editorProject?.projectData ?? null)
    if (!bgmMix) throw new Error('FINAL_VIDEO_RENDER_BGM_REQUIRED')
    const existingProjectData = parseEditorProjectData(editorProject?.projectData ?? null)

    const clips = buildFinalRenderClips({ panels, videoGroups, editScript })
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

    await reportTaskProgress(job, 55, { stage: 'final_render_music' })
    const musicPath = path.join(workspaceDir, `bgm.${extensionFromMimeType(bgmMix.mimeType)}`)
    await writeFile(musicPath, await getObjectBuffer(bgmMix.storageKey))

    await reportTaskProgress(job, 78, { stage: 'final_render_compose' })
    const finalPath = path.join(workspaceDir, 'final.mp4')
    const audioMix = await muxFinalRenderAudio({
      runCommand,
      stitchedPath,
      mainAudioPath,
      hasSourceAudio,
      musicPath,
      outputPath: finalPath,
      durationSeconds: stitchedDurationSeconds,
      volume: readBgmVolume(payload.bgmVolume),
    })
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

    const projectData = {
      schemaVersion: 1,
      type: 'linear_final_render',
      taskId: job.data.taskId,
      dimensions,
      durationSeconds: stitchedDurationSeconds,
      bgmScore: existingProjectData.bgmScore ?? null,
      audioMix: {
        hasSourceAudio: audioMix.hasSourceAudio,
        targets: {
          mainIntegratedLufs: MAIN_AUDIO_TARGET.integratedLufs,
          bgmIntegratedLufs: BGM_AUDIO_TARGET.integratedLufs,
          truePeakDb: MAIN_AUDIO_TARGET.truePeakDb,
        },
        measured: {
          main: audioMix.mainAudio ?? null,
          bgm: audioMix.bgm,
        },
      },
      timeline: clips.map((clip) => ({
        order: clip.order,
        sourceKind: clip.sourceKind,
        panelId: clip.panelId,
        groupId: clip.groupId ?? null,
        shotNumber: clip.shotNumber,
        durationSeconds: clip.durationSeconds,
      })),
    }
    await upsertEditorProject({
      episodeId,
      renderStatus: 'completed',
      taskId: job.data.taskId,
      outputUrl: media.url,
      projectData,
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
    await upsertEditorProject({
      episodeId,
      renderStatus: 'failed',
      taskId: job.data.taskId,
    })
    throw error
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
