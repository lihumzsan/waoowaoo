import type { NextRequest } from 'next/server'
import type { Locale } from '@/i18n/routing'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { TASK_TYPE } from '@/lib/task/types'
import { buildEditFirstTextTaskPayload } from '@/lib/edit-script/task-billing'

interface SubmitPromptComposerInput {
  readonly request: NextRequest
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId?: string
  readonly userId: string
  readonly source: string
  readonly confirmed: boolean
  readonly locale: Locale
}

async function resolveEditScriptId(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId?: string
}): Promise<string> {
  const editScript = await prisma.projectEditScript.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      ...(input.editScriptId ? { id: input.editScriptId } : {}),
      status: 'ready',
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (!editScript) {
    throw new ApiError('NOT_FOUND', {
      code: 'EDIT_SCRIPT_READY_REQUIRED',
      message: 'A ready edit script is required before composing prompts',
    })
  }
  return editScript.id
}

async function submitPromptComposerTask(input: SubmitPromptComposerInput & {
  readonly taskType: typeof TASK_TYPE.EDIT_IMAGE_PROMPT_COMPOSE | typeof TASK_TYPE.EDIT_VIDEO_PROMPT_COMPOSE
  readonly operationId: 'compose_edit_image_prompts' | 'compose_edit_video_prompts'
  readonly dedupePrefix: string
}) {
  const editScriptId = await resolveEditScriptId(input)
  const result = await submitOperationTask({
    request: input.request,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId,
    type: input.taskType,
    targetType: 'ProjectEditScript',
    targetId: editScriptId,
    operationId: input.operationId,
    source: input.source,
    confirmed: input.confirmed,
    payload: await buildEditFirstTextTaskPayload({
      projectId: input.projectId,
      userId: input.userId,
      payload: {
        episodeId: input.episodeId,
        editScriptId,
        displayMode: 'detail',
      },
    }),
    dedupeKey: `${input.dedupePrefix}:${input.projectId}:${input.episodeId}:${editScriptId}`,
    locale: input.locale,
  })
  return {
    ...result,
    episodeId: input.episodeId,
    editScriptId,
    taskType: input.taskType,
    targetType: 'ProjectEditScript' as const,
    targetId: editScriptId,
  }
}

export async function submitEditImagePromptComposeTask(input: SubmitPromptComposerInput) {
  return await submitPromptComposerTask({
    ...input,
    taskType: TASK_TYPE.EDIT_IMAGE_PROMPT_COMPOSE,
    operationId: 'compose_edit_image_prompts',
    dedupePrefix: 'edit_image_prompt_compose',
  })
}

export async function submitEditVideoPromptComposeTask(input: SubmitPromptComposerInput) {
  return await submitPromptComposerTask({
    ...input,
    taskType: TASK_TYPE.EDIT_VIDEO_PROMPT_COMPOSE,
    operationId: 'compose_edit_video_prompts',
    dedupePrefix: 'edit_video_prompt_compose',
  })
}
