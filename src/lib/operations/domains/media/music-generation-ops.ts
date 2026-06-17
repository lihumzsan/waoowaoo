import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'

const vocalModeSchema = z.enum(['instrumental', 'vocal'])
const outputFormatSchema = z.enum(['mp3', 'wav'])

const musicGenerationInputSchema = z.object({
  confirmed: z.boolean().optional(),
  musicModel: z.string().min(1).optional(),
  prompt: z.string().min(1),
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: vocalModeSchema.optional(),
  genre: z.string().min(1).optional(),
  mood: z.string().min(1).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  outputFormat: outputFormatSchema.optional(),
}).passthrough()

type MusicGenerationInput = z.infer<typeof musicGenerationInputSchema>

const bgmScoreGenerationInputSchema = z.object({
  confirmed: z.boolean().optional(),
  episodeId: z.string().min(1),
  musicModel: z.string().min(1).optional(),
  outputFormat: outputFormatSchema.optional(),
}).passthrough()

type BgmScoreGenerationInput = z.infer<typeof bgmScoreGenerationInputSchema>

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function requireModelKey(value: string): string {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) throw new Error('PROJECT_AGENT_MUSIC_MODEL_KEY_INVALID')
  return parsed.modelKey
}

function isCloudDeployment(): boolean {
  return getDeploymentConfig().edition === 'cloud'
}

function assertCloudMusicModelInput(requested: string, systemModel: string): void {
  if (!requested || requested === systemModel) return
  throw new ApiError('FORBIDDEN', {
    code: 'TASK_MODEL_MANAGED_BY_PLATFORM',
    field: 'musicModel',
  })
}

function resolveCloudMusicOption(
  field: 'durationSeconds' | 'outputFormat',
  requested: string | number | undefined,
): string | number | undefined {
  const plan = getPlatformRuntimePlan('music')
  const platformValue = plan.generationOptions[field]
  if (platformValue === undefined) return requested

  if (field === 'durationSeconds') {
    if (typeof platformValue !== 'number') {
      throw new Error('PLATFORM_RUNTIME_MUSIC_DURATION_INVALID')
    }
    if (requested !== undefined && requested !== platformValue) {
      throw new ApiError('FORBIDDEN', {
        code: 'TASK_OPTIONS_MANAGED_BY_PLATFORM',
        field,
      })
    }
    return platformValue
  }

  if (typeof platformValue !== 'string') {
    throw new Error('PLATFORM_RUNTIME_MUSIC_OUTPUT_FORMAT_INVALID')
  }
  if (requested !== undefined && requested !== platformValue) {
    throw new ApiError('FORBIDDEN', {
      code: 'TASK_OPTIONS_MANAGED_BY_PLATFORM',
      field,
    })
  }
  return platformValue
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20)
}

async function resolveMusicModel(input: MusicGenerationInput, projectId: string, userId: string): Promise<string> {
  const requested = normalizeString(input.musicModel)
  if (isCloudDeployment()) {
    const systemModel = await resolveSystemModelKey({ userId, projectId, purpose: 'music' })
    assertCloudMusicModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const [project, pref] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { musicModel: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId },
      select: { musicModel: true },
    }),
  ])
  const configured = normalizeString(project?.musicModel) || normalizeString(pref?.musicModel)
  if (!configured) throw new Error('PROJECT_AGENT_MUSIC_MODEL_REQUIRED')
  return requireModelKey(configured)
}

async function resolveBgmScoreMusicModel(input: BgmScoreGenerationInput, projectId: string, userId: string): Promise<string> {
  const requested = normalizeString(input.musicModel)
  if (isCloudDeployment()) {
    const systemModel = await resolveSystemModelKey({ userId, projectId, purpose: 'music' })
    assertCloudMusicModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const [project, pref] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { musicModel: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId },
      select: { musicModel: true },
    }),
  ])
  const configured = normalizeString(project?.musicModel) || normalizeString(pref?.musicModel)
  if (!configured) throw new Error('PROJECT_AGENT_BGM_SCORE_MUSIC_MODEL_REQUIRED')
  return requireModelKey(configured)
}

async function resolveBgmScoreEpisodeDurationSeconds(episodeId: string, projectId: string): Promise<number> {
  const episode = await prisma.projectEpisode.findFirst({
    where: { id: episodeId, projectId },
    select: {
      id: true,
      editScript: {
        select: { durationSec: true },
      },
    },
  })
  if (!episode) throw new Error('PROJECT_AGENT_EPISODE_NOT_FOUND')
  const duration = episode.editScript?.durationSec
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('PROJECT_AGENT_BGM_SCORE_EDIT_SCRIPT_REQUIRED')
  }
  return Math.max(1, Math.ceil(duration))
}

