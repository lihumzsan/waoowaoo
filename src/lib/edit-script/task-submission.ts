import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { getProjectModelConfig } from '@/lib/config-service'
import { buildEditFirstStructuredUserPrompt, type EditFirstDurationTier } from './duration-tier'
import { EDIT_STYLE_PREVIEW_MAX_COUNT, type EditScriptVideoRatio } from './types'
import { buildEditFirstTextTaskPayload, buildEditFirstTextTaskPayloadFromAnalysisModel } from './task-billing'
import {
  resolveEditShotExecutionPlanTaskTarget,
} from './service'

type OperationTaskSubmitResult = Awaited<ReturnType<typeof submitOperationTask>>

const EDIT_SCREENPLAY_STATUS_GENERATING = 'generating'
const EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY = 'screenplay_ready'
const EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_READY = 'style_preview_ready'

type EditScreenplaySnapshot = {
  readonly id: string
  readonly userPrompt: string
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly screenplayText: string
  readonly status: string
}

export type EditScreenplayTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly screenplayId: string
  readonly taskType: typeof TASK_TYPE.EDIT_SCREENPLAY_GENERATE | typeof TASK_TYPE.EDIT_SCREENPLAY_REVISE
  readonly targetType: 'ProjectEditScreenplay'
  readonly targetId: string
}

export type EditShotExecutionPlanTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly editScriptId: string
  readonly taskType: typeof TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE
  readonly targetType: 'ProjectEditScript'
  readonly targetId: string
}

export type EditStylePreviewsTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly screenplayId: string
  readonly taskType: typeof TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE
  readonly targetType: 'ProjectEditScreenplay'
  readonly targetId: string
}

function toNullableInputJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}

async function restoreEditScreenplaySnapshot(params: {
  readonly pendingScreenplayId: string
  readonly snapshot: EditScreenplaySnapshot | null
}) {
  if (!params.snapshot) {
    await prisma.projectEditScreenplay.deleteMany({
      where: { id: params.pendingScreenplayId },
    })
    return
  }

  await prisma.projectEditScreenplay.update({
    where: { id: params.snapshot.id },
    data: {
      userPrompt: params.snapshot.userPrompt,
      styleBibleJson: toNullableInputJson(params.snapshot.styleBibleJson),
      screenplayText: params.snapshot.screenplayText,
      status: params.snapshot.status,
    },
  })
}

async function findActiveEditScreenplayTaskTarget(params: {
  readonly projectId: string
  readonly dedupeKey: string
  readonly taskType: typeof TASK_TYPE.EDIT_SCREENPLAY_GENERATE | typeof TASK_TYPE.EDIT_SCREENPLAY_REVISE
}): Promise<string | null> {
  const task = await prisma.task.findFirst({
    where: {
      projectId: params.projectId,
      type: params.taskType,
      dedupeKey: params.dedupeKey,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    select: { targetId: true },
  })
  return task?.targetId ?? null
}

async function assertEpisodeAccess(params: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
}) {
  const episode = await prisma.projectEpisode.findFirst({
    where: {
      id: params.episodeId,
      projectId: params.projectId,
      project: { userId: params.userId },
    },
    select: { id: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND')
}

async function prepareEditScreenplayGenerationTarget(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly prompt: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
  readonly locale: Locale
  readonly dedupeKey: string
}): Promise<{ readonly screenplayId: string; readonly rollback: (() => Promise<void>) | null }> {
  await assertEpisodeAccess({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
  })

  const activeTargetId = await findActiveEditScreenplayTaskTarget({
    projectId: input.projectId,
    dedupeKey: input.dedupeKey,
    taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
  })
  if (activeTargetId) {
    const existingPending = await prisma.projectEditScreenplay.findFirst({
      where: {
        id: activeTargetId,
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      select: { id: true },
    })
    if (!existingPending) throw new Error(`EDIT_SCREENPLAY_ACTIVE_TARGET_MISSING:${activeTargetId}`)
    return { screenplayId: existingPending.id, rollback: null }
  }

  const snapshot = await prisma.projectEditScreenplay.findUnique({
    where: { episodeId: input.episodeId },
    select: {
      id: true,
      userPrompt: true,
      styleBibleJson: true,
      screenplayText: true,
      status: true,
    },
  })
  const structuredUserPrompt = buildEditFirstStructuredUserPrompt({
    prompt: input.prompt,
    durationTier: input.durationTier,
    aspectRatio: input.aspectRatio,
    locale: input.locale,
  })
  const pending = snapshot
    ? await prisma.projectEditScreenplay.update({
        where: { id: snapshot.id },
        data: {
          userPrompt: structuredUserPrompt,
          styleBibleJson: Prisma.JsonNull,
          status: EDIT_SCREENPLAY_STATUS_GENERATING,
        },
        select: { id: true },
      })
    : await prisma.projectEditScreenplay.create({
        data: {
          projectId: input.projectId,
          episodeId: input.episodeId,
          userPrompt: structuredUserPrompt,
          styleBibleJson: Prisma.JsonNull,
          screenplayText: '',
          status: EDIT_SCREENPLAY_STATUS_GENERATING,
        },
        select: { id: true },
      })

  return {
    screenplayId: pending.id,
    rollback: async () => await restoreEditScreenplaySnapshot({
      pendingScreenplayId: pending.id,
      snapshot,
    }),
  }
}

async function resolveEditScreenplayRevisionTarget(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplayId?: string
}) {
  const screenplay = await prisma.projectEditScreenplay.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      ...(input.screenplayId ? { id: input.screenplayId } : {}),
      project: { userId: input.userId },
    },
    select: {
      id: true,
      status: true,
    },
  })
  if (!screenplay) throw new ApiError('NOT_FOUND')
  if (screenplay.status !== EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCREENPLAY_REVISION_NOT_ALLOWED',
      message: `Edit screenplay can only be revised during screenplay review; current status is ${screenplay.status}`,
    })
  }
  return { episodeId: input.episodeId, screenplayId: screenplay.id }
}

