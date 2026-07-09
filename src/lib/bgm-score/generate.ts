import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { generateMusic } from '@/lib/ai-exec/engine'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { getProjectModelConfig } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import {
  MUSIC_SCORE_MAX_CUE_DURATION_SECONDS,
  resolveMusicScoreMaxCueDurationSeconds,
  resolveMusicScoreRequestDurationSeconds,
} from '@/lib/music-score/constraints'
import { generateUniqueKey, toFetchableUrl, uploadObject } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'
import {
  type FinalRenderClipPlan,
} from '@/lib/video-compose/final-render-plan'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import {
  buildFfmpegExecFileOptions,
  resolveFfmpegBinary,
  type FfmpegBinaryName,
} from '@/lib/video-compose/ffmpeg-binaries'
import { reportTaskProgress } from '@/lib/workers/shared'
import { buildBgmScorePlanPrompt, buildFinalBgmMusicPrompt } from './prompt'
import { buildBgmTimelineSignature } from './timeline'
import {
  BGM_SCORE_STATUS,
  bgmScorePlanSchema,
  type BgmScoreCue,
  type BgmScoreMix,
  type BgmScorePlan,
  type BgmScoreProjectData,
} from './types'

const execFileAsync = promisify(execFile)
const BGM_SCORE_DURATION_TOLERANCE_SECONDS = 0.25

type BgmScoreGeneratePayload = {
  readonly episodeId?: unknown
  readonly musicModel?: unknown
  readonly outputFormat?: unknown
}

type GeneratedAudioBuffer = {
  readonly buffer: Buffer
  readonly mimeType: string
}

type CommandResult = {
  readonly stdout: string | Buffer
  readonly stderr: string | Buffer
}

async function runFfmpegCommand(
  binaryName: FfmpegBinaryName,
  args: readonly string[],
): Promise<CommandResult> {
  const execution = resolveFfmpegBinary(binaryName)
  return await execFileAsync(
    execution.command,
    [...args],
    buildFfmpegExecFileOptions(execution),
  ) as CommandResult
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOutputFormat(value: unknown): 'mp3' | 'wav' {
  if (value === undefined || value === null || value === '') return 'mp3'
  if (value === 'mp3' || value === 'wav') return value
  throw new Error('BGM_SCORE_OUTPUT_FORMAT_INVALID')
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}

async function probeAudioDurationSeconds(input: GeneratedAudioBuffer): Promise<number> {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-bgm-score-'))
  const audioPath = path.join(workspaceDir, `generated.${extensionFromMimeType(input.mimeType)}`)
  try {
    await writeFile(audioPath, input.buffer)
    const result = await runFfmpegCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ])
    const duration = Number.parseFloat(String(result.stdout).trim())
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('BGM_SCORE_AUDIO_DURATION_PROBE_FAILED')
    }
    return duration
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

