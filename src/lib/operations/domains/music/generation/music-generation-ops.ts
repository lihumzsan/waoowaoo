import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { TaskSubmittedPartData } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA } from '@/lib/project-workflow/edit-first-tool-input-schema'
import { getEditFirstOperationApprovalKind } from '@/lib/project-workflow/edit-first-operation-policy'
import { ApiError } from '@/lib/api-errors'
import { isCloudDeployment, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  assertOperationPlanConfirmedCost,
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  resolveConfirmedMaxCostForExecution,
  submitPlannedOperationTask,
  type OperationPlan,
} from '@/lib/operations/planning'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { SOUNDSCAPE_OUTPUT_FORMAT } from '@/lib/soundscape/types'
import {
  buildSoundscapePlanFingerprint,
  parseSoundscapePlanStrict,
} from '@/lib/soundscape/plan-contract'
import { buildSoundscapeTimelineSignature } from '@/lib/soundscape/timeline'

const vocalModeSchema = z.enum(['instrumental', 'vocal'])
const outputFormatSchema = z.enum(['mp3', 'wav'])

const musicGenerationInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
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
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  musicModel: z.string().min(1).optional(),
  outputFormat: outputFormatSchema.optional(),
}).passthrough()

type BgmScoreGenerationInput = z.infer<typeof bgmScoreGenerationInputSchema>

const soundscapePlanningInputSchema = z.object({
  episodeId: z.string().min(1).optional(),
  soundEffectModel: z.string().min(1).optional(),
}).passthrough()

type SoundscapePlanningInput = z.infer<typeof soundscapePlanningInputSchema>

const soundscapeGenerationInputSchema = z.object({
  confirmed: z.boolean().optional(),
  confirmedMaxCost: z.number().nonnegative().optional(),
  episodeId: z.string().min(1).optional(),
  soundEffectModel: z.string().min(1).optional(),
}).passthrough()

type SoundscapeGenerationInput = z.infer<typeof soundscapeGenerationInputSchema>

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function requireModelKey(value: string): string {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) throw new Error('PROJECT_AGENT_MUSIC_MODEL_KEY_INVALID')
  return parsed.modelKey
}

function assertPlatformMusicModelInput(requested: string, systemModel: string): void {
  if (!requested || requested === systemModel) return
  throw new ApiError('FORBIDDEN', {
    code: 'TASK_MODEL_MANAGED_BY_PLATFORM',
    field: 'musicModel',
  })
}

