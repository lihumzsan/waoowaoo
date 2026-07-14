import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Job } from 'bullmq'
import { z } from 'zod'
import { generateSoundEffect } from '@/lib/ai-exec/engine'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { getProjectModelConfig } from '@/lib/config-service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import type { TaskJobData } from '@/lib/task/types'
import {
  buildFfmpegExecFileOptions,
  resolveFfmpegBinary,
  type FfmpegBinaryName,
} from '@/lib/video-compose/ffmpeg-binaries'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'
import { reportTaskProgress } from '@/lib/workers/shared'
import { renderAmbientSoundMix } from './mixer'
import {
  buildAmbientSoundPlanFingerprint,
  parseAmbientSoundPlanStrict,
  resolveAmbientSoundPlanReferences,
} from './plan-contract'
import { buildAmbientSoundPlanPrompt } from './prompt'
import {
  readCompletedAmbientSoundMix,
  readAmbientSoundSourcesStrict,
  writeAmbientSoundProjectData,
} from './project-data'
import {
  buildAmbientSoundTimelineSignature,
  resolveAmbientSoundSectionTimeline,
} from './timeline'
import {
  AMBIENT_SOUND_STATUS,
  AMBIENT_SOUND_OUTPUT_FORMAT,
  type AmbientSoundMix,
  type AmbientSoundPlan,
  type AmbientSoundPlanSource,
  type AmbientSoundProjectData,
  type AmbientSoundSourceAsset,
} from './types'

const execFileAsync = promisify(execFile)
const AMBIENT_SOUND_DURATION_TOLERANCE_SECONDS = 0.25

type CommandResult = {
  readonly stdout: string | Buffer
  readonly stderr: string | Buffer
}

type GeneratedAudioBuffer = {
  readonly buffer: Buffer
  readonly mimeType: string
}

type AmbientSoundPayload = {
  readonly episodeId?: unknown
  readonly soundEffectModel?: unknown
  readonly ambientSoundPlan?: unknown
  readonly ambientSoundPlanHash?: unknown
  readonly timelineSignature?: unknown
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

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
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
  if (!audioUrl) throw new Error('AMBIENT_SOUND_EMPTY_AUDIO_RESULT')
  const decoded = decodeAudioDataUrl(audioUrl)
  if (decoded) return decoded

  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) {
    throw new Error(`AMBIENT_SOUND_AUDIO_DOWNLOAD_FAILED:${response.status}`)
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') || explicitMimeType,
  }
}

async function probeAudioDurationSeconds(input: GeneratedAudioBuffer): Promise<number> {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-ambient-sound-probe-'))
  const audioPath = path.join(workspaceDir, `audio.${extensionFromMimeType(input.mimeType)}`)
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
      throw new Error('AMBIENT_SOUND_AUDIO_DURATION_PROBE_FAILED')
    }
    return duration
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

function ensureTimeline(clips: readonly FinalRenderClipPlan[]): void {
  if (clips.length === 0) throw new Error('AMBIENT_SOUND_VIDEO_TIMELINE_INCOMPLETE')
  const invalid = clips.find((clip) => !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0)
  if (invalid) {
    throw new Error(`AMBIENT_SOUND_VIDEO_TIMELINE_INCOMPLETE:${invalid.sourceId}`)
  }
}

function sourceMatchesPlan(input: {
  readonly asset: AmbientSoundSourceAsset
  readonly source: AmbientSoundPlanSource
  readonly soundEffectModel: string
}): boolean {
  return input.asset.environmentFingerprint === input.source.environmentFingerprint
    && input.asset.soundEffectModel === input.soundEffectModel
}

function findReusableSource(input: {
  readonly existingSources: readonly AmbientSoundSourceAsset[]
  readonly source: AmbientSoundPlanSource
  readonly soundEffectModel: string
}): AmbientSoundSourceAsset | null {
  const asset = input.existingSources.find((candidate) => sourceMatchesPlan({
    asset: candidate,
    source: input.source,
    soundEffectModel: input.soundEffectModel,
  }))
  if (!asset) return null
  return {
    ...asset,
    sourceId: input.source.sourceId,
  }
}

async function uploadGeneratedAmbientSoundSource(input: {
  readonly audio: GeneratedAudioBuffer
  readonly source: AmbientSoundPlanSource
  readonly soundEffectModel: string
  readonly taskId: string
}): Promise<AmbientSoundSourceAsset> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds <= 0) throw new Error('AMBIENT_SOUND_SOURCE_AUDIO_DURATION_INVALID')
  const measuredDurationMs = Math.round(measuredDurationSeconds * 1000)
  const storageKey = await uploadObject(
    input.audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: input.taskId,
      artifact: `ambientSound:source:${input.source.sourceId}`,
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
    sourceId: input.source.sourceId,
    environmentFingerprint: input.source.environmentFingerprint,
    prompt: input.source.prompt,
    mediaId: media.id,
    url: media.url,
    storageKey,
    mimeType: input.audio.mimeType,
    durationMs: measuredDurationMs,
    loopDurationSeconds: input.source.loopDurationSeconds,
    promptInfluence: input.source.promptInfluence,
    soundEffectModel: input.soundEffectModel,
  }
}