function decodeAudioDataUrl(dataUrl: string): GeneratedAudioBuffer | null {
  const match = /^data:(audio\/[^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

async function loadAudioBuffer(input: {
  readonly audioBase64?: string
  readonly audioUrl?: string
  readonly mimeType?: string
}): Promise<GeneratedAudioBuffer> {
  const explicitMimeType = readString(input.mimeType) || 'audio/mpeg'
  if (input.audioBase64) {
    return {
      buffer: Buffer.from(input.audioBase64, 'base64'),
      mimeType: explicitMimeType,
    }
  }

  const audioUrl = readString(input.audioUrl)
  if (!audioUrl) throw new Error('BGM_SCORE_EMPTY_AUDIO_RESULT')
  const decoded = decodeAudioDataUrl(audioUrl)
  if (decoded) return decoded

  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) {
    throw new Error(`BGM_SCORE_AUDIO_DOWNLOAD_FAILED:${response.status}`)
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') || explicitMimeType,
  }
}

function ensureSchedulableTimeline(clips: readonly FinalRenderClipPlan[]): void {
  if (clips.length === 0) throw new Error('BGM_SCORE_VIDEO_TIMELINE_INCOMPLETE')
  const invalidClip = clips.find((clip) => !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0)
  if (invalidClip) {
    throw new Error(`BGM_SCORE_VIDEO_TIMELINE_INCOMPLETE:${invalidClip.groupId ?? invalidClip.panelId}`)
  }
}

export type BgmScoreCueWindow = {
  readonly cueId: string
  readonly index: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly durationSeconds: number
  readonly clips: readonly FinalRenderClipPlan[]
  readonly sourceClipOrders: readonly number[]
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
}

function cloneClipForCue(input: {
  readonly clip: FinalRenderClipPlan
  readonly durationSeconds: number
}): FinalRenderClipPlan {
  return {
    ...input.clip,
    durationSeconds: input.durationSeconds,
  }
}

function pushCueWindow(
  output: BgmScoreCueWindow[],
  input: {
    readonly startSeconds: number
    readonly durationSeconds: number
    readonly clips: readonly FinalRenderClipPlan[]
  },
): void {
  if (input.durationSeconds <= 0) return
  const cueIndex = output.length + 1
  const sourceClipOrders = Array.from(new Set(input.clips.map((clip) => clip.order)))
  const shotIds = Array.from(new Set(input.clips.flatMap((clip) => clip.shotIds)))
  const shotNumbers = Array.from(new Set(input.clips.flatMap((clip) => clip.shotNumbers)))
  output.push({
    cueId: `cue-${String(cueIndex).padStart(3, '0')}`,
    index: cueIndex,
    startSeconds: input.startSeconds,
    endSeconds: input.startSeconds + input.durationSeconds,
    durationSeconds: input.durationSeconds,
    clips: input.clips,
    sourceClipOrders,
    shotIds,
    shotNumbers,
  })
}

export function buildBgmScoreCueWindows(
  clips: readonly FinalRenderClipPlan[],
  maxCueDurationSeconds = MUSIC_SCORE_MAX_CUE_DURATION_SECONDS,
): BgmScoreCueWindow[] {
  if (!Number.isFinite(maxCueDurationSeconds) || maxCueDurationSeconds <= 0) {
    throw new Error('BGM_SCORE_MAX_CUE_DURATION_INVALID')
  }
  const cues: BgmScoreCueWindow[] = []
  let cueStartSeconds = 0
  let cueDurationSeconds = 0
  let timelineCursorSeconds = 0
  let cueClips: FinalRenderClipPlan[] = []

  for (const clip of clips) {
    let remainingClipSeconds = clip.durationSeconds
    while (remainingClipSeconds > 0) {
      const capacitySeconds = maxCueDurationSeconds - cueDurationSeconds
      const pieceSeconds = Math.min(remainingClipSeconds, capacitySeconds)
      cueClips.push(cloneClipForCue({ clip, durationSeconds: pieceSeconds }))
      cueDurationSeconds += pieceSeconds
      timelineCursorSeconds += pieceSeconds
      remainingClipSeconds -= pieceSeconds

      if (cueDurationSeconds >= maxCueDurationSeconds - 0.001) {
        pushCueWindow(cues, {
          startSeconds: cueStartSeconds,
          durationSeconds: cueDurationSeconds,
          clips: cueClips,
        })
        cueStartSeconds = timelineCursorSeconds
        cueDurationSeconds = 0
        cueClips = []
      }
    }
  }

  pushCueWindow(cues, {
    startSeconds: cueStartSeconds,
    durationSeconds: cueDurationSeconds,
    clips: cueClips,
  })
  return cues
}

function normalizePlanDuration(plan: BgmScorePlan, durationSeconds: number): BgmScorePlan {
  return {
    ...plan,
    durationSeconds,
  }
}

function parseBgmScorePlanValue(parsed: unknown, durationSeconds: number): BgmScorePlan {
  const result = bgmScorePlanSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`BGM_SCORE_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  const normalized = normalizePlanDuration(result.data, durationSeconds)
  const normalizedResult = bgmScorePlanSchema.safeParse(normalized)
  if (!normalizedResult.success) {
    throw new Error(`BGM_SCORE_PLAN_INVALID:${normalizedResult.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return normalizedResult.data
}

async function writeBgmScoreProjectData(input: {
  readonly episodeId: string
  readonly bgmScore: BgmScoreProjectData
}): Promise<void> {
  const cuesJson = input.bgmScore as unknown as Prisma.InputJsonValue
  const mixJson = input.bgmScore.mix
    ? input.bgmScore.mix as unknown as Prisma.InputJsonValue
    : Prisma.JsonNull
  const diagnosticsJson = input.bgmScore.errorMessage
    ? { errorMessage: input.bgmScore.errorMessage } as Prisma.InputJsonValue
    : Prisma.JsonNull
  await prisma.projectEditMusicScore.upsert({
    where: { episodeId: input.episodeId },
    create: {
      episodeId: input.episodeId,
      cuesJson,
      mixJson,
      diagnosticsJson,
      version: 1,
      status: input.bgmScore.status,
      taskId: input.bgmScore.taskId,
      timelineSignature: input.bgmScore.timelineSignature,
      musicModel: input.bgmScore.musicModel,
    },
    update: {
      cuesJson,
      mixJson,
      diagnosticsJson,
      status: input.bgmScore.status,
      taskId: input.bgmScore.taskId,
      timelineSignature: input.bgmScore.timelineSignature,
      musicModel: input.bgmScore.musicModel,
    },
  })
}

async function uploadGeneratedBgmMix(input: {
  readonly audio: GeneratedAudioBuffer
  readonly durationSeconds: number
}): Promise<BgmScoreMix> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds + BGM_SCORE_DURATION_TOLERANCE_SECONDS < input.durationSeconds) {
    throw new Error(`BGM_SCORE_AUDIO_DURATION_SHORT:${measuredDurationSeconds.toFixed(3)}:${input.durationSeconds.toFixed(3)}`)
  }
  const measuredDurationMs = Math.round(measuredDurationSeconds * 1000)
  const storageKey = await uploadObject(
    input.audio.buffer,
    generateUniqueKey('music/bgm-score', extensionFromMimeType(input.audio.mimeType)),
    1,
    input.audio.mimeType,
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: input.audio.mimeType,
    sizeBytes: input.audio.buffer.byteLength,
    durationMs: measuredDurationMs,
  })
  return {
    mediaId: media.id,
    url: media.url,
    storageKey,
    mimeType: input.audio.mimeType,
    durationMs: measuredDurationMs,
  }
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
}