function assertPlatformSoundEffectModelInput(requested: string, systemModel: string): void {
  if (!requested || requested === systemModel) return
  throw new ApiError('FORBIDDEN', {
    code: 'TASK_MODEL_MANAGED_BY_PLATFORM',
    field: 'soundEffectModel',
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
  if (isPlatformProviderCredentialMode()) {
    const systemModel = await resolveSystemModelKey({ userId, projectId, purpose: 'music' })
    assertPlatformMusicModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const configured = normalizeString(projectModelConfig.musicModel)
  if (!configured) throw new Error('PROJECT_AGENT_MUSIC_MODEL_REQUIRED')
  return requireModelKey(configured)
}

async function resolveBgmScoreMusicModel(input: BgmScoreGenerationInput, projectId: string, userId: string): Promise<string> {
  const requested = normalizeString(input.musicModel)
  if (isPlatformProviderCredentialMode()) {
    const systemModel = await resolveSystemModelKey({ userId, projectId, purpose: 'music' })
    assertPlatformMusicModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const configured = normalizeString(projectModelConfig.musicModel)
  if (!configured) throw new Error('PROJECT_AGENT_BGM_SCORE_MUSIC_MODEL_REQUIRED')
  return requireModelKey(configured)
}

async function resolveSoundscapeSoundEffectModel(
  input: SoundscapePlanningInput | SoundscapeGenerationInput,
  projectId: string,
  userId: string,
): Promise<string> {
  const requested = normalizeString(input.soundEffectModel)
  if (isPlatformProviderCredentialMode()) {
    const systemModel = await resolveSystemModelKey({ userId, projectId, purpose: 'sound-effect' })
    assertPlatformSoundEffectModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const configured = normalizeString(projectModelConfig.soundEffectModel)
  if (!configured) throw new Error('PROJECT_AGENT_SOUNDSCAPE_SOUND_EFFECT_MODEL_REQUIRED')
  return requireModelKey(configured)
}

async function resolveBgmScoreEpisodeDurationSeconds(episodeId: string, projectId: string): Promise<number> {
  const episode = await prisma.projectEpisode.findFirst({
    where: { id: episodeId, projectId },
    select: { id: true },
  })
  if (!episode) throw new Error('PROJECT_AGENT_EPISODE_NOT_FOUND')
  const clips = await loadEpisodeChapterOutputClips({
    episodeId,
    projectId,
  })
  const duration = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('PROJECT_AGENT_MUSIC_SCORE_TIMELINE_REQUIRED')
  return Math.max(1, Math.ceil(duration))
}

async function resolveAnalysisModel(projectId: string, userId: string): Promise<string> {
  if (isPlatformProviderCredentialMode()) {
    return await resolveSystemModelKey({ userId, projectId, purpose: 'analysis' })
  }
  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const analysisModel = normalizeString(projectModelConfig.analysisModel)
  if (!analysisModel) throw new Error('PROJECT_AGENT_ANALYSIS_MODEL_REQUIRED')
  return requireModelKey(analysisModel)
}

async function planGenerateProjectMusicOperation(
  ctx: ProjectAgentOperationContext,
  input: MusicGenerationInput,
): Promise<OperationPlan> {
  const musicModel = await resolveMusicModel(input, ctx.projectId, ctx.userId)
  const episodeId = normalizeString((input as Record<string, unknown>).episodeId) || null
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

  return {
    kind: 'task_submission',
    operationId: 'generate_project_music',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `generate_project_music:${ctx.projectId}`,
        taskType: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: ctx.projectId,
        payload,
        locale: resolveRequiredTaskLocale(ctx.request, payload),
        episodeId,
        dedupeKey: `music_generate:${ctx.projectId}:${hashPayload(payload)}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.MUSIC_GENERATE,
          payload,
          allowedApiTypes: ['music'],
        }),
      }),
    ],
    metadata: {
      episodeId,
      musicModel,
    },
  }
}

async function commitGenerateProjectMusicOperation(
  ctx: ProjectAgentOperationContext,
  input: MusicGenerationInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const musicModel = typeof plan.metadata?.musicModel === 'string'
    ? plan.metadata.musicModel
    : ''
  const episodeId = typeof plan.metadata?.episodeId === 'string'
    ? plan.metadata.episodeId
    : null
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_project_music',
    confirmed: input.confirmed === true,
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'generate_project_music',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
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
}

async function planGenerateEpisodeBgmScoreOperation(
  ctx: ProjectAgentOperationContext,
  input: BgmScoreGenerationInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const musicModel = await resolveBgmScoreMusicModel(input, ctx.projectId, ctx.userId)
  const durationSeconds = await resolveBgmScoreEpisodeDurationSeconds(episodeId, ctx.projectId)
  const outputFormat = isCloudDeployment()
    ? resolveCloudMusicOption('outputFormat', input.outputFormat)
    : input.outputFormat
  const payload: Record<string, unknown> = {
    episodeId,
    durationSeconds,
    musicModel,
    ...(typeof outputFormat === 'string' ? { outputFormat } : {}),
  }

  return {
    kind: 'task_submission',
    operationId: 'generate_episode_bgm_score',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `generate_episode_bgm_score:${episodeId}`,
        taskType: TASK_TYPE.MUSIC_SCORE_PLAN,
        targetType: 'ProjectEpisode',
        targetId: episodeId,
        payload,
        locale: resolveRequiredTaskLocale(ctx.request, payload),
        episodeId,
        dedupeKey: `music_score_plan:${ctx.projectId}:${episodeId}:${hashPayload(payload)}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.MUSIC_SCORE_PLAN,
          payload,
          allowedApiTypes: ['music'],
        }),
      }),
    ],
    metadata: {
      episodeId,
      musicModel,
    },
  }
}

