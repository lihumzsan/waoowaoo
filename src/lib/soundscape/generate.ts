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
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { requiresBillableMediaApproval } from '@/lib/billing/media-approval-policy'
import { shouldExposeBillingCredits } from '@/lib/billing/task-billing-view'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { prisma } from '@/lib/prisma'
import { generateUniqueKey, getObjectBuffer, toFetchableUrl, uploadObject } from '@/lib/storage'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import {
  buildFfmpegExecFileOptions,
  resolveFfmpegBinary,
  type FfmpegBinaryName,
} from '@/lib/video-compose/ffmpeg-binaries'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'
import { reportTaskProgress } from '@/lib/workers/shared'
import { renderSoundscapeMix } from './mixer'
import { buildSoundscapePlanPrompt } from './prompt'
import {
  readSoundscapeSourcesStrict,
  writeSoundscapeProjectData,
} from './project-data'
import {
  buildSoundscapeTimelineSignature,
  resolveSoundscapeSectionTimeline,
} from './timeline'
import {
  SOUNDSCAPE_STATUS,
  soundscapePlanSchema,
  type SoundscapeMix,
  type SoundscapePlan,
  type SoundscapePlanSource,
  type SoundscapeProjectData,
  type SoundscapeSourceAsset,
} from './types'

const execFileAsync = promisify(execFile)
const SOUNDSCAPE_DURATION_TOLERANCE_SECONDS = 0.25
const SOUNDSCAPE_OUTPUT_FORMAT = 'mp3_44100_128'

type CommandResult = {
  readonly stdout: string | Buffer
  readonly stderr: string | Buffer
}

type GeneratedAudioBuffer = {
  readonly buffer: Buffer
  readonly mimeType: string
}

type SoundscapePayload = {
  readonly episodeId?: unknown
  readonly soundEffectModel?: unknown
  readonly approvedMediaMaxCost?: unknown
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

function readNonnegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
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
  if (!audioUrl) throw new Error('SOUNDSCAPE_EMPTY_AUDIO_RESULT')
  const decoded = decodeAudioDataUrl(audioUrl)
  if (decoded) return decoded

  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) {
    throw new Error(`SOUNDSCAPE_AUDIO_DOWNLOAD_FAILED:${response.status}`)
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') || explicitMimeType,
  }
}

async function probeAudioDurationSeconds(input: GeneratedAudioBuffer): Promise<number> {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-soundscape-probe-'))
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
      throw new Error('SOUNDSCAPE_AUDIO_DURATION_PROBE_FAILED')
    }
    return duration
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

function ensureTimeline(clips: readonly FinalRenderClipPlan[]): void {
  if (clips.length === 0) throw new Error('SOUNDSCAPE_VIDEO_TIMELINE_INCOMPLETE')
  const invalid = clips.find((clip) => !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0)
  if (invalid) {
    throw new Error(`SOUNDSCAPE_VIDEO_TIMELINE_INCOMPLETE:${invalid.groupId ?? invalid.panelId}`)
  }
}