async function assertGeneratedCueDuration(input: {
  readonly audio: GeneratedAudioBuffer
  readonly durationSeconds: number
  readonly cueId: string
}): Promise<void> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds + BGM_SCORE_DURATION_TOLERANCE_SECONDS < input.durationSeconds) {
    throw new Error(`BGM_SCORE_CUE_AUDIO_DURATION_SHORT:${input.cueId}:${measuredDurationSeconds.toFixed(3)}:${input.durationSeconds.toFixed(3)}`)
  }
}

async function concatCueAudioBuffers(input: {
  readonly cues: readonly {
    readonly cueId: string
    readonly audio: GeneratedAudioBuffer
    readonly durationSeconds: number
  }[]
}): Promise<GeneratedAudioBuffer> {
  if (input.cues.length === 0) throw new Error('BGM_SCORE_CUE_AUDIO_EMPTY')
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-bgm-score-cues-'))
  try {
    const trimmedPaths: string[] = []
    for (const [index, cue] of input.cues.entries()) {
      const sourcePath = path.join(workspaceDir, `cue-source-${String(index + 1)}.${extensionFromMimeType(cue.audio.mimeType)}`)
      const trimmedPath = path.join(workspaceDir, `cue-trimmed-${String(index + 1)}.m4a`)
      await writeFile(sourcePath, cue.audio.buffer)
      await runFfmpegCommand('ffmpeg', [
        '-y',
        '-i',
        sourcePath,
        '-t',
        cue.durationSeconds.toFixed(3),
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        trimmedPath,
      ])
      trimmedPaths.push(trimmedPath)
    }

    const listPath = path.join(workspaceDir, 'cue-concat.txt')
    const outputPath = path.join(workspaceDir, 'bgm-mix.m4a')
    const concatLines = trimmedPaths.map((clipPath) => `file '${escapeConcatPath(clipPath)}'`).join('\n')
    await writeFile(listPath, `${concatLines}\n`, 'utf8')
    await runFfmpegCommand('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outputPath,
    ])
    return {
      buffer: await readFile(outputPath),
      mimeType: 'audio/mp4',
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

function buildCueMusicPrompt(input: {
  readonly plan: BgmScorePlan
  readonly cue: BgmScoreCueWindow
  readonly cueCount: number
  readonly locale: TaskJobData['locale']
}): string {
  const cueInstruction = input.locale === 'zh'
    ? [
        `只渲染第 ${String(input.cue.index)} / ${String(input.cueCount)} 个 BGM cue。`,
        `本 cue 时长 ${input.cue.durationSeconds.toFixed(3)} 秒，对应整集时间线 ${input.cue.startSeconds.toFixed(3)}-${input.cue.endSeconds.toFixed(3)} 秒。`,
        `锚定镜头 ID: ${input.cue.shotIds.length > 0 ? input.cue.shotIds.join(', ') : '无'}`,
        `锚定镜头号: ${input.cue.shotNumbers.length > 0 ? input.cue.shotNumbers.join(', ') : '无'}`,
        '必须保持和相邻 cue 可无缝衔接的速度、调性、音色与情绪连续性。',
      ].join('\n')
    : [
        `Render only BGM cue ${String(input.cue.index)} of ${String(input.cueCount)}.`,
        `This cue is ${input.cue.durationSeconds.toFixed(3)} seconds and covers episode timeline ${input.cue.startSeconds.toFixed(3)}-${input.cue.endSeconds.toFixed(3)} seconds.`,
        `Anchored shot IDs: ${input.cue.shotIds.length > 0 ? input.cue.shotIds.join(', ') : 'none'}`,
        `Anchored shot numbers: ${input.cue.shotNumbers.length > 0 ? input.cue.shotNumbers.join(', ') : 'none'}`,
        'Keep tempo, tonality, instrumentation, and emotional continuity seamless with adjacent cues.',
      ].join('\n')
  return buildFinalBgmMusicPrompt({
    ...input.plan,
    durationSeconds: input.cue.durationSeconds,
    finalPrompt: [
      input.plan.finalPrompt,
      '',
      cueInstruction,
    ].join('\n'),
  }, { locale: input.locale })
}

export async function handleBgmScoreGenerateTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as BgmScoreGeneratePayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const musicModel = readString(payload.musicModel)
  if (!episodeId) throw new Error('BGM_SCORE_EPISODE_REQUIRED')
  if (!musicModel) throw new Error('BGM_SCORE_MUSIC_MODEL_REQUIRED')

  let editScriptId = ''
  let signature = ''
  let durationSeconds = 0

  try {
    await reportTaskProgress(job, 8, { stage: 'bgm_score_prepare' })
    const [project, episode, projectModelConfig] = await Promise.all([
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
      getProjectModelConfig(job.data.projectId, job.data.userId),
    ])
    if (!project) throw new Error('BGM_SCORE_PROJECT_NOT_FOUND')
    if (!episode) throw new Error('BGM_SCORE_EPISODE_NOT_FOUND')
    const analysisModel = readString(projectModelConfig.analysisModel)
    if (!analysisModel) throw new Error('BGM_SCORE_ANALYSIS_MODEL_REQUIRED')

    const clips = await loadEpisodeChapterOutputClips({
      episodeId,
      projectId: job.data.projectId,
    })
    ensureSchedulableTimeline(clips)
    editScriptId = `episode:${episodeId}`
    durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
    signature = buildBgmTimelineSignature(clips)
    const cueWindows = buildBgmScoreCueWindows(
      clips,
      resolveMusicScoreMaxCueDurationSeconds(),
    )
    if (cueWindows.length === 0) throw new Error('BGM_SCORE_CUE_WINDOWS_EMPTY')

    await writeBgmScoreProjectData({
      episodeId,
      bgmScore: {
        schemaVersion: 2,
        status: BGM_SCORE_STATUS.GENERATING,
        taskId: job.data.taskId,
        editScriptId,
        timelineSignature: signature,
        durationSeconds,
        musicModel,
      },
    })

    await reportTaskProgress(job, 18, { stage: 'bgm_score_plan' })
    const streamContext = createWorkerLLMStreamContext(job, 'music_score_plan')
    const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
    const completion = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => {
        try {
          return await executeAiStructuredTextStep({
            userId: job.data.userId,
            model: analysisModel,
            messages: [{
              role: 'user',
              content: buildBgmScorePlanPrompt({
                editScript: null,
                projectContext: {
                  videoRatio: project.videoRatio,
                },
                clips,
                totalDurationSeconds: durationSeconds,
                locale: job.data.locale,
              }),
            }],
            temperature: 0.35,
            projectId: job.data.projectId,
            action: 'bgm_score_plan',
            locale: job.data.locale,
            meta: {
              stepId: 'bgm_score_plan',
              stepTitle: 'bgm_score_plan',
              stepIndex: 1,
              stepTotal: 1,
            },
            schema: z.unknown(),
            parse: { kind: 'object' },
            validate: (raw) => parseBgmScorePlanValue(raw, durationSeconds),
          })
        } finally {
          await streamCallbacks.flush()
        }
      },
    )
    const plan = completion.data

    const outputFormat = readOutputFormat(payload.outputFormat)
    const renderedCues: BgmScoreCue[] = []
    const cueAudios: Array<{
      readonly cueId: string
      readonly audio: GeneratedAudioBuffer
      readonly durationSeconds: number
    }> = []
    for (const cue of cueWindows) {
      const progress = 45 + Math.round((cue.index - 1) / cueWindows.length * 38)
      await reportTaskProgress(job, progress, {
        stage: 'music_score_plan_generate_music',
        cueId: cue.cueId,
        cueIndex: cue.index,
        cueCount: cueWindows.length,
        designSectionCount: plan.scoreDesign.sections.length,
        promptSectionCount: plan.promptSections.length,
        virtualLayerCount: plan.virtualLayers.length,
      })
      const cuePrompt = buildCueMusicPrompt({
        plan,
        cue,
        cueCount: cueWindows.length,
        locale: job.data.locale,
      })
      const generated = await generateMusic(job.data.userId, musicModel, cuePrompt, {
        durationSeconds: resolveMusicScoreRequestDurationSeconds({
          targetDurationSeconds: cue.durationSeconds,
        }),
        vocalMode: 'instrumental',
        outputFormat,
      })
      if (!generated.success) {
        throw new Error(generated.error || `BGM_SCORE_PROVIDER_FAILED:${cue.cueId}`)
      }
      const audio = await loadAudioBuffer({
        audioBase64: generated.audioBase64,
        audioUrl: generated.audioUrl,
        mimeType: generated.audioMimeType,
      })
      await assertGeneratedCueDuration({
        audio,
        durationSeconds: cue.durationSeconds,
        cueId: cue.cueId,
      })
      cueAudios.push({
        cueId: cue.cueId,
        audio,
        durationSeconds: cue.durationSeconds,
      })
      renderedCues.push({
        cueId: cue.cueId,
        index: cue.index,
        startSeconds: cue.startSeconds,
        endSeconds: cue.endSeconds,
        durationSeconds: cue.durationSeconds,
        sourceClipOrders: cue.sourceClipOrders,
        shotIds: cue.shotIds,
        shotNumbers: cue.shotNumbers,
        prompt: cuePrompt,
      })
    }

    await reportTaskProgress(job, 88, { stage: 'bgm_score_persist' })
    const audio = await concatCueAudioBuffers({ cues: cueAudios })
    const mix = await uploadGeneratedBgmMix({ audio, durationSeconds })
    const bgmScore: BgmScoreProjectData = {
      schemaVersion: 2,
      status: BGM_SCORE_STATUS.COMPLETED,
      taskId: job.data.taskId,
      editScriptId,
      timelineSignature: signature,
      durationSeconds,
      musicModel,
      plan,
      cues: renderedCues,
      mix,
    }
    await writeBgmScoreProjectData({ episodeId, bgmScore })

    return {
      episodeId,
      mediaId: mix.mediaId,
      audioUrl: mix.url,
      storageKey: mix.storageKey,
      musicModel,
      designSectionCount: plan.scoreDesign.sections.length,
      promptSectionCount: plan.promptSections.length,
      virtualLayerCount: plan.virtualLayers.length,
      durationMs: mix.durationMs,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (editScriptId && signature && durationSeconds > 0) {
      await writeBgmScoreProjectData({
        episodeId,
        bgmScore: {
          schemaVersion: 2,
          status: BGM_SCORE_STATUS.FAILED,
          taskId: job.data.taskId,
          editScriptId,
          timelineSignature: signature,
          durationSeconds,
          musicModel,
          errorMessage: message,
        },
      })
    }
    throw error
  }
}