async function planEpisodeSoundscapeOperation(
  ctx: ProjectAgentOperationContext,
  input: SoundscapePlanningInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const soundEffectModel = await resolveSoundscapeSoundEffectModel(input, ctx.projectId, ctx.userId)
  const analysisModel = await resolveAnalysisModel(ctx.projectId, ctx.userId)
  const durationSeconds = await resolveBgmScoreEpisodeDurationSeconds(episodeId, ctx.projectId)
  const payload: Record<string, unknown> = {
    episodeId,
    durationSeconds,
    soundEffectModel,
    analysisModel,
    maxInputTokens: 5000,
  }

  return {
    kind: 'task_submission',
    operationId: 'plan_episode_soundscape',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `plan_episode_soundscape:${episodeId}`,
        taskType: TASK_TYPE.SOUNDSCAPE_PLAN,
        targetType: 'ProjectEpisode',
        targetId: episodeId,
        payload,
        locale: resolveRequiredTaskLocale(ctx.request, payload),
        episodeId,
        dedupeKey: `soundscape_plan:${ctx.projectId}:${episodeId}:${hashPayload(payload)}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.SOUNDSCAPE_PLAN,
          payload,
          allowedApiTypes: ['text'],
        }),
      }),
    ],
    metadata: {
      episodeId,
      soundEffectModel,
    },
  }
}

async function planGenerateEpisodeSoundscapeOperation(
  ctx: ProjectAgentOperationContext,
  input: SoundscapeGenerationInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const soundEffectModel = await resolveSoundscapeSoundEffectModel(input, ctx.projectId, ctx.userId)
  const soundscape = await prisma.projectEditSoundscape.findFirst({
    where: {
      episodeId,
      episode: { projectId: ctx.projectId },
    },
    select: {
      planJson: true,
      timelineSignature: true,
    },
  })
  if (!soundscape) throw new Error('SOUNDSCAPE_PLAN_REQUIRED')
  const plan = parseSoundscapePlanStrict(soundscape.planJson)
  if (plan.decision !== 'soundscape') {
    throw new Error(`SOUNDSCAPE_GENERATE_NOT_REQUIRED:${plan.decision}`)
  }
  const timelineSignature = normalizeString(soundscape.timelineSignature)
  if (!timelineSignature) throw new Error('SOUNDSCAPE_TIMELINE_SIGNATURE_REQUIRED')
  const clips = await loadEpisodeChapterOutputClips({ episodeId, projectId: ctx.projectId })
  const currentTimelineSignature = buildSoundscapeTimelineSignature(clips)
  if (currentTimelineSignature !== timelineSignature) {
    throw new Error(`SOUNDSCAPE_TIMELINE_STALE:${timelineSignature}:${currentTimelineSignature}`)
  }
  const durationSeconds = plan.sources.reduce((total, source) => total + source.loopDurationSeconds, 0)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('SOUNDSCAPE_SOURCE_DURATION_REQUIRED')
  }
  const soundscapePlanHash = buildSoundscapePlanFingerprint({
    plan,
    timelineSignature,
    soundEffectModel,
  })
  const payload: Record<string, unknown> = {
    episodeId,
    soundEffectModel,
    soundscapePlan: plan,
    soundscapePlanHash,
    timelineSignature,
    durationSeconds,
    sourceCount: plan.sources.length,
    loop: true,
    outputFormat: SOUNDSCAPE_OUTPUT_FORMAT,
  }

  return {
    kind: 'task_submission',
    operationId: 'generate_episode_soundscape',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `generate_episode_soundscape:${episodeId}:${soundscapePlanHash}`,
        taskType: TASK_TYPE.SOUNDSCAPE_GENERATE,
        targetType: 'ProjectEpisode',
        targetId: episodeId,
        payload,
        locale: resolveRequiredTaskLocale(ctx.request, payload),
        episodeId,
        dedupeKey: `soundscape_generate:${ctx.projectId}:${episodeId}:${soundscapePlanHash}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.SOUNDSCAPE_GENERATE,
          payload,
          allowedApiTypes: ['sound_effect'],
        }),
      }),
    ],
    metadata: {
      episodeId,
      soundEffectModel,
      soundscapePlanHash,
    },
  }
}

async function commitGenerateEpisodeBgmScoreOperation(
  ctx: ProjectAgentOperationContext,
  input: BgmScoreGenerationInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const musicModel = typeof plan.metadata?.musicModel === 'string'
    ? plan.metadata.musicModel
    : ''
  const episodeId = (typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : '')
    || normalizeString(input.episodeId)
    || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_episode_bgm_score',
    confirmed: input.confirmed === true,
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'generate_episode_bgm_score',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    projectId: ctx.projectId,
    episodeId,
    taskType: TASK_TYPE.MUSIC_SCORE_PLAN,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  })

  return {
    ...result,
    musicModel,
    taskType: TASK_TYPE.MUSIC_SCORE_PLAN,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  }
}