function resolveStylePreviewCount(value: number | undefined): number {
  if (value === undefined) return EDIT_STYLE_PREVIEW_MAX_COUNT
  if (!Number.isInteger(value) || value < 1 || value > EDIT_STYLE_PREVIEW_MAX_COUNT) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_STYLE_PREVIEW_COUNT_INVALID',
      message: `Style preview count must be an integer from 1 to ${String(EDIT_STYLE_PREVIEW_MAX_COUNT)}`,
    })
  }
  return value
}

async function findActiveEditStylePreviewsTaskTarget(params: {
  readonly projectId: string
  readonly dedupeKey: string
}): Promise<string | null> {
  const task = await prisma.task.findFirst({
    where: {
      projectId: params.projectId,
      type: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
      dedupeKey: params.dedupeKey,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    select: { targetId: true },
  })
  return task?.targetId ?? null
}

async function resolveEditStylePreviewsTaskTarget(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly screenplay: {
    readonly id: string
    readonly status: string
  }
  readonly dedupeKey: string
}) {
  const activeTargetId = await findActiveEditStylePreviewsTaskTarget({
    projectId: input.projectId,
    dedupeKey: input.dedupeKey,
  })
  if (activeTargetId) {
    if (activeTargetId !== input.screenplay.id) {
      throw new Error(`EDIT_STYLE_PREVIEWS_ACTIVE_TARGET_MISMATCH:${activeTargetId}`)
    }
    return { episodeId: input.episodeId, screenplayId: input.screenplay.id }
  }

  if (
    input.screenplay.status !== EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY
    && input.screenplay.status !== EDIT_SCREENPLAY_STATUS_STYLE_PREVIEW_READY
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCREENPLAY_REVIEW_REQUIRED',
      message: `Edit screenplay must be ready for style preview generation or regeneration; current status is ${input.screenplay.status}`,
    })
  }

  return { episodeId: input.episodeId, screenplayId: input.screenplay.id }
}

export async function submitProjectEditScreenplayGenerationTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly prompt: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditScreenplayTaskSubmitResult> {
  const dedupeKey = `edit_screenplay_generate:${input.projectId}:${input.episodeId}`
  const target = await prepareEditScreenplayGenerationTarget({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    prompt: input.prompt,
    durationTier: input.durationTier,
    aspectRatio: input.aspectRatio,
    locale: input.locale,
    dedupeKey,
  })

  try {
    const result = await submitOperationTask({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      type: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: target.screenplayId,
      operationId: 'generate_edit_screenplay',
      source: input.source,
      confirmed: input.confirmed,
      payload: await buildEditFirstTextTaskPayload({
        projectId: input.projectId,
        userId: input.userId,
        payload: {
          episodeId: input.episodeId,
          screenplayId: target.screenplayId,
          prompt: input.prompt,
          durationTier: input.durationTier,
          aspectRatio: input.aspectRatio,
          displayMode: 'detail',
        },
      }),
      dedupeKey,
      locale: input.locale,
    })

    return {
      ...result,
      episodeId: input.episodeId,
      screenplayId: target.screenplayId,
      taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
      targetType: 'ProjectEditScreenplay',
      targetId: target.screenplayId,
    }
  } catch (error) {
    if (target.rollback) await target.rollback()
    throw error
  }
}

export async function submitProjectEditScreenplayRevisionTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplayId?: string
  readonly revisionInstruction: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditScreenplayTaskSubmitResult> {
  const target = await resolveEditScreenplayRevisionTarget({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    ...(input.screenplayId ? { screenplayId: input.screenplayId } : {}),
  })
  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: target.episodeId,
    type: TASK_TYPE.EDIT_SCREENPLAY_REVISE,
    targetType: 'ProjectEditScreenplay',
    targetId: target.screenplayId,
    operationId: 'revise_edit_screenplay',
    source: input.source,
    confirmed: input.confirmed,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        episodeId: target.episodeId,
        screenplayId: target.screenplayId,
        revisionInstruction: input.revisionInstruction,
        durationTier: input.durationTier,
        aspectRatio: input.aspectRatio,
        displayMode: 'detail',
      },
    }),
    dedupeKey: `edit_screenplay_revise:${input.projectId}:${target.screenplayId}`,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    screenplayId: target.screenplayId,
    taskType: TASK_TYPE.EDIT_SCREENPLAY_REVISE,
    targetType: 'ProjectEditScreenplay',
    targetId: target.screenplayId,
  }
}

export async function submitProjectEditStylePreviewsGenerationTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplayId?: string
  readonly styleDirection?: string
  readonly count?: number
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditStylePreviewsTaskSubmitResult> {
  const count = resolveStylePreviewCount(input.count)
  const screenplay = await prisma.projectEditScreenplay.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      ...(input.screenplayId ? { id: input.screenplayId } : {}),
      project: { userId: input.userId },
    },
    select: { id: true, status: true },
  })
  if (!screenplay) throw new ApiError('NOT_FOUND')

  const dedupeKey = `edit_style_previews_generate:${input.projectId}:${screenplay.id}`
  const target = await resolveEditStylePreviewsTaskTarget({
    projectId: input.projectId,
    episodeId: input.episodeId,
    screenplay,
    dedupeKey,
  })
  const config = await getProjectModelConfig(input.projectId, input.userId)
  if (!config.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_STORYBOARD_MODEL_REQUIRED',
      message: 'Project storyboard image model is required before edit style preview generation',
    })
  }
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit-first text task billing',
    })
  }

  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: target.episodeId,
    type: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
    targetType: 'ProjectEditScreenplay',
    targetId: target.screenplayId,
    operationId: 'generate_edit_style_previews',
    source: input.source,
    confirmed: input.confirmed,
    payload: buildEditFirstTextTaskPayloadFromAnalysisModel({
      analysisModel: config.analysisModel,
      payload: {
        episodeId: target.episodeId,
        screenplayId: target.screenplayId,
        count,
        ...(input.styleDirection ? { styleDirection: input.styleDirection } : {}),
        displayMode: 'detail',
      },
    }),
    dedupeKey,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    screenplayId: target.screenplayId,
    taskType: TASK_TYPE.EDIT_STYLE_PREVIEWS_GENERATE,
    targetType: 'ProjectEditScreenplay',
    targetId: target.screenplayId,
  }
}

export async function submitProjectEditShotExecutionPlanTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly editScriptId?: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditShotExecutionPlanTaskSubmitResult> {
  const target = await resolveEditShotExecutionPlanTaskTarget({
    projectId: input.projectId,
    episodeId: input.episodeId,
    ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
  })
  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: target.episodeId,
    type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
    targetType: 'ProjectEditScript',
    targetId: target.editScriptId,
    operationId: 'generate_edit_shot_execution_plan',
    source: input.source,
    confirmed: input.confirmed,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        episodeId: target.episodeId,
        editScriptId: target.editScriptId,
        displayMode: 'detail',
      },
    }),
    dedupeKey: `edit_shot_execution_plan_generate:${input.projectId}:${target.editScriptId}`,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    editScriptId: target.editScriptId,
    taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
    targetType: 'ProjectEditScript',
    targetId: target.editScriptId,
  }
}
