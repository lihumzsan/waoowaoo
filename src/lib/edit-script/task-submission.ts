import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { EDIT_BIBLE_STATUS } from '@/lib/edit-bible/constraints'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { buildEditFirstTextTaskPayload } from './task-billing'
import {
  resolveEditShotExecutionPlanTaskTarget,
} from './service'

type OperationTaskSubmitResult = Awaited<ReturnType<typeof submitOperationTask>>

type EditShotExecutionPlanTaskTarget = {
  readonly episodeId: string
  readonly chapterId: string
  readonly editScriptId: string
}

export type EditShotExecutionPlanTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly chapterId: string
  readonly editScriptId: string
  readonly taskType: typeof TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE
  readonly targetType: 'ProjectEditScript'
  readonly targetId: string
}

export type EditShotExecutionPlanBatchTaskSubmitResult = {
  readonly success: true
  readonly async: true
  readonly episodeId: string
  readonly batchKey: string
  readonly total: number
  readonly taskIds: string[]
  readonly results: Array<{
    readonly refId: string
    readonly taskId: string
    readonly taskType: typeof TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE
    readonly targetType: 'ProjectEditScript'
    readonly targetId: string
  }>
  readonly submittedTasks: Array<{
    readonly chapterId: string
    readonly editScriptId: string
    readonly taskId: string
    readonly status: string
    readonly runId: string | null
    readonly deduped: boolean
    readonly taskType: typeof TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE
    readonly targetType: 'ProjectEditScript'
    readonly targetId: string
  }>
}

export type EditScriptTaskSubmitResult = OperationTaskSubmitResult & {
  readonly episodeId: string
  readonly chapterId: string
  readonly taskType: typeof TASK_TYPE.EDIT_SCRIPT_GENERATE
  readonly targetType: 'ProjectEditChapter'
  readonly targetId: string
}

async function findActiveEditScriptTaskTarget(params: {
  readonly projectId: string
  readonly dedupeKey: string
}): Promise<string | null> {
  const task = await prisma.task.findFirst({
    where: {
      projectId: params.projectId,
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      dedupeKey: params.dedupeKey,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    select: { targetId: true },
  })
  return task?.targetId ?? null
}

async function resolveEditScriptTaskTarget(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly chapterId?: string
}): Promise<{ readonly episodeId: string; readonly chapterId: string }> {
  const episode = await prisma.projectEpisode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: {
      id: true,
      editBible: {
        select: { status: true },
      },
    },
  })
  if (!episode) throw new ApiError('NOT_FOUND')
  if (episode.editBible?.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_CONFIRMATION_REQUIRED',
      message: `Edit Bible must be confirmed before edit script generation; current status is ${episode.editBible?.status ?? 'missing'}`,
    })
  }
  const chapter = await prisma.projectEditChapter.findFirst({
    where: {
      episodeId: input.episodeId,
      ...(input.chapterId ? { id: input.chapterId } : { chapterIndex: 0 }),
    },
    select: { id: true },
  })
  if (!chapter) throw new ApiError('NOT_FOUND')
  return {
    episodeId: episode.id,
    chapterId: chapter.id,
  }
}

export async function submitProjectEditScriptGenerationTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly videoRatio?: '9:16' | '16:9' | '21:9'
  readonly source: string
  readonly locale: Locale
  readonly batchKey?: string | null
  readonly operationId?: 'generate_edit_script' | 'replan_chapter'
}): Promise<EditScriptTaskSubmitResult> {
  const target = await resolveEditScriptTaskTarget({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  })
  const dedupeKey = `edit_script_generate:${input.projectId}:${target.episodeId}:${target.chapterId}`
  const activeTargetId = await findActiveEditScriptTaskTarget({
    projectId: input.projectId,
    dedupeKey,
  })
  if (activeTargetId && activeTargetId !== target.chapterId) {
    throw new Error(`EDIT_SCRIPT_ACTIVE_TARGET_MISMATCH:${activeTargetId}`)
  }
  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: target.episodeId,
    type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
    targetType: 'ProjectEditChapter',
    targetId: target.chapterId,
    operationId: input.operationId ?? 'generate_edit_script',
    source: input.source,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        episodeId: target.episodeId,
        chapterId: target.chapterId,
        ...(input.videoRatio ? { videoRatio: input.videoRatio } : {}),
        displayMode: 'detail',
      },
    }),
    dedupeKey,
    batchKey: input.batchKey ?? undefined,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    chapterId: target.chapterId,
    taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
    targetType: 'ProjectEditChapter',
    targetId: target.chapterId,
  }
}