async function commitPlanEpisodeSoundscapeOperation(
  ctx: ProjectAgentOperationContext,
  input: SoundscapePlanningInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const soundEffectModel = typeof plan.metadata?.soundEffectModel === 'string'
    ? plan.metadata.soundEffectModel
    : ''
  const episodeId = (typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : '')
    || normalizeString(input.episodeId)
    || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'plan_episode_soundscape',
    confirmed: false,
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'plan_episode_soundscape',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    projectId: ctx.projectId,
    episodeId,
    taskType: TASK_TYPE.SOUNDSCAPE_PLAN,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  })

  return {
    ...result,
    soundEffectModel,
    taskType: TASK_TYPE.SOUNDSCAPE_PLAN,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  }
}

async function commitGenerateEpisodeSoundscapeOperation(
  ctx: ProjectAgentOperationContext,
  input: SoundscapeGenerationInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const soundEffectModel = typeof plan.metadata?.soundEffectModel === 'string'
    ? plan.metadata.soundEffectModel
    : ''
  const episodeId = (typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : '')
    || normalizeString(input.episodeId)
    || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_episode_soundscape',
    confirmed: input.confirmed === true,
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'generate_episode_soundscape',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    projectId: ctx.projectId,
    episodeId,
    taskType: TASK_TYPE.SOUNDSCAPE_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  })

  return {
    ...result,
    soundEffectModel,
    taskType: TASK_TYPE.SOUNDSCAPE_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  }
}

export function createMusicGenerationOperations(): ProjectAgentOperationRegistryDraft {
  const musicTaskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      musicModel: z.string().min(1),
    }).passthrough(),
  )
  const soundscapeTaskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase.extend({
      soundEffectModel: z.string().min(1),
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
        kind: 'billable_media',
        required: true,
        summary: '将按当前集的配乐计划提交付费音乐生成任务。',
      },
      inputSchema: musicGenerationInputSchema,
      outputSchema: musicTaskSubmitOutput,
      plan: async (ctx, input) => planGenerateProjectMusicOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateProjectMusicOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateProjectMusicOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitGenerateProjectMusicOperation(ctx, input, plan)
      },
    }),
    generate_episode_bgm_score: defineOperation({
      id: 'generate_episode_bgm_score',
      summary: 'Generate the episode music score from rendered chapter outputs.',
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
        kind: getEditFirstOperationApprovalKind('generate_episode_bgm_score'),
        required: true,
        summary: '将按当前集的声场计划提交付费环境音生成任务。',
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: bgmScoreGenerationInputSchema,
      outputSchema: musicTaskSubmitOutput,
      plan: async (ctx, input) => planGenerateEpisodeBgmScoreOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateEpisodeBgmScoreOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateEpisodeBgmScoreOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitGenerateEpisodeBgmScoreOperation(ctx, input, plan)
      },
    }),
    plan_episode_soundscape: defineOperation({
      id: 'plan_episode_soundscape',
      summary: 'Plan the episode soundscape from rendered chapter outputs without submitting paid sound effects.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: getEditFirstOperationApprovalKind('plan_episode_soundscape'),
        required: false,
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: soundscapePlanningInputSchema,
      outputSchema: soundscapeTaskSubmitOutput,
      plan: async (ctx, input) => planEpisodeSoundscapeOperation(ctx, input),
      commit: async (ctx, input, plan) => commitPlanEpisodeSoundscapeOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planEpisodeSoundscapeOperation(ctx, input)
        return await commitPlanEpisodeSoundscapeOperation(ctx, input, plan)
      },
    }),
    generate_episode_soundscape: defineOperation({
      id: 'generate_episode_soundscape',
      summary: 'Generate the exact approved episode soundscape plan using the configured paid sound-effect provider.',
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
        kind: getEditFirstOperationApprovalKind('generate_episode_soundscape'),
        required: true,
        summary: '将按当前集的声场计划提交付费环境音生成任务。',
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: soundscapeGenerationInputSchema,
      outputSchema: soundscapeTaskSubmitOutput,
      plan: async (ctx, input) => planGenerateEpisodeSoundscapeOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateEpisodeSoundscapeOperation(ctx, input, plan),
      execute: async (ctx, input) => {
        const plan = await planGenerateEpisodeSoundscapeOperation(ctx, input)
        await assertOperationPlanConfirmedCost({
          plan,
          confirmedMaxCost: await resolveConfirmedMaxCostForExecution({ ctx, input, plan }),
        })
        return await commitGenerateEpisodeSoundscapeOperation(ctx, input, plan)
      },
    }),
  }
}
