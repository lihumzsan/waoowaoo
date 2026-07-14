import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { generateSoundEffect } from '@/lib/ai-exec/engine'
import { assertAmbienceContinuity, measureAmbienceContinuity } from '@/lib/audio-design/ambience-continuity-quality'
import { assertAmbienceLoopBoundaryQuality, measureAmbienceCandidateQuality, measureAmbienceLoopBoundary, selectBestAmbienceCandidate } from '@/lib/audio-design/ambience-loop'
import { decodeMonoFloat32, extensionFromAudioMimeType, loadGeneratedAudioBuffer, uploadTaskAudioArtifact } from '@/lib/audio-design/audio-assets'
import { buildAudioDesignSignature, buildAudioDesignTimelineSignature, parseAudioDesignStrict } from '@/lib/audio-design/contract'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer } from '@/lib/storage'
import { readCompletedAmbientSoundMix } from '@/lib/ambient-sound/project-data'
import type { TaskJobData } from '@/lib/task/types'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { buildFfmpegExecFileOptions, resolveFfmpegBinary, type FfmpegBinaryName } from '@/lib/video-compose/ffmpeg-binaries'
import { reportTaskProgress } from '@/lib/workers/shared'
import { renderAudioDesignAmbienceMix, type AudioDesignAmbienceTrack } from './mixer'
import { AMBIENT_SOUND_OUTPUT_FORMAT, AMBIENT_SOUND_STATUS, type AmbientSoundMix, type AmbientSoundSourceAsset } from './types'

const execFileAsync = promisify(execFile)

type Payload = {
  readonly episodeId?: unknown
  readonly soundEffectModel?: unknown
  readonly audioDesign?: unknown
  readonly designSignature?: unknown
  readonly timelineSignature?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function runCommand(binaryName: FfmpegBinaryName, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const execution = resolveFfmpegBinary(binaryName)
  const result = await execFileAsync(execution.command, [...args], buildFfmpegExecFileOptions(execution))
  return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

function readAssets(value: unknown): AmbientSoundSourceAsset[] {
  if (!Array.isArray(value)) return []
  return value.map((asset, index) => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new Error(`AMBIENT_SOUND_CANDIDATE_INVALID:${index}`)
    return asset as unknown as AmbientSoundSourceAsset
  })
}

async function persistAssets(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly designSignature: string
  readonly assets: readonly AmbientSoundSourceAsset[]
}): Promise<void> {
  const result = await prisma.projectEditAmbientSound.updateMany({
    where: {
      episodeId: input.episodeId,
      taskId: input.taskId,
      designSignature: input.designSignature,
      status: AMBIENT_SOUND_STATUS.GENERATING,
    },
    data: { sourcesJson: input.assets as unknown as Prisma.InputJsonValue },
  })
  if (result.count !== 1) throw new Error(`AMBIENT_SOUND_OWNER_FENCE_REJECTED:${input.episodeId}:${input.taskId}`)
}

function asMix(input: Awaited<ReturnType<typeof uploadTaskAudioArtifact>>): AmbientSoundMix {
  return input
}

