import { ApiError } from '@/lib/api-errors'
import type { Locale } from '@/i18n/routing'
import { TASK_TYPE } from '@/lib/task/types'
import { submitTask } from '@/lib/task/submitter'
import { prisma } from '@/lib/prisma'
import { buildStoryboardConsistencySource } from './source-snapshot'
import { isStoryboardSpatialProfileStageReady } from '@/lib/project-workflow/edit-first-readiness'
import { buildEditFirstTextTaskPayload } from '@/lib/edit-script/task-billing'

interface SubmitSpatialBlockingStoryboardInput {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId?: string
  readonly userId: string
  readonly locale: Locale
  readonly requestId?: string | null
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    return readRecord(JSON.parse(value))
  } catch {
    throw new Error('EDIT_SCRIPT_STORYBOARD_PHOTOGRAPHY_PLAN_INVALID')
  }
}

async function resolveEditScriptId(input: Pick<SubmitSpatialBlockingStoryboardInput, 'projectId' | 'episodeId' | 'editScriptId'>): Promise<string> {
  if (input.editScriptId) return input.editScriptId
  const editScript = await prisma.projectEditScript.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (!editScript?.id) throw new ApiError('NOT_FOUND')
  return editScript.id
}

export function assertRequiredLocationPreviews(input: {
  readonly sourceSnapshot: Awaited<ReturnType<typeof buildStoryboardConsistencySource>>['sourceSnapshot']
}) {
  if (input.sourceSnapshot.schemaVersion !== 1) throw new Error('EDIT_SCRIPT_STORYBOARD_SOURCE_SNAPSHOT_INVALID')
}

export async function submitEditScriptSpatialBlockingStoryboard(input: SubmitSpatialBlockingStoryboardInput) {
  const editScriptId = await resolveEditScriptId(input)
  const { sourceSnapshot, modelConfigSnapshot } = await buildStoryboardConsistencySource({
    projectId: input.projectId,
    episodeId: input.episodeId,
    editScriptId,
    userId: input.userId,
  })
  assertRequiredLocationPreviews({ sourceSnapshot })
  const submitted = await submitTask({
    userId: input.userId,
    locale: input.locale,
    projectId: input.projectId,
    episodeId: input.episodeId,
    type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE,
    targetType: 'ProjectEditScript',
    targetId: editScriptId,
    operationId: 'generate_edit_script_storyboard_spatial_blocking',
    operationSource: 'project-ui',
    requestId: input.requestId || null,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        editScriptId,
        sourceSnapshot,
        modelConfigSnapshot,
        count: sourceSnapshot.shots.length,
      },
    }),
    dedupeKey: `edit_script_storyboard_prepare:${input.projectId}:${input.episodeId}:${editScriptId}`,
  })
  return {
    ...submitted,
    editScriptId,
  }
}

export async function submitEditScriptStoryboardPanels(input: SubmitSpatialBlockingStoryboardInput) {
  const editScriptId = await resolveEditScriptId(input)
  const storyboards = await prisma.projectStoryboard.findMany({
    where: {
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      photographyPlan: true,
    },
  })
  const matchingStoryboards = storyboards.flatMap((storyboard) => {
    const plan = parseJsonRecord(storyboard.photographyPlan)
    const sourceEditScriptId = readString(plan.sourceEditScriptId)
    if (sourceEditScriptId !== editScriptId) return []
    return [{ storyboardId: storyboard.id, plan }]
  })
  const ready = matchingStoryboards.find((item) => isStoryboardSpatialProfileStageReady(readString(item.plan.currentStage)))
  if (!ready) {
    throw new ApiError('CONFLICT', {
      code: 'STORYBOARD_SPATIAL_BLOCKING_REQUIRED',
      message: 'Ready storyboard spatial blocking is required before generating storyboard panels',
    })
  }
  const { sourceSnapshot, modelConfigSnapshot } = await buildStoryboardConsistencySource({
    projectId: input.projectId,
    episodeId: input.episodeId,
    editScriptId,
    userId: input.userId,
  })
  const submitted = await submitTask({
    userId: input.userId,
    locale: input.locale,
    projectId: input.projectId,
    episodeId: input.episodeId,
    type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
    targetType: 'ProjectStoryboard',
    targetId: ready.storyboardId,
    operationId: 'generate_edit_script_storyboard_panels',
    operationSource: 'project-ui',
    requestId: input.requestId || null,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        editScriptId,
        storyboardId: ready.storyboardId,
        sourceSnapshot,
        modelConfigSnapshot,
      },
    }),
    dedupeKey: `edit_script_storyboard_camera_plan:${ready.storyboardId}`,
  })
  return {
    ...submitted,
    storyboardId: ready.storyboardId,
  }
}
