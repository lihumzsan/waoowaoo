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
import { ApiError } from '@/lib/api-errors'
import { isCloudDeployment, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { createPlannedTask, requirePlannedTaskBillingInfo, submitPlannedOperationTask, type OperationPlan } from '@/lib/operations/planning'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { loadEpisodeChapterOutputClips } from '@/lib/video-compose/episode-chapter-clips'
import { AMBIENT_SOUND_OUTPUT_FORMAT } from '@/lib/ambient-sound/types'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { buildAudioDesignTimelineSignature } from '@/lib/audio-design/contract'
import { readPersistedAudioDesign, type PersistedAudioDesign } from '@/lib/audio-design/project-data'
import { resolveScoreProviderDurationSeconds } from '@/lib/audio-design/score-duration'

const vocalModeSchema = z.enum(['instrumental', 'vocal'])
const outputFormatSchema = z.enum(['mp3', 'wav'])

const musicGenerationInputSchema = z
  .object({
    musicModel: z.string().min(1).optional(),
    prompt: z.string().min(1),
    durationSeconds: z.number().int().min(1).max(600),
    vocalMode: vocalModeSchema.optional(),
    genre: z.string().min(1).optional(),
    mood: z.string().min(1).optional(),
    bpm: z.number().int().min(20).max(300).optional(),
    outputFormat: outputFormatSchema.optional(),
  })
  .passthrough()

type MusicGenerationInput = z.infer<typeof musicGenerationInputSchema>

const bgmScoreGenerationInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    musicModel: z.string().min(1).optional(),
    outputFormat: outputFormatSchema.optional(),
  })
  .passthrough()

type BgmScoreGenerationInput = z.infer<typeof bgmScoreGenerationInputSchema>

const audioDesignPlanningInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    musicModel: z.string().min(1).optional(),
    soundEffectModel: z.string().min(1).optional(),
  })
  .passthrough()

type AudioDesignPlanningInput = z.infer<typeof audioDesignPlanningInputSchema>

const ambientSoundGenerationInputSchema = z
  .object({
    episodeId: z.string().min(1).optional(),
    soundEffectModel: z.string().min(1).optional(),
  })
  .passthrough()

type AmbientSoundGenerationInput = z.infer<typeof ambientSoundGenerationInputSchema>

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
    const systemModel = await resolveSystemModelKey({
      userId,
      projectId,
      purpose: 'music',
    })
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
    const systemModel = await resolveSystemModelKey({
      userId,
      projectId,
      purpose: 'music',
    })
    assertPlatformMusicModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const configured = normalizeString(projectModelConfig.musicModel)
  if (!configured) throw new Error('PROJECT_AGENT_BGM_SCORE_MUSIC_MODEL_REQUIRED')
  return requireModelKey(configured)
}

async function resolveAmbientSoundSoundEffectModel(
  input: AudioDesignPlanningInput | AmbientSoundGenerationInput,
  projectId: string,
  userId: string,
): Promise<string> {
  const requested = normalizeString(input.soundEffectModel)
  if (isPlatformProviderCredentialMode()) {
    const systemModel = await resolveSystemModelKey({
      userId,
      projectId,
      purpose: 'sound-effect',
    })
    assertPlatformSoundEffectModelInput(requested, systemModel)
    return systemModel
  }
  if (requested) return requireModelKey(requested)

  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const configured = normalizeString(projectModelConfig.soundEffectModel)
  if (!configured) throw new Error('PROJECT_AGENT_AMBIENT_SOUND_SOUND_EFFECT_MODEL_REQUIRED')
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
    return await resolveSystemModelKey({
      userId,
      projectId,
      purpose: 'analysis',
    })
  }
  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  const analysisModel = normalizeString(projectModelConfig.analysisModel)
  if (!analysisModel) throw new Error('PROJECT_AGENT_ANALYSIS_MODEL_REQUIRED')
  return requireModelKey(analysisModel)
}

