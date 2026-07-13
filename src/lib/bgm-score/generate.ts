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
import { prisma } from '@/lib/prisma'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import {
  resolveMusicScoreMaxCueDurationSeconds,
  resolveMusicScoreRequestDurationSeconds,
} from '@/lib/music-score/constraints'
import { readCompletedMusicScoreMix, readPersistedMusicScorePlan } from '@/lib/music-score/project-data'
import { toFetchableUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
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
import { buildBgmScorePlanFingerprint, parseBgmScorePlanStrict } from './plan-contract'
import {
  buildBgmScoreCueWindows,
  buildBgmTimelineSignature,
  type BgmScoreCueWindow,
} from './timeline'
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
  readonly bgmScorePlan?: unknown
  readonly bgmScorePlanHash?: unknown
  readonly timelineSignature?: unknown
  readonly analysisModel?: unknown
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
  readonly taskId: string
}): Promise<BgmScoreMix> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds + BGM_SCORE_DURATION_TOLERANCE_SECONDS < input.durationSeconds) {
    throw new Error(`BGM_SCORE_AUDIO_DURATION_SHORT:${measuredDurationSeconds.toFixed(3)}:${input.durationSeconds.toFixed(3)}`)
  }
  const measuredDurationMs = Math.round(measuredDurationSeconds * 1000)
  const storageKey = await uploadObject(
    input.audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: input.taskId,
      artifact: 'bgm-score:mix',
      extension: extensionFromMimeType(input.audio.mimeType),
    }),
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
        `锚定镜头号: ${input.cue.shotNumbers.length > 0 ? input.cue.shotNumbers.join(', ') : '无'}`,
        '必须保持和相邻 cue 可无缝衔接的速度、调性、音色与情绪连续性。',
      ].join('\n')
    : [
        `Render only BGM cue ${String(input.cue.index)} of ${String(input.cueCount)}.`,
        `This cue is ${input.cue.durationSeconds.toFixed(3)} seconds and covers episode timeline ${input.cue.startSeconds.toFixed(3)}-${input.cue.endSeconds.toFixed(3)} seconds.`,
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

export async function handleBgmScorePlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as BgmScoreGeneratePayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const musicModel = readString(payload.musicModel)
  const analysisModel = readString(payload.analysisModel)
  if (!episodeId) throw new Error('BGM_SCORE_EPISODE_REQUIRED')
  if (!musicModel) throw new Error('BGM_SCORE_MUSIC_MODEL_REQUIRED')
  if (!analysisModel) throw new Error('BGM_SCORE_ANALYSIS_MODEL_REQUIRED')

  const persisted = await prisma.projectEditMusicScore.findFirst({
    where: {
      episodeId,
      taskId: job.data.taskId,
      status: { in: [BGM_SCORE_STATUS.PLANNED, BGM_SCORE_STATUS.COMPLETED] },
    },
    select: { status: true, cuesJson: true },
  })
  const persistedPlan = readPersistedMusicScorePlan(persisted)
  if (persistedPlan) {
    return {
      episodeId,
      musicModel,
      designSectionCount: persistedPlan.scoreDesign.sections.length,
      promptSectionCount: persistedPlan.promptSections.length,
      virtualLayerCount: persistedPlan.virtualLayers.length,
    }
  }

  await reportTaskProgress(job, 8, { stage: 'bgm_score_prepare' })
  const [project, episode, clips] = await Promise.all([
    prisma.project.findUnique({
      where: { id: job.data.projectId },
      select: { videoRatio: true },
    }),
    prisma.projectEpisode.findFirst({
      where: { id: episodeId, projectId: job.data.projectId },
      select: { id: true },
    }),
    loadEpisodeChapterOutputClips({
      episodeId,
      projectId: job.data.projectId,
    }),
  ])
  if (!project) throw new Error('BGM_SCORE_PROJECT_NOT_FOUND')
  if (!episode) throw new Error('BGM_SCORE_EPISODE_NOT_FOUND')
  ensureSchedulableTimeline(clips)
  const editScriptId = `episode:${episodeId}`
  const durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
  const timelineSignature = buildBgmTimelineSignature(clips)

  await writeBgmScoreProjectData({
    episodeId,
    bgmScore: {
      status: BGM_SCORE_STATUS.PLANNING,
      taskId: job.data.taskId,
      editScriptId,
      timelineSignature,
      durationSeconds,
      musicModel,
    },
  })

  await reportTaskProgress(job, 25, { stage: 'bgm_score_plan' })
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
              projectContext: { videoRatio: project.videoRatio },
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
  await writeBgmScoreProjectData({
    episodeId,
    bgmScore: {
      status: BGM_SCORE_STATUS.PLANNED,
      taskId: job.data.taskId,
      editScriptId,
      timelineSignature,
      durationSeconds,
      musicModel,
      plan,
    },
  })
  await reportTaskProgress(job, 95, { stage: 'bgm_score_plan_persisted' })

  return {
    episodeId,
    musicModel,
    designSectionCount: plan.scoreDesign.sections.length,
    promptSectionCount: plan.promptSections.length,
    virtualLayerCount: plan.virtualLayers.length,
  }
}

export async function handleBgmScoreGenerateTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as BgmScoreGeneratePayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const musicModel = readString(payload.musicModel)
  const approvedTimelineSignature = readString(payload.timelineSignature)
  const approvedPlanHash = readString(payload.bgmScorePlanHash)
  if (!episodeId) throw new Error('BGM_SCORE_GENERATE_EPISODE_REQUIRED')
  if (!musicModel) throw new Error('BGM_SCORE_GENERATE_MUSIC_MODEL_REQUIRED')
  if (!approvedTimelineSignature) throw new Error('BGM_SCORE_GENERATE_TIMELINE_SIGNATURE_REQUIRED')
  if (!approvedPlanHash) throw new Error('BGM_SCORE_GENERATE_PLAN_HASH_REQUIRED')
  if (
    job.data.operationId !== 'generate_episode_bgm_score'
    || !job.data.approvalGrantId
    || !job.data.operationExecutionId
  ) {
    throw new Error('BGM_SCORE_BILLABLE_MEDIA_APPROVAL_REQUIRED')
  }
  const approvedPlan = parseBgmScorePlanStrict(payload.bgmScorePlan)
  const computedApprovedPlanHash = buildBgmScorePlanFingerprint({
    plan: approvedPlan,
    timelineSignature: approvedTimelineSignature,
    musicModel,
  })
  if (computedApprovedPlanHash !== approvedPlanHash) {
    throw new Error(`BGM_SCORE_APPROVED_PLAN_HASH_INVALID:${approvedPlanHash}:${computedApprovedPlanHash}`)
  }

  const completed = await prisma.projectEditMusicScore.findFirst({
    where: { episodeId, taskId: job.data.taskId, status: BGM_SCORE_STATUS.COMPLETED },
    select: { status: true, mixJson: true, musicModel: true },
  })
  const completedMix = readCompletedMusicScoreMix(completed)
  if (completedMix) {
    if (!completed?.musicModel) throw new Error(`BGM_SCORE_COMPLETED_MODEL_MISSING:${episodeId}`)
    return {
      episodeId,
      mediaId: completedMix.mediaId,
      audioUrl: completedMix.url,
      storageKey: completedMix.storageKey,
      musicModel: completed.musicModel,
      durationMs: completedMix.durationMs,
    }
  }

  await reportTaskProgress(job, 8, { stage: 'bgm_score_generate_prepare' })
  const [persistedScore, clips] = await Promise.all([
    prisma.projectEditMusicScore.findUnique({
      where: { episodeId },
      select: { cuesJson: true, timelineSignature: true, musicModel: true },
    }),
    loadEpisodeChapterOutputClips({
      episodeId,
      projectId: job.data.projectId,
    }),
  ])
  if (!persistedScore) throw new Error('BGM_SCORE_PLAN_REQUIRED')
  const persistedPlan = readPersistedMusicScorePlan(persistedScore)
  if (!persistedPlan) throw new Error('BGM_SCORE_PERSISTED_PLAN_REQUIRED')
  const persistedTimelineSignature = readString(persistedScore.timelineSignature)
  const persistedMusicModel = readString(persistedScore.musicModel)
  if (persistedMusicModel !== musicModel) {
    throw new Error(`BGM_SCORE_APPROVED_MODEL_STALE:${musicModel}:${persistedMusicModel}`)
  }
  const persistedPlanHash = buildBgmScorePlanFingerprint({
    plan: persistedPlan,
    timelineSignature: persistedTimelineSignature,
    musicModel: persistedMusicModel,
  })
  if (persistedPlanHash !== approvedPlanHash) {
    throw new Error(`BGM_SCORE_APPROVED_PLAN_STALE:${approvedPlanHash}:${persistedPlanHash}`)
  }

  ensureSchedulableTimeline(clips)
  const durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
  const timelineSignature = buildBgmTimelineSignature(clips)
  if (timelineSignature !== approvedTimelineSignature) {
    throw new Error(`BGM_SCORE_TIMELINE_STALE:${approvedTimelineSignature}:${timelineSignature}`)
  }
  const cueWindows = buildBgmScoreCueWindows(clips, resolveMusicScoreMaxCueDurationSeconds())
  if (cueWindows.length === 0) throw new Error('BGM_SCORE_CUE_WINDOWS_EMPTY')
  const editScriptId = `episode:${episodeId}`
  await writeBgmScoreProjectData({
    episodeId,
    bgmScore: {
      status: BGM_SCORE_STATUS.GENERATING,
      taskId: job.data.taskId,
      editScriptId,
      timelineSignature,
      durationSeconds,
      musicModel,
      plan: approvedPlan,
    },
  })

  const outputFormat = readOutputFormat(payload.outputFormat)
  const renderedCues: BgmScoreCue[] = []
  const cueAudios: Array<{
    readonly cueId: string
    readonly audio: GeneratedAudioBuffer
    readonly durationSeconds: number
  }> = []
  for (const cue of cueWindows) {
    const progress = 20 + Math.round((cue.index - 1) / cueWindows.length * 65)
    await reportTaskProgress(job, progress, {
      stage: 'bgm_score_generate_music',
      cueId: cue.cueId,
      cueIndex: cue.index,
      cueCount: cueWindows.length,
      designSectionCount: approvedPlan.scoreDesign.sections.length,
      promptSectionCount: approvedPlan.promptSections.length,
      virtualLayerCount: approvedPlan.virtualLayers.length,
    })
    const cuePrompt = buildCueMusicPrompt({
      plan: approvedPlan,
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
    }, { key: `media:music:cue:${cue.cueId}` })
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
  const mix = await uploadGeneratedBgmMix({ audio, durationSeconds, taskId: job.data.taskId })
  const bgmScore: BgmScoreProjectData = {
    status: BGM_SCORE_STATUS.COMPLETED,
    taskId: job.data.taskId,
    editScriptId,
    timelineSignature,
    durationSeconds,
    musicModel,
    plan: approvedPlan,
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
    designSectionCount: approvedPlan.scoreDesign.sections.length,
    promptSectionCount: approvedPlan.promptSections.length,
    virtualLayerCount: approvedPlan.virtualLayers.length,
    durationMs: mix.durationMs,
  }
}
