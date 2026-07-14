import { Prisma } from '@prisma/client'
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

export type TaskTargetTerminalProjectionResult = 'applied' | 'stale_owner' | 'success_materialized'

function truncate(value: string, maxLength: number): string {
  return value.slice(0, maxLength)
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
  return input.kind === 'failed' ? definition.terminalFailureProjector : definition.terminalCancelProjector
}

async function assertBibleCasNotLost(tx: Prisma.TransactionClient, input: TaskTargetTerminalProjection): Promise<void> {
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
): Promise<TaskTargetTerminalProjectionResult> {
  const expectedTargetType =
    input.type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE ? 'ProjectEditSourceScript' : 'ProjectEditBible'
  if (input.targetType !== expectedTargetType) {
    throw new Error(`EDIT_BIBLE_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const data: Prisma.ProjectEditBibleUpdateManyMutationInput =
    input.kind === 'failed'
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
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditBible.findUnique({
    where: { id: input.targetId },
    select: { generationTaskId: true, status: true },
  })
  if (owner?.generationTaskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'script_ready_for_review' || owner.status === 'ready_for_review') {
    return 'success_materialized'
  }
  await assertBibleCasNotLost(tx, input)
  throw new Error(
    `EDIT_BIBLE_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

async function projectStylePreview(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectEditStylePreview') {
    throw new Error(`EDIT_STYLE_PREVIEW_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const projected = await tx.projectEditStylePreview.updateMany({
    where: {
      id: input.targetId,
      taskId: input.taskId,
      status: { in: ['pending', 'generating'] },
    },
    data:
      input.kind === 'failed'
        ? {
            status: 'failed',
            errorMessage: truncate(requireFailure(input).errorMessage, 2000),
          }
        : { status: 'pending', taskId: null, errorMessage: null },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditStylePreview.findUnique({
    where: { id: input.targetId },
    select: { taskId: true, status: true },
  })
  if (owner?.taskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'completed') return 'success_materialized'
  if (owner.status === 'pending' || owner.status === 'generating') {
    throw new Error(
      `EDIT_STYLE_PREVIEW_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`,
    )
  }
  throw new Error(
    `EDIT_STYLE_PREVIEW_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

async function projectVideoSegment(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectVideoSegment') {
    throw new Error(`VIDEO_SEGMENT_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const failure = input.kind === 'failed' ? requireFailure(input) : null
  const projected = await tx.projectVideoSegment.updateMany({
    where: {
      id: input.targetId,
      generationTaskId: input.taskId,
      status: { in: ['queued', 'pending', 'generating', 'processing'] },
    },
    data: failure
      ? {
          status: 'failed',
          errorCode: truncate(failure.errorCode, 80),
          errorMessage: truncate(failure.errorMessage, 2000),
        }
      : {
          status: 'pending',
          generationTaskId: null,
          errorCode: null,
          errorMessage: null,
        },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectVideoSegment.findUnique({
    where: { id: input.targetId },
    select: { generationTaskId: true, status: true },
  })
  if (owner?.generationTaskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'completed') return 'success_materialized'
  if (owner.status === 'queued' || owner.status === 'pending' || owner.status === 'generating' || owner.status === 'processing') {
    throw new Error(`VIDEO_SEGMENT_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
  throw new Error(
    `VIDEO_SEGMENT_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

async function projectChapterRender(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectEditChapter') {
    throw new Error(`CHAPTER_RENDER_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const projected = await tx.projectEditChapter.updateMany({
    where: {
      id: input.targetId,
      renderTaskId: input.taskId,
      renderStatus: 'processing',
    },
    data: input.kind === 'failed' ? { renderStatus: 'failed' } : { renderStatus: null, renderTaskId: null },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditChapter.findUnique({
    where: { id: input.targetId },
    select: { renderTaskId: true, renderStatus: true },
  })
  if (owner?.renderTaskId !== input.taskId) return 'stale_owner'
  if (owner.renderStatus === 'completed') return 'success_materialized'
  if (owner.renderStatus === 'processing') {
    throw new Error(`CHAPTER_RENDER_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
  throw new Error(
    `CHAPTER_RENDER_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.renderStatus}`,
  )
}

async function projectFinalVideoRender(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectEpisode') {
    throw new Error(`FINAL_VIDEO_RENDER_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const projected = await tx.projectEpisodeFinalOutput.updateMany({
    where: {
      episodeId: input.targetId,
      renderTaskId: input.taskId,
      renderStatus: 'processing',
    },
    data: input.kind === 'failed' ? { renderStatus: 'failed' } : { renderStatus: null, renderTaskId: null },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEpisodeFinalOutput.findUnique({
    where: { episodeId: input.targetId },
    select: { renderTaskId: true, renderStatus: true },
  })
  if (owner?.renderTaskId !== input.taskId) return 'stale_owner'
  if (owner.renderStatus === 'completed') return 'success_materialized'
  if (owner.renderStatus === 'processing') {
    throw new Error(
      `FINAL_VIDEO_RENDER_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`,
    )
  }
  throw new Error(
    `FINAL_VIDEO_RENDER_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.renderStatus}`,
  )
}

async function projectMusicScore(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (
    input.targetType !== 'ProjectEpisode'
    || input.type !== TASK_TYPE.MUSIC_SCORE_GENERATE
  ) {
    throw new Error(`MUSIC_SCORE_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const activeStatus = 'generating'
  const canceledStatus = 'pending'
  const failure = input.kind === 'failed' ? requireFailure(input) : null
  const projected = await tx.projectEditMusicScore.updateMany({
    where: {
      episodeId: input.targetId,
      taskId: input.taskId,
      status: activeStatus,
    },
    data: failure
      ? {
          status: 'failed',
          diagnosticsJson: {
            errorCode: truncate(failure.errorCode, 80),
            errorMessage: truncate(failure.errorMessage, 2_000),
          } as Prisma.InputJsonValue,
        }
      : {
          status: canceledStatus,
          taskId: null,
          diagnosticsJson: Prisma.JsonNull,
        },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditMusicScore.findUnique({
    where: { episodeId: input.targetId },
    select: { taskId: true, status: true },
  })
  if (owner?.taskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'completed') return 'success_materialized'
  if (owner.status === activeStatus) {
    throw new Error(`MUSIC_SCORE_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
  throw new Error(
    `MUSIC_SCORE_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

async function projectAmbientSound(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (
    input.targetType !== 'ProjectEpisode' ||
    input.type !== TASK_TYPE.AMBIENT_SOUND_GENERATE
  ) {
    throw new Error(`AMBIENT_SOUND_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const activeStatuses = ['generating']
  const failure = input.kind === 'failed' ? requireFailure(input) : null
  const canceledStatus = 'pending'
  const projected = await tx.projectEditAmbientSound.updateMany({
    where: {
      episodeId: input.targetId,
      taskId: input.taskId,
      status: { in: activeStatuses },
    },
    data: failure
      ? {
          status: 'failed',
          diagnosticsJson: {
            errorCode: truncate(failure.errorCode, 80),
            errorMessage: truncate(failure.errorMessage, 2_000),
          } as Prisma.InputJsonValue,
        }
      : {
          status: canceledStatus,
          taskId: null,
          diagnosticsJson: Prisma.JsonNull,
        },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditAmbientSound.findUnique({
    where: { episodeId: input.targetId },
    select: { taskId: true, status: true },
  })
  if (owner?.taskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'completed') return 'success_materialized'
  if (activeStatuses.includes(owner.status)) {
    throw new Error(`AMBIENT_SOUND_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
  throw new Error(
    `AMBIENT_SOUND_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

async function projectAudioDesign(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectEpisode' || input.type !== TASK_TYPE.AUDIO_DESIGN_PLAN) {
    throw new Error(`AUDIO_DESIGN_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const failure = input.kind === 'failed' ? requireFailure(input) : null
  const projected = await tx.projectEditAudioDesign.updateMany({
    where: { episodeId: input.targetId, taskId: input.taskId, status: 'planning' },
    data: failure
      ? {
          status: 'failed',
          diagnosticsJson: {
            errorCode: truncate(failure.errorCode, 80),
            errorMessage: truncate(failure.errorMessage, 2_000),
          } as Prisma.InputJsonValue,
        }
      : {
          status: 'pending',
          taskId: null,
          diagnosticsJson: Prisma.JsonNull,
        },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditAudioDesign.findUnique({
    where: { episodeId: input.targetId },
    select: { taskId: true, status: true },
  })
  if (owner?.taskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'planned') return 'success_materialized'
  if (owner.status === 'planning') {
    throw new Error(`AUDIO_DESIGN_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
  throw new Error(`AUDIO_DESIGN_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`)
}

async function projectEditScript(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectEditChapter' || input.type !== TASK_TYPE.EDIT_SCRIPT_GENERATE) {
    throw new Error(`EDIT_SCRIPT_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`)
  }
  const failure = input.kind === 'failed' ? requireFailure(input) : null
  const projected = await tx.projectEditScript.updateMany({
    where: {
      chapterId: input.targetId,
      generationTaskId: input.taskId,
      status: 'generating',
    },
    data: failure ? { status: 'failed' } : { status: 'pending', generationTaskId: null },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditScript.findUnique({
    where: { chapterId: input.targetId },
    select: { generationTaskId: true, status: true },
  })
  if (owner?.generationTaskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'ready') return 'success_materialized'
  if (owner.status === 'generating') {
    throw new Error(`EDIT_SCRIPT_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`)
  }
  throw new Error(
    `EDIT_SCRIPT_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

async function projectEditShotExecutionPlan(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  if (input.targetType !== 'ProjectEditScript' || input.type !== TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE) {
    throw new Error(
      `EDIT_SHOT_EXECUTION_PLAN_${input.kind.toUpperCase()}_TARGET_INVALID:${input.type}:${input.targetType}`,
    )
  }
  const projected = await tx.projectEditShotExecutionPlan.updateMany({
    where: {
      editScriptId: input.targetId,
      generationTaskId: input.taskId,
      status: 'generating',
    },
    data: input.kind === 'failed' ? { status: 'failed' } : { status: 'pending', generationTaskId: null },
  })
  if (projected.count === 1) return 'applied'
  const owner = await tx.projectEditShotExecutionPlan.findUnique({
    where: { editScriptId: input.targetId },
    select: { generationTaskId: true, status: true },
  })
  if (owner?.generationTaskId !== input.taskId) return 'stale_owner'
  if (owner.status === 'ready') return 'success_materialized'
  if (owner.status === 'generating') {
    throw new Error(
      `EDIT_SHOT_EXECUTION_PLAN_${input.kind.toUpperCase()}_PROJECTOR_CAS_FAILED:${input.targetId}:${input.taskId}`,
    )
  }
  throw new Error(
    `EDIT_SHOT_EXECUTION_PLAN_${input.kind.toUpperCase()}_PROJECTOR_STATE_INVALID:${input.targetId}:${input.taskId}:${owner.status}`,
  )
}

export async function projectTaskTargetTerminalInTransaction(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  const projector = resolveProjector(input)
  if (projector === 'none') return 'applied'
  if (input.kind === 'completed') {
    throw new Error(`TASK_SUCCESS_PROJECTOR_INVALID:${input.type}:${projector}`)
  }
  if (projector === 'edit_bible') return await projectEditBible(tx, input)
  if (projector === 'edit_style_preview') return await projectStylePreview(tx, input)
  if (projector === 'video_segment') return await projectVideoSegment(tx, input)
  if (projector === 'chapter_render') return await projectChapterRender(tx, input)
  if (projector === 'final_video_render') return await projectFinalVideoRender(tx, input)
  if (projector === 'music_score') return await projectMusicScore(tx, input)
  if (projector === 'ambient_sound') return await projectAmbientSound(tx, input)
  if (projector === 'audio_design') return await projectAudioDesign(tx, input)
  if (projector === 'edit_script') return await projectEditScript(tx, input)
  if (projector === 'edit_shot_execution_plan') return await projectEditShotExecutionPlan(tx, input)
  const exhaustive: never = projector
  throw new Error(`TASK_TERMINAL_PROJECTOR_UNSUPPORTED:${input.type}:${String(exhaustive)}`)
}
