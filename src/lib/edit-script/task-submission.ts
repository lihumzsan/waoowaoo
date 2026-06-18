import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_TYPE } from '@/lib/task/types'
import {
  resolveEditCinematographyShotPlanTaskTarget,
  resolveEditDirectorDecoupageTaskTarget,
} from './service'

type OperationTaskSubmitResult = Awaited<ReturnType<typeof submitOperationTask>>

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