export async function handleAmbientSoundGenerateTask(job: Job<TaskJobData>): Promise<Record<string, unknown>> {
  const payload = (job.data.payload ?? {}) as Payload
  const episodeId = text(payload.episodeId) || text(job.data.episodeId)
  const soundEffectModel = text(payload.soundEffectModel)
  const approvedDesignSignature = text(payload.designSignature)
  const approvedTimelineSignature = text(payload.timelineSignature)
  if (!episodeId) throw new Error('AMBIENT_SOUND_GENERATE_EPISODE_REQUIRED')
  if (!soundEffectModel) throw new Error('AMBIENT_SOUND_GENERATE_SOUND_EFFECT_MODEL_REQUIRED')
  if (!approvedDesignSignature || !approvedTimelineSignature) throw new Error('AMBIENT_SOUND_APPROVED_DESIGN_REQUIRED')
  if (job.data.operationId !== 'generate_episode_ambient_sound' || !job.data.approvalGrantId || !job.data.operationExecutionId) {
    throw new Error('AMBIENT_SOUND_BILLABLE_MEDIA_APPROVAL_REQUIRED')
  }
  const approvedDesign = parseAudioDesignStrict(payload.audioDesign)
  if (approvedDesign.ambienceSources.length === 0) throw new Error('AMBIENT_SOUND_GENERATE_NOT_REQUIRED')

  const completed = await prisma.projectEditAmbientSound.findFirst({
    where: { episodeId, taskId: job.data.taskId, status: AMBIENT_SOUND_STATUS.COMPLETED },
    select: { status: true, mixJson: true },
  })
  const completedMix = readCompletedAmbientSoundMix(completed)
  if (completedMix) {
    const mix = completedMix
    return { episodeId, mediaId: mix.mediaId, audioUrl: mix.url, storageKey: mix.storageKey, soundEffectModel, durationMs: mix.durationMs }
  }

  await reportTaskProgress(job, 10, { stage: 'ambient_sound_generate_sources' })
  const [persistedDesignRow, clips, existingAmbient] = await Promise.all([
    prisma.projectEditAudioDesign.findUnique({
      where: { episodeId },
      select: { status: true, designJson: true, designSignature: true, timelineSignature: true, musicModel: true, soundEffectModel: true },
    }),
    loadEpisodeChapterOutputClips({ episodeId, projectId: job.data.projectId }),
    prisma.projectEditAmbientSound.findUnique({ where: { episodeId }, select: { taskId: true, sourcesJson: true } }),
  ])
  if (persistedDesignRow?.status !== 'planned') throw new Error('AUDIO_DESIGN_PLAN_REQUIRED')
  const persistedDesign = parseAudioDesignStrict(persistedDesignRow.designJson)
  const computedSignature = buildAudioDesignSignature({
    design: approvedDesign,
    timelineSignature: approvedTimelineSignature,
    musicModel: text(persistedDesignRow.musicModel),
    soundEffectModel,
  })
  if (computedSignature !== approvedDesignSignature || persistedDesignRow.designSignature !== approvedDesignSignature) {
    throw new Error('AMBIENT_SOUND_APPROVED_DESIGN_STALE')
  }
  if (JSON.stringify(persistedDesign) !== JSON.stringify(approvedDesign) || persistedDesignRow.soundEffectModel !== soundEffectModel) {
    throw new Error('AMBIENT_SOUND_APPROVED_DESIGN_MISMATCH')
  }
  const currentTimelineSignature = buildAudioDesignTimelineSignature(clips)
  if (currentTimelineSignature !== approvedTimelineSignature || persistedDesignRow.timelineSignature !== approvedTimelineSignature) {
    throw new Error(`AMBIENT_SOUND_TIMELINE_STALE:${approvedTimelineSignature}:${currentTimelineSignature}`)
  }

  const reusable = existingAmbient?.taskId === job.data.taskId ? readAssets(existingAmbient.sourcesJson) : []
  await prisma.projectEditAmbientSound.upsert({
    where: { episodeId },
    create: {
      episodeId,
      sourcesJson: reusable as unknown as Prisma.InputJsonValue,
      mixJson: Prisma.JsonNull,
      diagnosticsJson: Prisma.JsonNull,
      status: AMBIENT_SOUND_STATUS.GENERATING,
      taskId: job.data.taskId,
      timelineSignature: approvedTimelineSignature,
      designSignature: approvedDesignSignature,
      soundEffectModel,
    },
    update: {
      sourcesJson: reusable as unknown as Prisma.InputJsonValue,
      mixJson: Prisma.JsonNull,
      diagnosticsJson: Prisma.JsonNull,
      status: AMBIENT_SOUND_STATUS.GENERATING,
      taskId: job.data.taskId,
      timelineSignature: approvedTimelineSignature,
      designSignature: approvedDesignSignature,
      soundEffectModel,
    },
  })

  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-ambience-candidates-'))
  try {
    const assets = [...reusable]
    for (const [sourceIndex, source] of approvedDesign.ambienceSources.entries()) {
      const sourceCandidates = assets.filter((asset) => asset.sourceId === source.sourceId)
      for (const candidateIndex of [0, 1] as const) {
        if (sourceCandidates.some((candidate) => candidate.candidateIndex === candidateIndex)) continue
        const generated = await generateSoundEffect(job.data.userId, soundEffectModel, [
          source.generationPrompt,
          `Candidate variation ${candidateIndex + 1}: preserve the same environmental identity and loopability while varying only microscopic texture.`,
        ].join('\n'), {
          durationSeconds: source.loopDurationSeconds,
          loop: source.playbackType === 'seamless_loop',
          promptInfluence: source.promptInfluence,
          outputFormat: AMBIENT_SOUND_OUTPUT_FORMAT,
        }, { key: `ambient-sound:${source.sourceId}:candidate:${candidateIndex}` })
        if (!generated.success) throw new Error(generated.error || `AMBIENT_SOUND_PROVIDER_FAILED:${source.sourceId}`)
        const audio = await loadGeneratedAudioBuffer({ audioBase64: generated.audioBase64, audioUrl: generated.audioUrl, mimeType: generated.audioMimeType })
        const samples = await decodeMonoFloat32({ workspaceDir, fileName: `${source.sourceId}-${candidateIndex}`, audio })
        const boundary = measureAmbienceLoopBoundary({
          samples,
          sampleRate: approvedDesign.clock.sampleRate,
          analysisWindowSeconds: Math.min(1, Math.max(0.05, source.crossfadeFrames / approvedDesign.clock.fps)),
        })
        const quality = measureAmbienceCandidateQuality({
          samples,
          sampleRate: approvedDesign.clock.sampleRate,
          targetSalience: source.salience,
          maximumTransientRate: source.role === 'bed' ? 4 : source.role === 'detail' ? 10 : 24,
          boundaryScore: boundary.boundaryScore,
        })
        const uploaded = await uploadTaskAudioArtifact({
          audio,
          durationSeconds: samples.length / approvedDesign.clock.sampleRate,
          taskId: job.data.taskId,
          artifact: `ambient-sound:${source.sourceId}:candidate:${candidateIndex}`,
        })
        const asset: AmbientSoundSourceAsset = {
          ...uploaded,
          sourceId: source.sourceId,
          sourceContinuityId: source.sourceContinuityId,
          candidateIndex,
          selected: false,
          prompt: source.generationPrompt,
          loopDurationSeconds: source.loopDurationSeconds,
          promptInfluence: source.promptInfluence,
          soundEffectModel,
          range: source.range,
          loop: source.playbackType === 'seamless_loop',
          crossfadeFrames: source.crossfadeFrames,
          phaseOffsetFrames: source.phaseOffsetFrames,
          boundaryScore: boundary.boundaryScore,
          quality,
        }
        assets.push(asset)
        sourceCandidates.push(asset)
        await persistAssets({ episodeId, taskId: job.data.taskId, designSignature: approvedDesignSignature, assets })
        await reportTaskProgress(job, 15 + Math.round(((sourceIndex * 2 + candidateIndex + 1) / (approvedDesign.ambienceSources.length * 2)) * 45), {
          stage: 'ambient_sound_generate_sources', sourceId: source.sourceId, candidateIndex, candidateCount: 2,
        })
      }
      const ordered = sourceCandidates.sort((left, right) => left.candidateIndex - right.candidateIndex)
      const selectedIndex = selectBestAmbienceCandidate(ordered)
      const selected = ordered[selectedIndex]
      if (!selected) throw new Error(`AMBIENT_SOUND_SELECTED_CANDIDATE_MISSING:${source.sourceId}`)
      if (source.playbackType === 'seamless_loop') {
        const selectedAudio = { buffer: await getObjectBuffer(selected.storageKey), mimeType: selected.mimeType }
        const samples = await decodeMonoFloat32({ workspaceDir, fileName: `${source.sourceId}-selected`, audio: selectedAudio })
        assertAmbienceLoopBoundaryQuality(measureAmbienceLoopBoundary({ samples, sampleRate: approvedDesign.clock.sampleRate }))
      }
      assets.forEach((asset) => {
        if (asset.sourceId === source.sourceId) (asset as { selected: boolean }).selected = asset.candidateIndex === selected.candidateIndex
      })
      await persistAssets({ episodeId, taskId: job.data.taskId, designSignature: approvedDesignSignature, assets })
    }

    const selectedAssets = assets.filter((asset) => asset.selected)
    if (selectedAssets.length !== approvedDesign.ambienceSources.length) throw new Error('AMBIENT_SOUND_SELECTED_SOURCE_COUNT_INVALID')
    const tracks: AudioDesignAmbienceTrack[] = []
    for (const source of approvedDesign.ambienceSources) {
      const asset = selectedAssets.find((candidate) => candidate.sourceId === source.sourceId)
      const world = approvedDesign.soundWorlds.find((candidate) => candidate.worldId === source.worldId)
      if (!asset || !world) throw new Error(`AMBIENT_SOUND_TRACK_FACTS_MISSING:${source.sourceId}`)
      const sourcePath = path.join(workspaceDir, `${source.sourceId}.${extensionFromAudioMimeType(asset.mimeType)}`)
      await writeFile(sourcePath, await getObjectBuffer(asset.storageKey))
      tracks.push({
        source,
        path: sourcePath,
        perspectives: world.perspectives,
        transitions: approvedDesign.acousticTransitions.filter((transition) => transition.sourceContinuityId === source.sourceContinuityId),
      })
    }
    await reportTaskProgress(job, 70, { stage: 'ambient_sound_mix' })
    const mixPath = path.join(workspaceDir, 'ambient-sound-mix.wav')
    const boundaryFrames = await renderAudioDesignAmbienceMix({ runCommand, design: approvedDesign, tracks, outputPath: mixPath })
    const mixAudio = { buffer: await readFile(mixPath), mimeType: 'audio/wav' }
    const mixSamples = await decodeMonoFloat32({ workspaceDir, fileName: 'ambient-mix-qc', audio: mixAudio })
    assertAmbienceContinuity({ measurements: measureAmbienceContinuity({ samples: mixSamples, clock: approvedDesign.clock, boundaryFrames }) })
    const durationSeconds = approvedDesign.clock.totalFrames / approvedDesign.clock.fps
    const uploaded = await uploadTaskAudioArtifact({ audio: mixAudio, durationSeconds, taskId: job.data.taskId, artifact: 'ambient-sound:mix' })
    const mix = asMix(uploaded)
    const completedUpdate = await prisma.projectEditAmbientSound.updateMany({
      where: {
        episodeId,
        taskId: job.data.taskId,
        designSignature: approvedDesignSignature,
        status: AMBIENT_SOUND_STATUS.GENERATING,
      },
      data: { sourcesJson: assets as unknown as Prisma.InputJsonValue, mixJson: mix as unknown as Prisma.InputJsonValue, status: AMBIENT_SOUND_STATUS.COMPLETED },
    })
    if (completedUpdate.count !== 1) throw new Error(`AMBIENT_SOUND_OWNER_FENCE_REJECTED:${episodeId}:${job.data.taskId}`)
    await reportTaskProgress(job, 95, { stage: 'ambient_sound_persist' })
    return { episodeId, mediaId: mix.mediaId, audioUrl: mix.url, storageKey: mix.storageKey, soundEffectModel, durationMs: mix.durationMs, sourceCount: approvedDesign.ambienceSources.length, candidateCount: assets.length }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