export async function submitProjectEditShotExecutionPlanTask(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly editScriptId?: string
  readonly batchKey?: string | null
  readonly source: string
  readonly locale: Locale
}): Promise<EditShotExecutionPlanTaskSubmitResult> {
  const target = await resolveEditShotExecutionPlanTaskTarget({
    projectId: input.projectId,
    episodeId: input.episodeId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    ...(input.editScriptId ? { editScriptId: input.editScriptId } : {}),
  })
  await assertEditShotExecutionPlanNeedsGeneration({
    projectId: input.projectId,
    episodeId: target.episodeId,
    editScriptId: target.editScriptId,
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
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        episodeId: target.episodeId,
        chapterId: target.chapterId,
        editScriptId: target.editScriptId,
        displayMode: 'detail',
      },
    }),
    dedupeKey: `edit_shot_execution_plan_generate:${input.projectId}:${target.editScriptId}`,
    batchKey: input.batchKey ?? undefined,
    locale: input.locale,
  })

  return {
    ...result,
    episodeId: target.episodeId,
    chapterId: target.chapterId,
    editScriptId: target.editScriptId,
    taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
    targetType: 'ProjectEditScript',
    targetId: target.editScriptId,
  }
}

async function resolveEpisodeEditShotExecutionPlanTaskTargets(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<readonly EditShotExecutionPlanTaskTarget[]> {
  const editScripts = await prisma.projectEditScript.findMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      status: 'ready',
    },
    select: {
      id: true,
      episodeId: true,
      chapterId: true,
      shotExecutionPlan: {
        select: {
          status: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  })

  return editScripts
    .filter((script) => script.shotExecutionPlan?.status !== 'ready')
    .map((script) => ({
      episodeId: script.episodeId,
      chapterId: script.chapterId,
      editScriptId: script.id,
    }))
}

async function assertEditShotExecutionPlanNeedsGeneration(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
}): Promise<void> {
  const existingReadyPlan = await prisma.projectEditShotExecutionPlan.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      editScriptId: input.editScriptId,
      status: 'ready',
    },
    select: { id: true },
  })
  if (existingReadyPlan) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SHOT_EXECUTION_PLAN_ALREADY_READY',
      message: 'Shot execution plan is already ready for this edit script.',
    })
  }
}

export async function submitProjectEditShotExecutionPlanBatchTasks(input: {
  readonly request: NextRequest
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string
  readonly batchKey: string
  readonly source: string
  readonly locale: Locale
  readonly onSubmittedTask?: (taskId: string) => void
}): Promise<EditShotExecutionPlanBatchTaskSubmitResult> {
  const targets = await resolveEpisodeEditShotExecutionPlanTaskTargets({
    projectId: input.projectId,
    episodeId: input.episodeId,
  })
  if (targets.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SHOT_EXECUTION_PLAN_TARGETS_REQUIRED',
      message: 'No edit scripts require shot execution plan generation.',
    })
  }

  const submittedTasks: EditShotExecutionPlanBatchTaskSubmitResult['submittedTasks'] = []
  for (const target of targets) {
    const result = await submitProjectEditShotExecutionPlanTask({
      request: input.request,
      projectId: input.projectId,
      userId: input.userId,
      episodeId: target.episodeId,
      chapterId: target.chapterId,
      editScriptId: target.editScriptId,
      batchKey: input.batchKey,
      source: input.source,
      locale: input.locale,
    })
    input.onSubmittedTask?.(result.taskId)
    submittedTasks.push({
      chapterId: result.chapterId,
      editScriptId: result.editScriptId,
      taskId: result.taskId,
      status: result.status,
      runId: result.runId ?? null,
      deduped: result.deduped,
      taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: result.editScriptId,
    })
  }

  return {
    success: true,
    async: true,
    episodeId: input.episodeId,
    batchKey: input.batchKey,
    total: submittedTasks.length,
    taskIds: submittedTasks.map((task) => task.taskId),
    results: submittedTasks.map((task) => ({
      refId: task.editScriptId,
      taskId: task.taskId,
      taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: task.editScriptId,
    })),
    submittedTasks,
  }
}