async function generateAmbientSoundSource(input: {
  readonly userId: string
  readonly soundEffectModel: string
  readonly source: AmbientSoundPlanSource
  readonly taskId: string
}): Promise<AmbientSoundSourceAsset> {
  const generated = await generateSoundEffect(input.userId, input.soundEffectModel, input.source.prompt, {
    durationSeconds: input.source.loopDurationSeconds,
    loop: true,
    promptInfluence: input.source.promptInfluence,
    outputFormat: AMBIENT_SOUND_OUTPUT_FORMAT,
  }, { key: `media:sound-effect:source:${input.source.sourceId}` })
  if (!generated.success) {
    throw new Error(generated.error || `AMBIENT_SOUND_PROVIDER_FAILED:${input.source.sourceId}`)
  }
  const audio = await loadAudioBuffer({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
  })
  return await uploadGeneratedAmbientSoundSource({
    audio,
    source: input.source,
    soundEffectModel: input.soundEffectModel,
    taskId: input.taskId,
  })
}

async function uploadGeneratedAmbientSoundMix(input: {
  readonly audio: GeneratedAudioBuffer
  readonly durationSeconds: number
  readonly taskId: string
}): Promise<AmbientSoundMix> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds + AMBIENT_SOUND_DURATION_TOLERANCE_SECONDS < input.durationSeconds) {
    throw new Error(`AMBIENT_SOUND_MIX_AUDIO_DURATION_SHORT:${measuredDurationSeconds.toFixed(3)}:${input.durationSeconds.toFixed(3)}`)
  }
  const measuredDurationMs = Math.round(measuredDurationSeconds * 1000)
  const storageKey = await uploadObject(
    input.audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: input.taskId,
      artifact: 'ambientSound:mix',
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

export async function handleAmbientSoundPlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AmbientSoundPayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const soundEffectModel = readString(payload.soundEffectModel)
  if (!episodeId) throw new Error('AMBIENT_SOUND_EPISODE_REQUIRED')
  if (!soundEffectModel) throw new Error('AMBIENT_SOUND_SOUND_EFFECT_MODEL_REQUIRED')

  const persistedPlan = await prisma.projectEditAmbientSound.findFirst({
    where: {
      episodeId,
      taskId: job.data.taskId,
      status: { in: [AMBIENT_SOUND_STATUS.PLANNED, AMBIENT_SOUND_STATUS.COMPLETED] },
    },
    select: { planJson: true },
  })
  if (persistedPlan?.planJson) {
    const plan = parseAmbientSoundPlanStrict(persistedPlan.planJson)
    return {
      episodeId,
      soundEffectModel,
      decision: plan.decision,
      sourceCount: plan.sources.length,
      sectionCount: plan.sections.length,
    }
  }

  let signature = ''
  let durationSeconds = 0
  let existingSources: AmbientSoundSourceAsset[] = []

  try {
    await reportTaskProgress(job, 8, { stage: 'ambient_sound_prepare' })
    const [project, episode, projectModelConfig, existingAmbientSound] = await Promise.all([
      prisma.project.findUnique({
        where: { id: job.data.projectId },
        select: { videoRatio: true },
      }),
      prisma.projectEpisode.findFirst({
        where: { id: episodeId, projectId: job.data.projectId },
        select: { id: true },
      }),
      getProjectModelConfig(job.data.projectId, job.data.userId),
      prisma.projectEditAmbientSound.findUnique({
        where: { episodeId },
        select: { sourcesJson: true },
      }),
    ])
    if (!project) throw new Error('AMBIENT_SOUND_PROJECT_NOT_FOUND')
    if (!episode) throw new Error('AMBIENT_SOUND_EPISODE_NOT_FOUND')
    const analysisModel = readString(projectModelConfig.analysisModel)
    if (!analysisModel) throw new Error('AMBIENT_SOUND_ANALYSIS_MODEL_REQUIRED')
    existingSources = readAmbientSoundSourcesStrict(existingAmbientSound?.sourcesJson ?? null)

    const clips = await loadEpisodeChapterOutputClips({
      episodeId,
      projectId: job.data.projectId,
    })
    ensureTimeline(clips)
    durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
    signature = buildAmbientSoundTimelineSignature(clips)

    await writeAmbientSoundProjectData({
      episodeId,
      ambientSound: {
        status: AMBIENT_SOUND_STATUS.PLANNING,
        taskId: job.data.taskId,
        planTaskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        sources: existingSources,
      },
    })

    await reportTaskProgress(job, 35, { stage: 'ambient_sound_plan' })
    const streamContext = createWorkerLLMStreamContext(job, 'ambient_sound_plan')
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
              content: buildAmbientSoundPlanPrompt({
                projectContext: { videoRatio: project.videoRatio },
                clips,
                totalDurationSeconds: durationSeconds,
                locale: job.data.locale,
              }),
            }],
            temperature: 0.25,
            projectId: job.data.projectId,
            action: 'ambient_sound_plan',
            locale: job.data.locale,
            meta: {
              stepId: 'ambient_sound_plan',
              stepTitle: 'ambient_sound_plan',
              stepIndex: 1,
              stepTotal: 1,
            },
            schema: z.unknown(),
            parse: { kind: 'object' },
            validate: (value) => resolveAmbientSoundPlanReferences(value, clips),
          })
        } finally {
          await streamCallbacks.flush()
        }
      },
    )
    const plan = completion.data
    resolveAmbientSoundSectionTimeline({ clips, plan })

    if (plan.decision === 'none_needed') {
      await writeAmbientSoundProjectData({
        episodeId,
        ambientSound: {
          status: AMBIENT_SOUND_STATUS.COMPLETED,
          taskId: job.data.taskId,
          planTaskId: job.data.taskId,
          timelineSignature: signature,
          durationSeconds,
          soundEffectModel,
          plan,
          sources: [],
        },
      })
      return {
        episodeId,
        soundEffectModel,
        decision: plan.decision,
        sourceCount: 0,
        sectionCount: 0,
      }
    }

    await writeAmbientSoundProjectData({
      episodeId,
      ambientSound: {
        status: AMBIENT_SOUND_STATUS.PLANNED,
        taskId: job.data.taskId,
        planTaskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        plan,
        sources: existingSources,
      },
    })

    await reportTaskProgress(job, 95, { stage: 'ambient_sound_plan_persisted' })

    return {
      episodeId,
      soundEffectModel,
      decision: plan.decision,
      sourceCount: plan.sources.length,
      sectionCount: plan.sections.length,
    }
  } catch (error) {
    throw error
  }
}

export async function handleAmbientSoundGenerateTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AmbientSoundPayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const soundEffectModel = readString(payload.soundEffectModel)
  const approvedTimelineSignature = readString(payload.timelineSignature)
  const approvedPlanHash = readString(payload.ambientSoundPlanHash)
  if (!episodeId) throw new Error('AMBIENT_SOUND_GENERATE_EPISODE_REQUIRED')
  if (!soundEffectModel) throw new Error('AMBIENT_SOUND_GENERATE_SOUND_EFFECT_MODEL_REQUIRED')
  if (!approvedTimelineSignature) throw new Error('AMBIENT_SOUND_GENERATE_TIMELINE_SIGNATURE_REQUIRED')
  if (!approvedPlanHash) throw new Error('AMBIENT_SOUND_GENERATE_PLAN_HASH_REQUIRED')
  if (
    job.data.operationId !== 'generate_episode_ambient_sound'
    || !job.data.approvalGrantId
    || !job.data.operationExecutionId
  ) {
    throw new Error('AMBIENT_SOUND_BILLABLE_MEDIA_APPROVAL_REQUIRED')
  }
  const approvedPlan = parseAmbientSoundPlanStrict(payload.ambientSoundPlan)
  if (approvedPlan.decision !== 'ambient_sound') {
    throw new Error(`AMBIENT_SOUND_GENERATE_NOT_REQUIRED:${approvedPlan.decision}`)
  }
  const computedApprovedPlanHash = buildAmbientSoundPlanFingerprint({
    plan: approvedPlan,
    timelineSignature: approvedTimelineSignature,
    soundEffectModel,
  })
  if (computedApprovedPlanHash !== approvedPlanHash) {
    throw new Error(`AMBIENT_SOUND_APPROVED_PLAN_HASH_INVALID:${approvedPlanHash}:${computedApprovedPlanHash}`)
  }

  const completed = await prisma.projectEditAmbientSound.findFirst({
    where: { episodeId, taskId: job.data.taskId, status: AMBIENT_SOUND_STATUS.COMPLETED },
    select: { status: true, mixJson: true },
  })
  const completedMix = readCompletedAmbientSoundMix(completed)
  if (completedMix) {
    return {
      episodeId,
      mediaId: completedMix.mediaId,
      audioUrl: completedMix.url,
      storageKey: completedMix.storageKey,
      soundEffectModel,
      sourceCount: approvedPlan.sources.length,
      sectionCount: approvedPlan.sections.length,
      durationMs: completedMix.durationMs,
    }
  }

  let signature = ''
  let durationSeconds = 0
  let plan: AmbientSoundPlan | undefined
  let sources: AmbientSoundSourceAsset[] = []

  try {
    await reportTaskProgress(job, 10, { stage: 'ambient_sound_generate_sources' })
    const [ambientSound, clips] = await Promise.all([
      prisma.projectEditAmbientSound.findUnique({
        where: { episodeId },
        select: {
          planJson: true,
          sourcesJson: true,
          timelineSignature: true,
        },
      }),
      loadEpisodeChapterOutputClips({
        episodeId,
        projectId: job.data.projectId,
      }),
    ])
    if (!ambientSound) throw new Error('AMBIENT_SOUND_PLAN_REQUIRED')
    const persistedPlan = parseAmbientSoundPlanStrict(ambientSound.planJson)
    const persistedTimelineSignature = readString(ambientSound.timelineSignature)
    const persistedPlanHash = buildAmbientSoundPlanFingerprint({
      plan: persistedPlan,
      timelineSignature: persistedTimelineSignature,
      soundEffectModel,
    })
    if (persistedPlanHash !== approvedPlanHash) {
      throw new Error(`AMBIENT_SOUND_APPROVED_PLAN_STALE:${approvedPlanHash}:${persistedPlanHash}`)
    }
    plan = approvedPlan
    ensureTimeline(clips)
    durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
    signature = buildAmbientSoundTimelineSignature(clips)
    if (approvedTimelineSignature !== signature) {
      throw new Error(`AMBIENT_SOUND_TIMELINE_STALE:${approvedTimelineSignature}:${signature}`)
    }
    sources = readAmbientSoundSourcesStrict(ambientSound.sourcesJson)

    await writeAmbientSoundProjectData({
      episodeId,
      ambientSound: {
        status: AMBIENT_SOUND_STATUS.GENERATING,
        taskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        plan,
        sources,
      },
    })

    const generatedSources: AmbientSoundSourceAsset[] = []
    for (const [index, source] of plan.sources.entries()) {
      const reusable = findReusableSource({ existingSources: sources, source, soundEffectModel })
      const resolvedSource = reusable ?? await generateAmbientSoundSource({
        userId: job.data.userId,
        soundEffectModel,
        source,
        taskId: job.data.taskId,
      })
      generatedSources.push(resolvedSource)
      await reportTaskProgress(job, 20 + Math.round((index + 1) / plan.sources.length * 40), {
        stage: 'ambient_sound_generate_sources',
        sourceId: source.sourceId,
        sourceIndex: index + 1,
        sourceCount: plan.sources.length,
        reused: Boolean(reusable),
      })
    }
    sources = generatedSources

    const sections = resolveAmbientSoundSectionTimeline({ clips, plan })
    await reportTaskProgress(job, 68, {
      stage: 'ambient_sound_mix',
      sourceCount: sources.length,
      sectionCount: sections.length,
    })

    const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-ambient-sound-mix-'))
    try {
      const sourcePaths: string[] = []
      for (const [index, source] of sources.entries()) {
        const sourcePath = path.join(workspaceDir, `source-${index + 1}.${extensionFromMimeType(source.mimeType)}`)
        await writeFile(sourcePath, await getObjectBuffer(source.storageKey))
        sourcePaths.push(sourcePath)
      }

      const mixPath = path.join(workspaceDir, 'ambientSound-mix.m4a')
      await renderAmbientSoundMix({
        runCommand: async (command, args) => {
          if (command !== 'ffmpeg') throw new Error(`AMBIENT_SOUND_UNSUPPORTED_AUDIO_COMMAND:${command}`)
          const result = await runFfmpegCommand(command, args)
          return {
            stdout: String(result.stdout ?? ''),
            stderr: String(result.stderr ?? ''),
          }
        },
        sourcePaths,
        sources,
        sections,
        outputPath: mixPath,
        durationSeconds,
      })
      const mix = await uploadGeneratedAmbientSoundMix({
        audio: {
          buffer: await readFile(mixPath),
          mimeType: 'audio/mp4',
        },
        durationSeconds,
        taskId: job.data.taskId,
      })

      await reportTaskProgress(job, 90, { stage: 'ambient_sound_persist' })
      const ambientSoundData: AmbientSoundProjectData = {
        status: AMBIENT_SOUND_STATUS.COMPLETED,
        taskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        plan,
        sources,
        mix,
      }
      await writeAmbientSoundProjectData({ episodeId, ambientSound: ambientSoundData })

      return {
        episodeId,
        mediaId: mix.mediaId,
        audioUrl: mix.url,
        storageKey: mix.storageKey,
        soundEffectModel,
        sourceCount: sources.length,
        sectionCount: sections.length,
        durationMs: mix.durationMs,
      }
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  } catch (error) {
    throw error
  }
}
