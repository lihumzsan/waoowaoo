import { ApiError } from '@/lib/api-errors'
import type { Locale } from '@/i18n/routing'
import { TASK_TYPE } from '@/lib/task/types'
import { submitTask } from '@/lib/task/submitter'
import { prisma } from '@/lib/prisma'
import { buildStoryboardConsistencySource } from './source-snapshot'
import { buildEditFirstTextTaskPayload } from '@/lib/edit-script/task-billing'

interface SubmitEditScriptStoryboardInput {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly editScriptId?: string
  readonly userId: string
  readonly locale: Locale
  readonly requestId?: string | null
}

async function resolveEditScriptId(input: Pick<SubmitEditScriptStoryboardInput, 'projectId' | 'episodeId' | 'chapterId' | 'editScriptId'>): Promise<string> {
  if (input.editScriptId) {
    const editScript = await prisma.projectEditScript.findFirst({
      where: {
        id: input.editScriptId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      },
      select: { id: true },
    })
    if (!editScript?.id) throw new ApiError('NOT_FOUND')
    return editScript.id
  }
  const editScript = await prisma.projectEditScript.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (!editScript?.id) throw new ApiError('NOT_FOUND')
  return editScript.id
}

export async function submitEditScriptStoryboardPanels(input: SubmitEditScriptStoryboardInput) {
  const editScriptId = await resolveEditScriptId(input)
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
    targetType: 'ProjectEditScript',
    targetId: editScriptId,
    operationId: 'generate_edit_script_storyboard',
    operationSource: 'project-ui',
    requestId: input.requestId || null,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        editScriptId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        sourceSnapshot,
        modelConfigSnapshot,
      },
    }),
    dedupeKey: `edit_script_storyboard:${input.projectId}:${input.episodeId}:${editScriptId}`,
  })
  return {
    ...submitted,
    editScriptId,
  }
}