function parseSoundscapePlanValue(raw: unknown): SoundscapePlan {
  const result = soundscapePlanSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`SOUNDSCAPE_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
}

function planSourceDurationSeconds(plan: SoundscapePlan): number {
  return plan.sources.reduce((total, source) => total + source.loopDurationSeconds, 0)
}

function sourceMatchesPlan(input: {
  readonly asset: SoundscapeSourceAsset
  readonly source: SoundscapePlanSource
  readonly soundEffectModel: string
}): boolean {
  return input.asset.environmentFingerprint === input.source.environmentFingerprint
    && input.asset.soundEffectModel === input.soundEffectModel
}

function findReusableSource(input: {
  readonly existingSources: readonly SoundscapeSourceAsset[]
  readonly source: SoundscapePlanSource
  readonly soundEffectModel: string
}): SoundscapeSourceAsset | null {
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

async function uploadGeneratedSoundscapeSource(input: {
  readonly audio: GeneratedAudioBuffer
  readonly source: SoundscapePlanSource
  readonly soundEffectModel: string
}): Promise<SoundscapeSourceAsset> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds <= 0) throw new Error('SOUNDSCAPE_SOURCE_AUDIO_DURATION_INVALID')
  const measuredDurationMs = Math.round(measuredDurationSeconds * 1000)
  const storageKey = await uploadObject(
    input.audio.buffer,
    generateUniqueKey('soundscape/source', extensionFromMimeType(input.audio.mimeType)),
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

async function generateSoundscapeSource(input: {
  readonly userId: string
  readonly soundEffectModel: string
  readonly source: SoundscapePlanSource
}): Promise<SoundscapeSourceAsset> {
  const generated = await generateSoundEffect(input.userId, input.soundEffectModel, input.source.prompt, {
    durationSeconds: input.source.loopDurationSeconds,
    loop: true,
    promptInfluence: input.source.promptInfluence,
    outputFormat: SOUNDSCAPE_OUTPUT_FORMAT,
  })
  if (!generated.success) {
    throw new Error(generated.error || `SOUNDSCAPE_PROVIDER_FAILED:${input.source.sourceId}`)
  }
  const audio = await loadAudioBuffer({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
  })
  return await uploadGeneratedSoundscapeSource({
    audio,
    source: input.source,
    soundEffectModel: input.soundEffectModel,
  })
}

async function uploadGeneratedSoundscapeMix(input: {
  readonly audio: GeneratedAudioBuffer
  readonly durationSeconds: number
}): Promise<SoundscapeMix> {
  const measuredDurationSeconds = await probeAudioDurationSeconds(input.audio)
  if (measuredDurationSeconds + SOUNDSCAPE_DURATION_TOLERANCE_SECONDS < input.durationSeconds) {
    throw new Error(`SOUNDSCAPE_MIX_AUDIO_DURATION_SHORT:${measuredDurationSeconds.toFixed(3)}:${input.durationSeconds.toFixed(3)}`)
  }
  const measuredDurationMs = Math.round(measuredDurationSeconds * 1000)
  const storageKey = await uploadObject(
    input.audio.buffer,
    generateUniqueKey('soundscape/mix', extensionFromMimeType(input.audio.mimeType)),
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

async function submitSoundscapeGenerateTask(input: {
  readonly job: Job<TaskJobData>
  readonly episodeId: string
  readonly soundEffectModel: string
  readonly plan: SoundscapePlan
  readonly approvedMediaMaxCost: number | null
}): Promise<void> {
  if (
    input.job.data.operationId !== 'generate_episode_soundscape'
    || input.job.data.operationConfirmed !== true
  ) {
    throw new Error('SOUNDSCAPE_BILLABLE_MEDIA_APPROVAL_REQUIRED')
  }

  const payload = {
    episodeId: input.episodeId,
    soundEffectModel: input.soundEffectModel,
    durationSeconds: Math.max(0.5, planSourceDurationSeconds(input.plan)),
    sourceCount: input.plan.sources.length,
    loop: true,
    outputFormat: SOUNDSCAPE_OUTPUT_FORMAT,
  }
  const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.SOUNDSCAPE_GENERATE, payload)
  if (!requiresBillableMediaApproval(billingInfo) || billingInfo.apiType !== 'sound_effect') {
    throw new Error('SOUNDSCAPE_BILLING_INFO_REQUIRED')
  }
  if (shouldExposeBillingCredits()) {
    if (input.approvedMediaMaxCost === null) {
      throw new Error('SOUNDSCAPE_APPROVED_MEDIA_MAX_COST_REQUIRED')
    }
    if (billingInfo.maxFrozenCost > input.approvedMediaMaxCost) {
      throw new Error(
        `SOUNDSCAPE_APPROVED_MEDIA_MAX_COST_EXCEEDED:${billingInfo.maxFrozenCost}:${input.approvedMediaMaxCost}`,
      )
    }
  }

  await submitTask({
    userId: input.job.data.userId,
    locale: input.job.data.locale,
    requestId: input.job.data.trace?.requestId || null,
    projectId: input.job.data.projectId,
    parentTaskId: input.job.data.taskId,
    episodeId: input.episodeId,
    type: TASK_TYPE.SOUNDSCAPE_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: input.episodeId,
    payload,
    billingInfo,
    billingInfoSource: 'planned',
    dedupeKey: `soundscape_generate:${input.job.data.projectId}:${input.episodeId}:${input.job.data.taskId}`,
    operationId: 'generate_episode_soundscape',
    operationSource: 'worker',
    operationConfirmed: input.job.data.operationConfirmed,
    operationRequestId: input.job.data.operationRequestId || input.job.data.trace?.requestId || null,
  })
}

export async function handleSoundscapePlanTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as SoundscapePayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const soundEffectModel = readString(payload.soundEffectModel)
  const approvedMediaMaxCost = readNonnegativeNumber(payload.approvedMediaMaxCost)
  if (!episodeId) throw new Error('SOUNDSCAPE_EPISODE_REQUIRED')
  if (!soundEffectModel) throw new Error('SOUNDSCAPE_SOUND_EFFECT_MODEL_REQUIRED')

  let signature = ''
  let durationSeconds = 0
  let existingSources: SoundscapeSourceAsset[] = []

  try {
    await reportTaskProgress(job, 8, { stage: 'soundscape_prepare' })
    const [project, episode, projectModelConfig, existingSoundscape] = await Promise.all([
      prisma.project.findUnique({
        where: { id: job.data.projectId },
        select: { videoRatio: true },
      }),
      prisma.projectEpisode.findFirst({
        where: { id: episodeId, projectId: job.data.projectId },
        select: { id: true },
      }),
      getProjectModelConfig(job.data.projectId, job.data.userId),
      prisma.projectEditSoundscape.findUnique({
        where: { episodeId },
        select: { sourcesJson: true },
      }),
    ])
    if (!project) throw new Error('SOUNDSCAPE_PROJECT_NOT_FOUND')
    if (!episode) throw new Error('SOUNDSCAPE_EPISODE_NOT_FOUND')
    const analysisModel = readString(projectModelConfig.analysisModel)
    if (!analysisModel) throw new Error('SOUNDSCAPE_ANALYSIS_MODEL_REQUIRED')
    existingSources = readSoundscapeSourcesStrict(existingSoundscape?.sourcesJson ?? null)

    const clips = await loadEpisodeChapterOutputClips({
      episodeId,
      projectId: job.data.projectId,
    })
    ensureTimeline(clips)
    durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
    signature = buildSoundscapeTimelineSignature(clips)

    await writeSoundscapeProjectData({
      episodeId,
      soundscape: {
        schemaVersion: 1,
        status: SOUNDSCAPE_STATUS.PLANNING,
        taskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        sources: existingSources,
      },
    })

    await reportTaskProgress(job, 35, { stage: 'soundscape_plan' })
    const streamContext = createWorkerLLMStreamContext(job, 'soundscape_plan')
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
              content: buildSoundscapePlanPrompt({
                projectContext: { videoRatio: project.videoRatio },
                clips,
                totalDurationSeconds: durationSeconds,
                locale: job.data.locale,
              }),
            }],
            temperature: 0.25,
            projectId: job.data.projectId,
            action: 'soundscape_plan',
            locale: job.data.locale,
            meta: {
              stepId: 'soundscape_plan',
              stepTitle: 'soundscape_plan',
              stepIndex: 1,
              stepTotal: 1,
            },
            schema: z.unknown(),
            parse: { kind: 'object' },
            validate: parseSoundscapePlanValue,
          })
        } finally {
          await streamCallbacks.flush()
        }
      },
    )
    const plan = completion.data
    resolveSoundscapeSectionTimeline({ clips, plan })

    if (plan.decision === 'none_needed') {
      await writeSoundscapeProjectData({
        episodeId,
        soundscape: {
          schemaVersion: 1,
          status: SOUNDSCAPE_STATUS.COMPLETED,
          taskId: job.data.taskId,
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

    await writeSoundscapeProjectData({
      episodeId,
      soundscape: {
        schemaVersion: 1,
        status: SOUNDSCAPE_STATUS.PLANNED,
        taskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        plan,
        sources: existingSources,
      },
    })

    await reportTaskProgress(job, 88, { stage: 'soundscape_enqueue_generate' })
    await submitSoundscapeGenerateTask({
      job,
      episodeId,
      soundEffectModel,
      plan,
      approvedMediaMaxCost,
    })

    return {
      episodeId,
      soundEffectModel,
      decision: plan.decision,
      sourceCount: plan.sources.length,
      sectionCount: plan.sections.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (signature && durationSeconds > 0) {
      await writeSoundscapeProjectData({
        episodeId,
        soundscape: {
          schemaVersion: 1,
          status: SOUNDSCAPE_STATUS.FAILED,
          taskId: job.data.taskId,
          timelineSignature: signature,
          durationSeconds,
          soundEffectModel,
          sources: existingSources,
          errorMessage: message,
        },
      })
    }
    throw error
  }
}

export async function handleSoundscapeGenerateTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as SoundscapePayload
  const episodeId = readString(payload.episodeId) || readString(job.data.episodeId)
  const soundEffectModel = readString(payload.soundEffectModel)
  if (!episodeId) throw new Error('SOUNDSCAPE_GENERATE_EPISODE_REQUIRED')
  if (!soundEffectModel) throw new Error('SOUNDSCAPE_GENERATE_SOUND_EFFECT_MODEL_REQUIRED')

  let signature = ''
  let durationSeconds = 0
  let plan: SoundscapePlan | undefined
  let sources: SoundscapeSourceAsset[] = []

  try {
    await reportTaskProgress(job, 10, { stage: 'soundscape_generate_sources' })
    const [soundscape, clips] = await Promise.all([
      prisma.projectEditSoundscape.findUnique({
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
    if (!soundscape) throw new Error('SOUNDSCAPE_PLAN_REQUIRED')
    plan = parseSoundscapePlanValue(soundscape.planJson)
    if (plan.decision !== 'soundscape') throw new Error(`SOUNDSCAPE_GENERATE_NOT_REQUIRED:${plan.decision}`)
    ensureTimeline(clips)
    durationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
    signature = buildSoundscapeTimelineSignature(clips)
    if (soundscape.timelineSignature !== signature) {
      throw new Error(`SOUNDSCAPE_TIMELINE_STALE:${soundscape.timelineSignature ?? 'null'}:${signature}`)
    }
    sources = readSoundscapeSourcesStrict(soundscape.sourcesJson)

    await writeSoundscapeProjectData({
      episodeId,
      soundscape: {
        schemaVersion: 1,
        status: SOUNDSCAPE_STATUS.GENERATING,
        taskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        plan,
        sources,
      },
    })

    const generatedSources: SoundscapeSourceAsset[] = []
    for (const [index, source] of plan.sources.entries()) {
      const reusable = findReusableSource({ existingSources: sources, source, soundEffectModel })
      const resolvedSource = reusable ?? await generateSoundscapeSource({
        userId: job.data.userId,
        soundEffectModel,
        source,
      })
      generatedSources.push(resolvedSource)
      await reportTaskProgress(job, 20 + Math.round((index + 1) / plan.sources.length * 40), {
        stage: 'soundscape_generate_sources',
        sourceId: source.sourceId,
        sourceIndex: index + 1,
        sourceCount: plan.sources.length,
        reused: Boolean(reusable),
      })
    }
    sources = generatedSources

    const sections = resolveSoundscapeSectionTimeline({ clips, plan })
    await reportTaskProgress(job, 68, {
      stage: 'soundscape_mix',
      sourceCount: sources.length,
      sectionCount: sections.length,
    })

    const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-soundscape-mix-'))
    try {
      const sourcePaths: string[] = []
      for (const [index, source] of sources.entries()) {
        const sourcePath = path.join(workspaceDir, `source-${index + 1}.${extensionFromMimeType(source.mimeType)}`)
        await writeFile(sourcePath, await getObjectBuffer(source.storageKey))
        sourcePaths.push(sourcePath)
      }

      const mixPath = path.join(workspaceDir, 'soundscape-mix.m4a')
      await renderSoundscapeMix({
        runCommand: async (command, args) => {
          if (command !== 'ffmpeg') throw new Error(`SOUNDSCAPE_UNSUPPORTED_AUDIO_COMMAND:${command}`)
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
      const mix = await uploadGeneratedSoundscapeMix({
        audio: {
          buffer: await readFile(mixPath),
          mimeType: 'audio/mp4',
        },
        durationSeconds,
      })

      await reportTaskProgress(job, 90, { stage: 'soundscape_persist' })
      const soundscapeData: SoundscapeProjectData = {
        schemaVersion: 1,
        status: SOUNDSCAPE_STATUS.COMPLETED,
        taskId: job.data.taskId,
        timelineSignature: signature,
        durationSeconds,
        soundEffectModel,
        plan,
        sources,
        mix,
      }
      await writeSoundscapeProjectData({ episodeId, soundscape: soundscapeData })

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
    const message = error instanceof Error ? error.message : String(error)
    if (signature && durationSeconds > 0) {
      await writeSoundscapeProjectData({
        episodeId,
        soundscape: {
          schemaVersion: 1,
          status: SOUNDSCAPE_STATUS.FAILED,
          taskId: job.data.taskId,
          timelineSignature: signature,
          durationSeconds,
          soundEffectModel,
          ...(plan ? { plan } : {}),
          sources,
          errorMessage: message,
        },
      })
    }
    throw error
  }
}
