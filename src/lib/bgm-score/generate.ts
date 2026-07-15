import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { generateMusic } from '@/lib/ai-exec/engine'
import { decodeMonoFloat32, loadGeneratedAudioBuffer, uploadTaskAudioArtifact } from '@/lib/bgm-design/audio-assets'
import { buildBgmDesignSignature, buildBgmDesignTimelineSignature, parseBgmDesignStrict } from '@/lib/bgm-design/contract'
import { buildLyriaPrompts } from '@/lib/bgm-design/lyria-prompt'
import { conformScoreDuration, resolveScoreProviderDurationSeconds } from '@/lib/bgm-design/score-duration'
import { analyzeScoreCandidate, selectScoreCandidate } from '@/lib/bgm-design/score-quality'
import { prisma } from '@/lib/prisma'
import { readCompletedMusicScoreMix } from '@/lib/music-score/project-data'
import type { TaskJobData } from '@/lib/task/types'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { reportTaskProgress } from '@/lib/workers/shared'
import { BGM_SCORE_STATUS, type BgmScoreMix, type ScoreCandidateAsset } from './types'

type Payload = {
  readonly episodeId?: unknown
  readonly musicModel?: unknown
  readonly bgmDesign?: unknown
  readonly designSignature?: unknown
  readonly timelineSignature?: unknown
  readonly timelineDurationSeconds?: unknown
  readonly durationSeconds?: unknown
  readonly outputFormat?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveNumber(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(code)
  return value
}

function outputFormat(value: unknown): 'mp3' | 'wav' {
  if (value === undefined || value === null || value === '') return 'mp3'
  if (value === 'mp3' || value === 'wav') return value
  throw new Error('BGM_SCORE_OUTPUT_FORMAT_INVALID')
}

function readCandidates(value: unknown): ScoreCandidateAsset[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const candidates = (value as Record<string, unknown>).candidates
  if (!Array.isArray(candidates)) return []
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`BGM_SCORE_CANDIDATE_INVALID:${index}`)
    return candidate as unknown as ScoreCandidateAsset
  })
}

function scoreStateJson(input: {
  readonly cue: unknown
  readonly candidates: readonly ScoreCandidateAsset[]
}): Prisma.InputJsonValue {
  return input as unknown as Prisma.InputJsonValue
}

async function persistCandidates(input: {
  readonly episodeId: string
  readonly taskId: string
  readonly designSignature: string
  readonly cue: unknown
  readonly candidates: readonly ScoreCandidateAsset[]
}): Promise<void> {
  const result = await prisma.projectEditMusicScore.updateMany({
    where: {
      episodeId: input.episodeId,
      taskId: input.taskId,
      designSignature: input.designSignature,
      status: BGM_SCORE_STATUS.GENERATING,
    },
    data: { cuesJson: scoreStateJson({ cue: input.cue, candidates: input.candidates }) },
  })
  if (result.count !== 1) throw new Error(`BGM_SCORE_OWNER_FENCE_REJECTED:${input.episodeId}:${input.taskId}`)
}

function asMix(candidate: ScoreCandidateAsset): BgmScoreMix {
  return {
    mediaId: candidate.mediaId,
    url: candidate.url,
    storageKey: candidate.storageKey,
    mimeType: candidate.mimeType,
    durationMs: candidate.durationMs,
  }
}

