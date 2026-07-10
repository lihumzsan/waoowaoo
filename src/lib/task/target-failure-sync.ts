import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE, type TaskType } from './types'
import { getTaskDefinition, type TaskTargetTerminalProjector } from './definition'

export type TaskTargetTerminalKind = 'completed' | 'failed' | 'canceled'

export type TaskTargetTerminalProjection = {
  readonly kind: TaskTargetTerminalKind
  readonly taskId: string
  readonly type: TaskType
  readonly targetType: string
  readonly targetId: string
  readonly errorCode?: string | null
  readonly errorMessage?: string | null
  readonly errorDetails?: Record<string, unknown> | null
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function requireFailure(input: TaskTargetTerminalProjection): {
  errorCode: string
  errorMessage: string
} {
  if (input.kind !== 'failed' || !input.errorCode || !input.errorMessage) {
    throw new Error(`TASK_TARGET_FAILURE_DIAGNOSTIC_REQUIRED:${input.taskId}`)
  }
  return { errorCode: input.errorCode, errorMessage: input.errorMessage }
}

function resolveProjector(input: TaskTargetTerminalProjection): TaskTargetTerminalProjector {
  const definition = getTaskDefinition(input.type)
  if (input.kind === 'completed') {
    if (definition.terminalSuccessHandoff !== 'handler_result_checkpoint') {
      throw new Error(`TASK_SUCCESS_HANDOFF_UNSUPPORTED:${input.type}:${definition.terminalSuccessHandoff}`)
    }
    return 'none'
  }
  return input.kind === 'failed'
    ? definition.terminalFailureProjector
    : definition.terminalCancelProjector
}

async function assertBibleCasNotLost(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  const owner = await tx.projectEditBible.findUnique({
    where: { id: input.targetId },
    select: { generationTaskId: true, status: true },
  })
  if (owner?.generationTaskId === input.taskId && owner.status === 'generating') {
    throw new Error(`EDIT_BIBLE_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
}

async function projectEditBible(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  const expectedTargetType = input.type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE
    ? 'ProjectEditSourceScript'
    : 'ProjectEditBible'
  if (input.targetType !== expectedTargetType) {
    throw new Error(`EDIT_BIBLE_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const data: Prisma.ProjectEditBibleUpdateManyMutationInput = input.kind === 'failed'
    ? (() => {
        const failure = requireFailure(input)
        return {
          status: 'failed',
          diagnosticsJson: {
            code: truncate(failure.errorCode, 80),
            message: truncate(failure.errorMessage, 2000),
            ...(input.errorDetails ? { details: input.errorDetails } : {}),
          } as Prisma.InputJsonValue,
        }
      })()
    : {
        status: 'pending',
        generationTaskId: null,
        diagnosticsJson: Prisma.JsonNull,
      }
  const projected = await tx.projectEditBible.updateMany({
    where: {
      id: input.targetId,
      generationTaskId: input.taskId,
      status: 'generating',
    },
    data,
  })
  if (projected.count === 0) await assertBibleCasNotLost(tx, input)
}

async function projectStylePreview(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  if (input.targetType !== 'ProjectEditStylePreview') {
    throw new Error(`EDIT_STYLE_PREVIEW_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const projected = await tx.projectEditStylePreview.updateMany({
    where: {
      id: input.targetId,
      taskId: input.taskId,
      status: { in: ['pending', 'generating'] },
    },
    data: input.kind === 'failed'
      ? { status: 'failed', errorMessage: truncate(requireFailure(input).errorMessage, 2000) }
      : { status: 'pending', taskId: null, errorMessage: null },
  })
  if (projected.count === 0) {
    const owner = await tx.projectEditStylePreview.findUnique({
      where: { id: input.targetId },
      select: { taskId: true, status: true },
    })
    if (owner?.taskId === input.taskId && (owner.status === 'pending' || owner.status === 'generating')) {
      throw new Error(`EDIT_STYLE_PREVIEW_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
    }
  }
}

async function projectVideoGroup(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  if (input.targetType !== 'ProjectVideoGroup') {
    throw new Error(`VIDEO_GROUP_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const failure = input.kind === 'failed' ? requireFailure(input) : null
  const projected = await tx.projectVideoGroup.updateMany({
    where: {
      id: input.targetId,
      taskId: input.taskId,
      status: { in: ['pending', 'generating', 'processing'] },
    },
    data: failure
      ? {
          status: 'failed',
          taskId: null,
          errorCode: truncate(failure.errorCode, 80),
          errorMessage: truncate(failure.errorMessage, 2000),
        }
      : { status: 'pending', taskId: null, errorCode: null, errorMessage: null },
  })
  if (projected.count === 0) {
    const owner = await tx.projectVideoGroup.findUnique({
      where: { id: input.targetId },
      select: { taskId: true, status: true },
    })
    if (
      owner?.taskId === input.taskId
      && (owner.status === 'pending' || owner.status === 'generating' || owner.status === 'processing')
    ) {
      throw new Error(`VIDEO_GROUP_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
    }
  }
}

async function projectChapterRender(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  if (input.targetType !== 'ProjectEditChapter') {
    throw new Error(`CHAPTER_RENDER_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const projected = await tx.projectEditChapter.updateMany({
    where: {
      id: input.targetId,
      renderTaskId: input.taskId,
      renderStatus: 'processing',
    },
    data: input.kind === 'failed'
      ? { renderStatus: 'failed' }
      : { renderStatus: null, renderTaskId: null },
  })
  if (projected.count === 0) {
    const owner = await tx.projectEditChapter.findUnique({
      where: { id: input.targetId },
      select: { renderTaskId: true, renderStatus: true },
    })
    if (owner?.renderTaskId === input.taskId && owner.renderStatus === 'processing') {
      throw new Error(`CHAPTER_RENDER_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
    }
  }
}

async function projectFinalVideoRender(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  if (input.targetType !== 'ProjectEpisode') {
    throw new Error(`FINAL_VIDEO_RENDER_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const projected = await tx.projectEpisodeFinalOutput.updateMany({
    where: {
      episodeId: input.targetId,
      renderTaskId: input.taskId,
      renderStatus: 'processing',
    },
    data: input.kind === 'failed'
      ? { renderStatus: 'failed' }
      : { renderStatus: null, renderTaskId: null },
  })
  if (projected.count === 0) {
    const owner = await tx.projectEpisodeFinalOutput.findUnique({
      where: { episodeId: input.targetId },
      select: { renderTaskId: true, renderStatus: true },
    })
    if (owner?.renderTaskId === input.taskId && owner.renderStatus === 'processing') {
      throw new Error(`FINAL_VIDEO_RENDER_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
    }
  }
}

export async function projectTaskTargetTerminalInTransaction(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<void> {
  const projector = resolveProjector(input)
  if (projector === 'none') return
  if (input.kind === 'completed') {
    throw new Error(`TASK_SUCCESS_PROJECTOR_INVALID:${input.type}:${projector}`)
  }
  if (projector === 'edit_bible') return await projectEditBible(tx, input)
  if (projector === 'edit_style_preview') return await projectStylePreview(tx, input)
  if (projector === 'video_group') return await projectVideoGroup(tx, input)
  if (projector === 'chapter_render') return await projectChapterRender(tx, input)
  if (projector === 'final_video_render') return await projectFinalVideoRender(tx, input)
  const exhaustive: never = projector
  throw new Error(`TASK_TERMINAL_PROJECTOR_UNSUPPORTED:${input.type}:${String(exhaustive)}`)
}

export async function syncTaskTargetFailureInTransaction(
  tx: Prisma.TransactionClient,
  input: Omit<TaskTargetTerminalProjection, 'kind'>,
): Promise<void> {
  await projectTaskTargetTerminalInTransaction(tx, { ...input, kind: 'failed' })
}

export async function syncTaskTargetFailure(
  input: Omit<TaskTargetTerminalProjection, 'kind'>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await syncTaskTargetFailureInTransaction(tx, input)
  })
}