async function planGenerateProjectMusicOperation(ctx: ProjectAgentOperationContext, input: MusicGenerationInput): Promise<OperationPlan> {
  const musicModel = await resolveMusicModel(input, ctx.projectId, ctx.userId)
  const episodeId = normalizeString((input as Record<string, unknown>).episodeId) || null
  const durationSeconds = isCloudDeployment()
    ? Number(resolveCloudMusicOption('durationSeconds', input.durationSeconds))
    : input.durationSeconds
  const outputFormat = isCloudDeployment() ? resolveCloudMusicOption('outputFormat', input.outputFormat) : input.outputFormat
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
        locale: resolveOperationLocale(ctx.context),
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

async function commitGenerateProjectMusicOperation(ctx: ProjectAgentOperationContext, input: MusicGenerationInput, plan: OperationPlan) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const musicModel = typeof plan.metadata?.musicModel === 'string' ? plan.metadata.musicModel : ''
  const episodeId = typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : null
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_project_music',
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

async function loadApprovedAudioDesign(episodeId: string, projectId: string): Promise<PersistedAudioDesign> {
  const row = await prisma.projectEditAudioDesign.findFirst({
    where: { episodeId, episode: { projectId } },
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
  const design = readPersistedAudioDesign(row)
  if (!design) throw new Error('AUDIO_DESIGN_PLAN_REQUIRED')
  const clips = await loadEpisodeChapterOutputClips({ episodeId, projectId })
  const currentSignature = buildAudioDesignTimelineSignature(clips)
  if (currentSignature !== design.timelineSignature) {
    throw new Error(`AUDIO_DESIGN_TIMELINE_STALE:${design.timelineSignature}:${currentSignature}`)
  }
  return design
}

async function planEpisodeAudioDesignOperation(
  ctx: ProjectAgentOperationContext,
  input: AudioDesignPlanningInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  await resolveBgmScoreEpisodeDurationSeconds(episodeId, ctx.projectId)
  const musicModel = await resolveBgmScoreMusicModel(input, ctx.projectId, ctx.userId)
  const soundEffectModel = await resolveAmbientSoundSoundEffectModel(input, ctx.projectId, ctx.userId)
  const analysisModel = await resolveAnalysisModel(ctx.projectId, ctx.userId)
  const payload: Record<string, unknown> = { episodeId, analysisModel, musicModel, soundEffectModel, maxInputTokens: 12_000 }
  return {
    kind: 'task_submission',
    operationId: 'plan_episode_audio_design',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [createPlannedTask({
      id: `plan_episode_audio_design:${episodeId}`,
      taskType: TASK_TYPE.AUDIO_DESIGN_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episodeId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      episodeId,
      dedupeKey: `audio_design_plan:${ctx.projectId}:${episodeId}:${hashPayload(payload)}`,
      billingInfo: requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.AUDIO_DESIGN_PLAN, payload, allowedApiTypes: ['text'] }),
    })],
    metadata: { episodeId, musicModel, soundEffectModel },
  }
}

async function planGenerateEpisodeBgmScoreOperation(
  ctx: ProjectAgentOperationContext,
  input: BgmScoreGenerationInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const approved = await loadApprovedAudioDesign(episodeId, ctx.projectId)
  const cue = approved.design.scoreCues[0]
  if (!cue) throw new Error('BGM_SCORE_GENERATE_NOT_REQUIRED')
  const musicModel = approved.musicModel
  const requestedMusicModel = normalizeString(input.musicModel)
  if (requestedMusicModel && requireModelKey(requestedMusicModel) !== musicModel) {
    throw new Error(`BGM_SCORE_PLANNED_MODEL_MISMATCH:${musicModel}:${requestedMusicModel}`)
  }
  const timelineDurationSeconds = approved.design.clock.totalFrames / approved.design.clock.fps
  const providerDurationSeconds = resolveScoreProviderDurationSeconds({ musicModel, targetDurationSeconds: timelineDurationSeconds })
  const outputFormat = isCloudDeployment() ? resolveCloudMusicOption('outputFormat', input.outputFormat) : input.outputFormat
  const payload: Record<string, unknown> = {
    episodeId,
    musicModel,
    audioDesign: approved.design,
    designSignature: approved.designSignature,
    timelineSignature: approved.timelineSignature,
    timelineDurationSeconds,
    durationSeconds: providerDurationSeconds,
    count: 2,
    ...(typeof outputFormat === 'string' ? { outputFormat } : {}),
  }

  return {
    kind: 'task_submission',
    operationId: 'generate_episode_bgm_score',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `generate_episode_bgm_score:${episodeId}:${approved.designSignature}`,
        taskType: TASK_TYPE.MUSIC_SCORE_GENERATE,
        targetType: 'ProjectEpisode',
        targetId: episodeId,
        payload,
        locale: resolveOperationLocale(ctx.context),
        episodeId,
        dedupeKey: `music_score_generate:${ctx.projectId}:${episodeId}:${approved.designSignature}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.MUSIC_SCORE_GENERATE,
          payload,
          allowedApiTypes: ['music'],
        }),
      }),
    ],
    metadata: { episodeId, musicModel, designSignature: approved.designSignature },
  }
}

async function planGenerateEpisodeAmbientSoundOperation(
  ctx: ProjectAgentOperationContext,
  input: AmbientSoundGenerationInput,
): Promise<OperationPlan> {
  const episodeId = normalizeString(input.episodeId) || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const approved = await loadApprovedAudioDesign(episodeId, ctx.projectId)
  const soundEffectModel = approved.soundEffectModel
  const requestedModel = normalizeString(input.soundEffectModel)
  if (requestedModel && requireModelKey(requestedModel) !== soundEffectModel) {
    throw new Error(`AMBIENT_SOUND_PLANNED_MODEL_MISMATCH:${soundEffectModel}:${requestedModel}`)
  }
  const sources = approved.design.ambienceSources
  if (sources.length === 0) throw new Error('AMBIENT_SOUND_GENERATE_NOT_REQUIRED')
  const durationSeconds = Math.max(...sources.map((source) => source.loopDurationSeconds))
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('AMBIENT_SOUND_SOURCE_DURATION_REQUIRED')
  }
  const payload: Record<string, unknown> = {
    episodeId,
    soundEffectModel,
    audioDesign: approved.design,
    designSignature: approved.designSignature,
    timelineSignature: approved.timelineSignature,
    durationSeconds,
    sourceCount: sources.length * 2,
    loop: true,
    outputFormat: AMBIENT_SOUND_OUTPUT_FORMAT,
  }

  return {
    kind: 'task_submission',
    operationId: 'generate_episode_ambient_sound',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [
      createPlannedTask({
        id: `generate_episode_ambient_sound:${episodeId}:${approved.designSignature}`,
        taskType: TASK_TYPE.AMBIENT_SOUND_GENERATE,
        targetType: 'ProjectEpisode',
        targetId: episodeId,
        payload,
        locale: resolveOperationLocale(ctx.context),
        episodeId,
        dedupeKey: `ambient_sound_generate:${ctx.projectId}:${episodeId}:${approved.designSignature}`,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.AMBIENT_SOUND_GENERATE,
          payload,
          allowedApiTypes: ['sound_effect'],
        }),
      }),
    ],
    metadata: {
      episodeId,
      soundEffectModel,
      designSignature: approved.designSignature,
    },
  }
}

async function commitPlanEpisodeAudioDesignOperation(
  ctx: ProjectAgentOperationContext,
  input: AudioDesignPlanningInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const musicModel = typeof plan.metadata?.musicModel === 'string' ? plan.metadata.musicModel : ''
  const episodeId =
    (typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : '')
    || normalizeString(input.episodeId)
    || normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const result = await submitOperationTask({
    request: ctx.request,
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId: task.episodeId,
    type: task.taskType,
    targetType: task.target.targetType,
    targetId: task.target.targetId,
    operationId: 'plan_episode_audio_design',
    source: ctx.source,
    payload: task.payload,
    dedupeKey: task.dedupeKey,
    priority: task.priority,
    locale: task.locale,
    billingInfo: task.billingInfo,
    billingInfoSource: 'planned',
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'plan_episode_audio_design',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    projectId: ctx.projectId,
    episodeId,
    taskType: TASK_TYPE.AUDIO_DESIGN_PLAN,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  })

  return {
    ...result,
    musicModel,
    soundEffectModel: typeof plan.metadata?.soundEffectModel === 'string' ? plan.metadata.soundEffectModel : '',
    taskType: TASK_TYPE.AUDIO_DESIGN_PLAN,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  }
}

async function commitGenerateEpisodeBgmScoreOperation(
  ctx: ProjectAgentOperationContext,
  input: BgmScoreGenerationInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const musicModel = typeof plan.metadata?.musicModel === 'string' ? plan.metadata.musicModel : ''
  const episodeId =
    (typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : '') ||
    normalizeString(input.episodeId) ||
    normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_episode_bgm_score',
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
    taskType: TASK_TYPE.MUSIC_SCORE_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  })

  return {
    ...result,
    musicModel,
    taskType: TASK_TYPE.MUSIC_SCORE_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  }
}

async function commitGenerateEpisodeAmbientSoundOperation(
  ctx: ProjectAgentOperationContext,
  input: AmbientSoundGenerationInput,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const soundEffectModel = typeof plan.metadata?.soundEffectModel === 'string' ? plan.metadata.soundEffectModel : ''
  const episodeId =
    (typeof plan.metadata?.episodeId === 'string' ? plan.metadata.episodeId : '') ||
    normalizeString(input.episodeId) ||
    normalizeString(ctx.context.episodeId)
  if (!episodeId) throw new Error('PROJECT_AGENT_EPISODE_REQUIRED')
  const result = await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'generate_episode_ambient_sound',
  })

  writeOperationDataPart<TaskSubmittedPartData>(ctx.writer, 'data-task-submitted', {
    operationId: 'generate_episode_ambient_sound',
    taskId: result.taskId,
    status: result.status,
    runId: result.runId || null,
    deduped: result.deduped,
    billingReceipt: result.billingReceiptView,
    projectId: ctx.projectId,
    episodeId,
    taskType: TASK_TYPE.AMBIENT_SOUND_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  })

  return {
    ...result,
    soundEffectModel,
    taskType: TASK_TYPE.AMBIENT_SOUND_GENERATE,
    targetType: 'ProjectEpisode',
    targetId: episodeId,
  }
}

export function createMusicGenerationOperations(): ProjectAgentOperationRegistryDraft {
  const musicTaskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        musicModel: z.string().min(1),
      })
      .passthrough(),
  )
  const ambientSoundTaskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        soundEffectModel: z.string().min(1),
      })
      .passthrough(),
  )
  const audioDesignTaskSubmitOutput = refineTaskSubmitOperationOutputSchema(
    taskSubmitOperationOutputSchemaBase
      .extend({
        musicModel: z.string().min(1),
        soundEffectModel: z.string().min(1),
      })
      .passthrough(),
  )

  return {
    generate_project_music: defineOperation({
      id: 'generate_project_music',
      summary: 'Generate a project music asset using the configured music provider (async task submission).',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
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
    }),
    plan_episode_audio_design: defineOperation({
      id: 'plan_episode_audio_design',
      summary: 'Plan one episode-level sound design from locked scripts and rendered timeline metadata, without inspecting media content.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      confirmation: {
        kind: 'none',
        required: false,
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: audioDesignPlanningInputSchema,
      outputSchema: audioDesignTaskSubmitOutput,
      execute: async (ctx, input) => {
        const plan = await planEpisodeAudioDesignOperation(ctx, input)
        return await commitPlanEpisodeAudioDesignOperation(ctx, input, plan)
      },
    }),
    generate_episode_bgm_score: defineOperation({
      id: 'generate_episode_bgm_score',
      summary: 'Generate the exact approved episode music-score plan using the configured paid music provider.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将按当前集已确定的配乐规划提交付费音乐生成任务。',
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: bgmScoreGenerationInputSchema,
      outputSchema: musicTaskSubmitOutput,
      plan: async (ctx, input) => planGenerateEpisodeBgmScoreOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateEpisodeBgmScoreOperation(ctx, input, plan),
    }),
    generate_episode_ambient_sound: defineOperation({
      id: 'generate_episode_ambient_sound',
      summary: 'Generate the exact approved episode ambient sound plan using the configured paid sound-effect provider.',
      intent: 'act',
      prerequisites: { episodeId: 'required' },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      confirmation: {
        kind: 'billable_media',
        required: true,
        summary: '将按当前集的声场计划提交付费环境音生成任务。',
      },
      toolInputSchema: EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA,
      inputSchema: ambientSoundGenerationInputSchema,
      outputSchema: ambientSoundTaskSubmitOutput,
      plan: async (ctx, input) => planGenerateEpisodeAmbientSoundOperation(ctx, input),
      commit: async (ctx, input, plan) => commitGenerateEpisodeAmbientSoundOperation(ctx, input, plan),
    }),
  }
}
