import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from './types'

type TaskTargetFailure = {
  readonly taskId: string
  readonly type: string
  readonly targetType: string
  readonly targetId: string
  readonly errorCode: string
  readonly errorMessage: string
  readonly errorDetails?: Record<string, unknown> | null
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

export async function syncTaskTargetFailureInTransaction(
  tx: Prisma.TransactionClient,
  input: TaskTargetFailure,
): Promise<void> {
  // ProjectEditBible currently has no task ownership field. An unfenced failure
  // projector could overwrite a newer generation, so it is intentionally not
  // projected until the resource contract carries a generation task identity.
  if (
    input.type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE
    || input.type === TASK_TYPE.EDIT_BIBLE_GENERATE
  ) {
    return
  }

  if (input.type === TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE && input.targetType === 'ProjectEditStylePreview') {
    await tx.projectEditStylePreview.updateMany({
      where: {
        id: input.targetId,
        taskId: input.taskId,
        status: { in: ['pending', 'generating'] },
      },
      data: {
        status: 'failed',
        errorMessage: truncate(input.errorMessage, 2000),
      },
    })
    return
  }

  if (input.type !== TASK_TYPE.VIDEO_GROUP || input.targetType !== 'ProjectVideoGroup') return

  await tx.projectVideoGroup.updateMany({
      where: {
        id: input.targetId,
        taskId: input.taskId,
        status: { in: ['pending', 'generating', 'processing'] },
    },
    data: {
      status: 'failed',
      taskId: null,
      errorCode: truncate(input.errorCode, 80),
      errorMessage: truncate(input.errorMessage, 2000),
    },
  })
}

export async function syncTaskTargetFailure(input: TaskTargetFailure): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await syncTaskTargetFailureInTransaction(tx, input)
  })
}
