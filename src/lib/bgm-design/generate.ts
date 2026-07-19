import type { Job } from 'bullmq'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'
import { reportTaskProgress } from '@/lib/workers/shared'
import { compileBgmPresenceAutomation } from './automation'
import { buildBgmDesignSignature, buildBgmDesignTimelineSignature, parseBgmDesignStrict } from './contract'
import { loadBgmDesignPlanningInput } from './planning-input'
import { buildBgmDesignPlanPrompt } from './prompt'
import { claimBgmDesignPlanning, completeBgmDesignPlanning, readPersistedBgmDesign } from './project-data'
import { resolveScoreProviderDurationSeconds } from './score-duration'
import { bgmDesignSchema } from './types'

type BgmDesignPlanPayload = {
  readonly episodeId?: unknown
  readonly analysisModel?: unknown
  readonly musicModel?: unknown
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleBgmDesignPlanTask(job: Job<TaskJobData>): Promise<Record<string, unknown>> {
  const payload = (job.data.payload ?? {}) as BgmDesignPlanPayload
  const episodeId = string(payload.episodeId) || string(job.data.episodeId)
  const analysisModel = string(payload.analysisModel)
  const musicModel = string(payload.musicModel)
  if (!episodeId) throw new Error('BGM_DESIGN_EPISODE_REQUIRED')
  if (!analysisModel) throw new Error('BGM_DESIGN_ANALYSIS_MODEL_REQUIRED')
  if (!musicModel) throw new Error('BGM_DESIGN_MUSIC_MODEL_REQUIRED')

  const replay = await prisma.projectEditBgmDesign.findFirst({
    where: { episodeId, taskId: job.data.taskId, status: 'planned' },
    select: {
      status: true,
      designJson: true,
      timelineSignature: true,
      designSignature: true,
      analysisModel: true,
      musicModel: true,
    },
  })
  const persisted = readPersistedBgmDesign(replay)
  if (persisted) {
    return { episodeId, designSignature: persisted.designSignature, scoreCueCount: 1 }
  }

  await reportTaskProgress(job, 10, { stage: 'bgm_design_prepare' })
  const [episode, clips] = await Promise.all([
    prisma.projectEpisode.findFirst({ where: { id: episodeId, projectId: job.data.projectId }, select: { id: true } }),
    loadEpisodeChapterOutputClips({ episodeId, projectId: job.data.projectId }),
  ])
  if (!episode) throw new Error('BGM_DESIGN_EPISODE_NOT_FOUND')
  const planningInput = await loadBgmDesignPlanningInput({ episodeId, projectId: job.data.projectId, clips })
  const timelineSignature = buildBgmDesignTimelineSignature(clips)
  await claimBgmDesignPlanning({ episodeId, taskId: job.data.taskId, timelineSignature, analysisModel, musicModel })

  await reportTaskProgress(job, 30, { stage: 'bgm_design_plan' })
  const streamContext = createWorkerLLMStreamContext(job, 'bgm_design_plan')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const completion = await withInternalLLMStreamCallbacks(streamCallbacks, async () => {
    try {
      return await executeAiStructuredTextStep({
        userId: job.data.userId,
        model: analysisModel,
        messages: [{ role: 'user', content: buildBgmDesignPlanPrompt({ planningInput, locale: job.data.locale }) }],
        projectId: job.data.projectId,
        action: 'bgm_design_plan',
        locale: job.data.locale,
        meta: { stepId: 'bgm_design_plan', stepTitle: 'bgm_design_plan', stepIndex: 1, stepTotal: 1 },
        schema: bgmDesignSchema,
        parse: { kind: 'object' },
      })
    } finally {
      await streamCallbacks.flush()
    }
  })
  resolveScoreProviderDurationSeconds({
    musicModel,
    targetDurationSeconds: planningInput.clock.totalFrames / planningInput.clock.fps,
  })
  const collision = completion.data.automationLanes.find((lane) => lane.laneId === 'score_presence')
  if (collision) throw new Error(`BGM_AUTOMATION_RESERVED_LANE_ID:${collision.laneId}`)
  const design = parseBgmDesignStrict({
    ...completion.data,
    automationLanes: [
      ...completion.data.automationLanes,
      compileBgmPresenceAutomation({ presence: completion.data.scorePresence, clock: completion.data.clock }),
    ],
  })
  const designSignature = buildBgmDesignSignature({ design, timelineSignature, musicModel })
  await completeBgmDesignPlanning({ episodeId, taskId: job.data.taskId, design, designSignature })
  await reportTaskProgress(job, 95, { stage: 'bgm_design_plan_persisted' })
  return { episodeId, designSignature, scoreCueCount: 1 }
}