export function createMusicGenerationOperations(): ProjectAgentOperationRegistryDraft {
  const taskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      musicModel: z.string().min(1),
    }).passthrough(),
  )

  return {
    generate_project_music: defineOperation({
      id: 'generate_project_music',
      summary: 'Generate a project music asset using the configured music provider (async task submission).',
      intent: 'act',
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将生成音乐/配乐资产（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: musicGenerationInputSchema,
      outputSchema: taskSubmitOutput,
      execute: async (ctx, input) => {
        const musicModel = await resolveMusicModel(input, ctx.projectId, ctx.userId)
        const episodeId = normalizeString(input.episodeId) || null
        const durationSeconds = isCloudDeployment()
          ? Number(resolveCloudMusicOption('durationSeconds', input.durationSeconds))
          : input.durationSeconds
        const outputFormat = isCloudDeployment()
          ? resolveCloudMusicOption('outputFormat', input.outputFormat)
          : input.outputFormat
        const payload: Record<string, unknown> = {
          prompt: input.prompt.trim(),
          durationSeconds,
          musicModel,
          ...(input.vocalMode ? { vocalMode: input.vocalMode } : {}),
          ...(input.genre ? { genre: input.genre.trim() } : {}),
          ...(input.mood ? { mood: input.mood.trim() } : {}),
          ...(typeof input.bpm === 'number' ? { bpm: input.bpm } : {}),
          ...(typeof outputFormat === 'string' ? { outputFormat } : {}),
        }

        const result = await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.MUSIC_GENERATE,
          targetType: 'Project',
          targetId: ctx.projectId,
          operationId: 'generate_project_music',
          source: ctx.source,
          confirmed: input.confirmed === true,
          payload,
          dedupeKey: `music_generate:${ctx.projectId}:${hashPayload(payload)}`,
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_project_music',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId,
          taskType: TASK_TYPE.MUSIC_GENERATE,
          targetType: 'Project',
          targetId: ctx.projectId,
        })

        return {
          ...result,
          episodeId,
          musicModel,
          taskType: TASK_TYPE.MUSIC_GENERATE,
          targetType: 'Project',
          targetId: ctx.projectId,
        }
      },
    }),
    generate_episode_bgm_score: defineOperation({
      id: 'generate_episode_bgm_score',
      summary: 'Generate a continuous multi-stem BGM score for an episode after video planning is complete.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        required: true,
        summary: '将根据已完成的视频编排生成连续 BGM 多音轨工程并混成最终 BGM（可能消耗额度/产生计费）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: bgmScoreGenerationInputSchema,
      outputSchema: taskSubmitOutput,
      execute: async (ctx, input) => {
        const musicModel = await resolveBgmScoreMusicModel(input, ctx.projectId, ctx.userId)
        const durationSeconds = await resolveBgmScoreEpisodeDurationSeconds(input.episodeId, ctx.projectId)
        const outputFormat = isCloudDeployment()
          ? resolveCloudMusicOption('outputFormat', input.outputFormat)
          : input.outputFormat
        const payload: Record<string, unknown> = {
          episodeId: input.episodeId,
          durationSeconds,
          musicModel,
          ...(typeof outputFormat === 'string' ? { outputFormat } : {}),
        }

        const result = await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          episodeId: input.episodeId,
          type: TASK_TYPE.BGM_SCORE_GENERATE,
          targetType: 'ProjectEpisode',
          targetId: input.episodeId,
          operationId: 'generate_episode_bgm_score',
          source: ctx.source,
          confirmed: input.confirmed === true,
          payload,
          dedupeKey: `bgm_score_generate:${ctx.projectId}:${input.episodeId}:${hashPayload(payload)}`,
        })

        writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
          operationId: 'generate_episode_bgm_score',
          taskId: result.taskId,
          status: result.status,
          runId: result.runId || null,
          deduped: result.deduped,
          projectId: ctx.projectId,
          episodeId: input.episodeId,
          taskType: TASK_TYPE.BGM_SCORE_GENERATE,
          targetType: 'ProjectEpisode',
          targetId: input.episodeId,
        })

        return {
          ...result,
          musicModel,
          taskType: TASK_TYPE.BGM_SCORE_GENERATE,
          targetType: 'ProjectEpisode',
          targetId: input.episodeId,
        }
      },
    }),
  }
}
