import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from './types'

type TaskTargetFailure = {
  readonly type: string
  readonly targetType: string
  readonly targetId: string
  readonly errorCode: string
  readonly errorMessage: string
  readonly errorDetails?: Record<string, unknown> | null
}

function truncate(value: string, maxLength: number): string {
  return value.slice(0, maxLength)
}

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function syncTaskTargetFailure(input: TaskTargetFailure): Promise<void> {
  if (
    (input.type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE && input.targetType === 'ProjectEditSourceScript')
    || (input.type === TASK_TYPE.EDIT_BIBLE_GENERATE && input.targetType === 'ProjectEditBible')
  ) {
    await prisma.projectEditBible.updateMany({
      where: {
        id: input.targetId,
        status: 'generating',
      },
      data: {
        status: 'failed',
        diagnosticsJson: toInputJson(input.errorDetails ?? { error: truncate(input.errorMessage, 2000) }),
      },
    })
    return
  }

  if (input.type === TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE && input.targetType === 'ProjectEditStylePreview') {
    await prisma.projectEditStylePreview.updateMany({
      where: {
        id: input.targetId,
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

  await prisma.projectVideoGroup.updateMany({
    where: {
      id: input.targetId,
    },
    data: {
      status: 'failed',
      taskId: null,
      errorCode: truncate(input.errorCode, 80),
      errorMessage: truncate(input.errorMessage, 2000),
    },
  })
}
