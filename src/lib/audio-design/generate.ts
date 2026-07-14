import type { Job } from 'bullmq'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'
import { reportTaskProgress } from '@/lib/workers/shared'
import { compileSoundPresenceAutomation } from './automation'
import { buildAudioDesignSignature, buildAudioDesignTimelineSignature, parseAudioDesignStrict } from './contract'
import { assertAudioDesignUsesScriptBoundaries, loadAudioDesignPlanningInput } from './planning-input'
import { buildAudioDesignPlanPrompt } from './prompt'
import { claimAudioDesignPlanning, completeAudioDesignPlanning, readPersistedAudioDesign } from './project-data'
import { resolveScoreProviderDurationSeconds } from './score-duration'
import { audioDesignSchema } from './types'

type AudioDesignPlanPayload = {
  readonly episodeId?: unknown
  readonly analysisModel?: unknown
  readonly musicModel?: unknown
  readonly soundEffectModel?: unknown
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleAudioDesignPlanTask(job: Job<TaskJobData>): Promise<Record<string, unknown>> {
  const payload = (job.data.payload ?? {}) as AudioDesignPlanPayload
  const episodeId = string(payload.episodeId) || string(job.data.episodeId)
  const analysisModel = string(payload.analysisModel)
  const musicModel = string(payload.musicModel)
  const soundEffectModel = string(payload.soundEffectModel)
  if (!episodeId) throw new Error('AUDIO_DESIGN_EPISODE_REQUIRED')
  if (!analysisModel) throw new Error('AUDIO_DESIGN_ANALYSIS_MODEL_REQUIRED')
  if (!musicModel) throw new Error('AUDIO_DESIGN_MUSIC_MODEL_REQUIRED')
  if (!soundEffectModel) throw new Error('AUDIO_DESIGN_SOUND_EFFECT_MODEL_REQUIRED')

  const replay = await prisma.projectEditAudioDesign.findFirst({
    where: { episodeId, taskId: job.data.taskId, status: 'planned' },
    select: {
      status: true,
      designJson: true,
      timelineSignature: true,
      designSignature: true,
      analysisModel: true,
      musicModel: true,
      soundEffectModel: true,
    },
  })
  const persisted = readPersistedAudioDesign(replay)
  if (persisted) {
    return {
      episodeId,
      designSignature: persisted.designSignature,
      soundWorldCount: persisted.design.soundWorlds.length,
      ambienceSourceCount: persisted.design.ambienceSources.length,
      scoreCueCount: persisted.design.scoreCues.length,
    }
  }

  await reportTaskProgress(job, 10, { stage: 'audio_design_prepare' })
  const [episode, clips] = await Promise.all([
    prisma.projectEpisode.findFirst({ where: { id: episodeId, projectId: job.data.projectId }, select: { id: true } }),
    loadEpisodeChapterOutputClips({ episodeId, projectId: job.data.projectId }),
  ])
  if (!episode) throw new Error('AUDIO_DESIGN_EPISODE_NOT_FOUND')
  const planningInput = await loadAudioDesignPlanningInput({ episodeId, projectId: job.data.projectId, clips })
  const timelineSignature = buildAudioDesignTimelineSignature(clips)
  await claimAudioDesignPlanning({ episodeId, taskId: job.data.taskId, timelineSignature, analysisModel, musicModel, soundEffectModel })

  await reportTaskProgress(job, 30, { stage: 'audio_design_plan' })
  const streamContext = createWorkerLLMStreamContext(job, 'audio_design_plan')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const completion = await withInternalLLMStreamCallbacks(streamCallbacks, async () => {
    try {
      return await executeAiStructuredTextStep({
        userId: job.data.userId,
        model: analysisModel,
        messages: [{ role: 'user', content: buildAudioDesignPlanPrompt({ planningInput, locale: job.data.locale }) }],
        temperature: 0.25,
        projectId: job.data.projectId,
        action: 'audio_design_plan',
        locale: job.data.locale,
        meta: { stepId: 'audio_design_plan', stepTitle: 'audio_design_plan', stepIndex: 1, stepTotal: 1 },
        schema: audioDesignSchema,
        parse: { kind: 'object' },
      })
    } finally {
      await streamCallbacks.flush()
    }
  })
  assertAudioDesignUsesScriptBoundaries({
    soundWorldBoundaryFrames: planningInput.soundWorldBoundaryFrames,
    soundWorlds: completion.data.soundWorlds,
  })
  if (completion.data.scoreCues.length > 0) {
    resolveScoreProviderDurationSeconds({
      musicModel,
      targetDurationSeconds: planningInput.clock.totalFrames / planningInput.clock.fps,
    })
  }
  const reservedLaneIds = new Set(['ambience_sound_presence', 'score_sound_presence'])
  const collision = completion.data.automationLanes.find((lane) => reservedLaneIds.has(lane.laneId))
  if (collision) throw new Error(`AUDIO_AUTOMATION_RESERVED_LANE_ID:${collision.laneId}`)
  const design = parseAudioDesignStrict({
    ...completion.data,
    automationLanes: [
      ...completion.data.automationLanes,
      ...compileSoundPresenceAutomation({ presence: completion.data.soundPresence, clock: completion.data.clock }),
    ],
  })
  const designSignature = buildAudioDesignSignature({ design, timelineSignature, musicModel, soundEffectModel })
  await completeAudioDesignPlanning({ episodeId, taskId: job.data.taskId, design, designSignature })
  await reportTaskProgress(job, 95, { stage: 'audio_design_plan_persisted' })
  return {
    episodeId,
    designSignature,
    soundWorldCount: design.soundWorlds.length,
    ambienceSourceCount: design.ambienceSources.length,
    scoreCueCount: design.scoreCues.length,
  }
}