export async function handleBgmScoreGenerateTask(job: Job<TaskJobData>): Promise<Record<string, unknown>> {
  const payload = (job.data.payload ?? {}) as Payload
  const episodeId = text(payload.episodeId) || text(job.data.episodeId)
  const musicModel = text(payload.musicModel)
  const approvedDesignSignature = text(payload.designSignature)
  const approvedTimelineSignature = text(payload.timelineSignature)
  const timelineDurationSeconds = positiveNumber(payload.timelineDurationSeconds, 'BGM_SCORE_TIMELINE_DURATION_REQUIRED')
  const providerDurationSeconds = positiveNumber(payload.durationSeconds, 'BGM_SCORE_PROVIDER_DURATION_REQUIRED')
  if (!episodeId) throw new Error('BGM_SCORE_GENERATE_EPISODE_REQUIRED')
  if (!musicModel) throw new Error('BGM_SCORE_GENERATE_MUSIC_MODEL_REQUIRED')
  if (!approvedDesignSignature || !approvedTimelineSignature) throw new Error('BGM_SCORE_APPROVED_DESIGN_REQUIRED')
  if (job.data.operationId !== 'generate_episode_bgm_score' || !job.data.approvalGrantId || !job.data.operationExecutionId) {
    throw new Error('BGM_SCORE_BILLABLE_MEDIA_APPROVAL_REQUIRED')
  }
  const approvedDesign = parseBgmDesignStrict(payload.bgmDesign)
  const cue = approvedDesign.scoreCue
  const expectedTimelineDuration = approvedDesign.clock.totalFrames / approvedDesign.clock.fps
  if (Math.abs(expectedTimelineDuration - timelineDurationSeconds) > 0.000_001) throw new Error('BGM_SCORE_APPROVED_DURATION_INVALID')
  if (providerDurationSeconds !== resolveScoreProviderDurationSeconds({ musicModel, targetDurationSeconds: timelineDurationSeconds })) {
    throw new Error('BGM_SCORE_PROVIDER_DURATION_INVALID')
  }

  const completed = await prisma.projectEditMusicScore.findFirst({
    where: { episodeId, taskId: job.data.taskId, status: BGM_SCORE_STATUS.COMPLETED },
    select: { status: true, mixJson: true },
  })
  const completedMix = readCompletedMusicScoreMix(completed)
  if (completedMix) {
    const mix = completedMix
    return { episodeId, mediaId: mix.mediaId, audioUrl: mix.url, storageKey: mix.storageKey, musicModel, durationMs: mix.durationMs }
  }

  await reportTaskProgress(job, 10, { stage: 'bgm_score_generate_prepare' })
  const [persistedDesignRow, clips, existingScore] = await Promise.all([
    prisma.projectEditBgmDesign.findUnique({
      where: { episodeId },
      select: { status: true, designJson: true, designSignature: true, timelineSignature: true, musicModel: true },
    }),
    loadEpisodeChapterOutputClips({ episodeId, projectId: job.data.projectId }),
    prisma.projectEditMusicScore.findUnique({ where: { episodeId }, select: { taskId: true, cuesJson: true } }),
  ])
  if (persistedDesignRow?.status !== 'planned') throw new Error('BGM_DESIGN_PLAN_REQUIRED')
  const persistedDesign = parseBgmDesignStrict(persistedDesignRow.designJson)
  const computedSignature = buildBgmDesignSignature({
    design: approvedDesign,
    timelineSignature: approvedTimelineSignature,
    musicModel,
  })
  if (computedSignature !== approvedDesignSignature || persistedDesignRow.designSignature !== approvedDesignSignature) {
    throw new Error('BGM_SCORE_APPROVED_DESIGN_STALE')
  }
  if (JSON.stringify(persistedDesign) !== JSON.stringify(approvedDesign) || persistedDesignRow.musicModel !== musicModel) {
    throw new Error('BGM_SCORE_APPROVED_DESIGN_MISMATCH')
  }
  const currentTimelineSignature = buildBgmDesignTimelineSignature(clips)
  if (currentTimelineSignature !== approvedTimelineSignature || persistedDesignRow.timelineSignature !== approvedTimelineSignature) {
    throw new Error(`BGM_SCORE_TIMELINE_STALE:${approvedTimelineSignature}:${currentTimelineSignature}`)
  }

  const reusable = existingScore?.taskId === job.data.taskId ? readCandidates(existingScore.cuesJson) : []
  await prisma.projectEditMusicScore.upsert({
    where: { episodeId },
    create: {
      episodeId,
      cuesJson: scoreStateJson({ cue, candidates: reusable }),
      mixJson: Prisma.JsonNull,
      diagnosticsJson: Prisma.JsonNull,
      status: BGM_SCORE_STATUS.GENERATING,
      taskId: job.data.taskId,
      timelineSignature: approvedTimelineSignature,
      designSignature: approvedDesignSignature,
      musicModel,
    },
    update: {
      cuesJson: scoreStateJson({ cue, candidates: reusable }),
      mixJson: Prisma.JsonNull,
      diagnosticsJson: Prisma.JsonNull,
      status: BGM_SCORE_STATUS.GENERATING,
      taskId: job.data.taskId,
      timelineSignature: approvedTimelineSignature,
      designSignature: approvedDesignSignature,
      musicModel,
    },
  })

  const prompts = buildLyriaPrompts({ cue, clock: approvedDesign.clock })
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-score-candidates-'))
  try {
    const candidates = reusable.filter((candidate) => candidate.candidateIndex === 0 || candidate.candidateIndex === 1)
    for (const candidateIndex of [0, 1] as const) {
      if (candidates.some((candidate) => candidate.candidateIndex === candidateIndex)) continue
      const generated = await generateMusic(job.data.userId, musicModel, prompts.prompt, {
        negativePrompt: prompts.negativePrompt,
        durationSeconds: providerDurationSeconds,
        vocalMode: 'instrumental',
        bpm: cue.musicTheorySpec.bpm,
        outputFormat: outputFormat(payload.outputFormat),
      }, { key: `bgm-score:candidate:${candidateIndex}` })
      if (!generated.success) throw new Error(generated.error || 'BGM_SCORE_PROVIDER_FAILED')
      const sourceAudio = await loadGeneratedAudioBuffer({ audioBase64: generated.audioBase64, audioUrl: generated.audioUrl, mimeType: generated.audioMimeType })
      const sourceSamples = await decodeMonoFloat32({ workspaceDir, fileName: `score-${candidateIndex}-source`, audio: sourceAudio })
      const conformed = await conformScoreDuration({
        audio: sourceAudio,
        workspaceDir,
        fileName: `score-${candidateIndex}`,
        sourceDurationSeconds: sourceSamples.length / approvedDesign.clock.sampleRate,
        targetDurationSeconds: timelineDurationSeconds,
      })
      const samples = await decodeMonoFloat32({ workspaceDir, fileName: `score-${candidateIndex}-final`, audio: conformed.audio })
      const quality = analyzeScoreCandidate({
        samples,
        sampleRate: approvedDesign.clock.sampleRate,
        expectedDurationSeconds: timelineDurationSeconds,
        sourceDurationSeconds: conformed.conformance.sourceDurationSeconds,
        durationConformanceRatio: conformed.conformance.tempoRatio,
        spec: cue.musicTheorySpec,
      })
      const uploaded = await uploadTaskAudioArtifact({
        audio: conformed.audio,
        durationSeconds: timelineDurationSeconds,
        taskId: job.data.taskId,
        artifact: `bgm-score:candidate:${candidateIndex}`,
      })
      candidates.push({ ...uploaded, candidateIndex, selected: false, quality })
      await persistCandidates({ episodeId, taskId: job.data.taskId, designSignature: approvedDesignSignature, cue, candidates })
      await reportTaskProgress(job, 25 + (candidateIndex + 1) * 25, { stage: 'bgm_score_generate_music', candidateIndex, candidateCount: 2 })
    }
    const ordered = [...candidates].sort((left, right) => left.candidateIndex - right.candidateIndex)
    const selectedIndex = selectScoreCandidate(ordered.map((candidate) => candidate.quality))
    const selectedCandidates = ordered.map((candidate, index) => ({ ...candidate, selected: index === selectedIndex }))
    const selected = selectedCandidates[selectedIndex]
    if (!selected) throw new Error('BGM_SCORE_SELECTED_CANDIDATE_MISSING')
    await persistCandidates({ episodeId, taskId: job.data.taskId, designSignature: approvedDesignSignature, cue, candidates: selectedCandidates })
    const mix = asMix(selected)
    const completedUpdate = await prisma.projectEditMusicScore.updateMany({
      where: {
        episodeId,
        taskId: job.data.taskId,
        designSignature: approvedDesignSignature,
        status: BGM_SCORE_STATUS.GENERATING,
      },
      data: { cuesJson: scoreStateJson({ cue, candidates: selectedCandidates }), mixJson: mix as unknown as Prisma.InputJsonValue, status: BGM_SCORE_STATUS.COMPLETED },
    })
    if (completedUpdate.count !== 1) throw new Error(`BGM_SCORE_OWNER_FENCE_REJECTED:${episodeId}:${job.data.taskId}`)
    await reportTaskProgress(job, 95, { stage: 'bgm_score_persist' })
    return { episodeId, mediaId: mix.mediaId, audioUrl: mix.url, storageKey: mix.storageKey, musicModel, durationMs: mix.durationMs, candidateCount: 2, selectedCandidateIndex: selected.candidateIndex }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
