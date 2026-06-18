import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { buildEditFirstStructuredUserPrompt, type EditFirstDurationTier } from './duration-tier'
import type { EditScriptVideoRatio } from './types'
import {
  resolveEditCinematographyShotPlanTaskTarget,
  resolveEditDirectorDecoupageTaskTarget,
} from './service'

type OperationTaskSubmitResult = Awaited<ReturnType<typeof submitOperationTask>>

const EDIT_SCREENPLAY_STATUS_GENERATING = 'generating'
const EDIT_SCREENPLAY_STATUS_SCREENPLAY_READY = 'screenplay_ready'

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

export type EditDirectorDecoupageTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly screenplayId: string
  readonly taskType: typeof TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE
  readonly targetType: 'ProjectEditScreenplay'
  readonly targetId: string
}

export type EditCinematographyShotPlanTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly editScriptId: string
  readonly taskType: typeof TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE
  readonly targetType: 'ProjectEditScript'
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
      payload: {
        episodeId: input.episodeId,
        screenplayId: target.screenplayId,
        prompt: input.prompt,
        durationTier: input.durationTier,
        aspectRatio: input.aspectRatio,
        displayMode: 'detail',
      },
      dedupeKey,
      billingInfo: null,
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
    payload: {
      episodeId: target.episodeId,
      screenplayId: target.screenplayId,
      revisionInstruction: input.revisionInstruction,
      durationTier: input.durationTier,
      aspectRatio: input.aspectRatio,
      displayMode: 'detail',
    },
    dedupeKey: `edit_screenplay_revise:${input.projectId}:${target.screenplayId}`,
    billingInfo: null,
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

export async function submitProjectEditDirectorDecoupageTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly screenplayId?: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditDirectorDecoupageTaskSubmitResult> {
  const target = await resolveEditDirectorDecoupageTaskTarget({
    projectId: input.projectId,
    episodeId: input.episodeId,
    ...(input.screenplayId ? { screenplayId: input.screenplayId } : {}),
  })
  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: target.episodeId,
    type: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
    targetType: 'ProjectEditScreenplay',
    targetId: target.screenplayId,
    operationId: 'generate_edit_director_decoupage',
    source: input.source,
    confirmed: input.confirmed,
    payload: {
      episodeId: target.episodeId,
      screenplayId: target.screenplayId,
      displayMode: 'detail',
    },
    dedupeKey: `edit_director_decoupage_generate:${input.projectId}:${target.screenplayId}`,
    billingInfo: null,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    screenplayId: target.screenplayId,
    taskType: TASK_TYPE.EDIT_DIRECTOR_DECOUPAGE_GENERATE,
    targetType: 'ProjectEditScreenplay',
    targetId: target.screenplayId,
  }
}

export async function submitProjectEditCinematographyShotPlanTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly editScriptId?: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}): Promise<EditCinematographyShotPlanTaskSubmitResult> {
  const target = await resolveEditCinematographyShotPlanTaskTarget({
    projectId: input.projectId,
    episodeId: input.episodeId,
    ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
  })
  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: target.episodeId,
    type: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
    targetType: 'ProjectEditScript',
    targetId: target.editScriptId,
    operationId: 'generate_edit_cinematography_shot_plan',
    source: input.source,
    confirmed: input.confirmed,
    payload: {
      episodeId: target.episodeId,
      editScriptId: target.editScriptId,
      displayMode: 'detail',
    },
    dedupeKey: `edit_cinematography_shot_plan_generate:${input.projectId}:${target.editScriptId}`,
    billingInfo: null,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    editScriptId: target.editScriptId,
    taskType: TASK_TYPE.EDIT_CINEMATOGRAPHY_SHOT_PLAN_GENERATE,
    targetType: 'ProjectEditScript',
    targetId: target.editScriptId,
  }
}
