import type { Prisma } from '@prisma/client'
import { getTaskDefinition } from './definition'
import type { TaskType } from './types'

type SubmittedTaskTarget = {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string | null
  readonly type: TaskType
  readonly targetType: string
  readonly targetId: string
}

/**
 * Claims the business target in the same transaction that creates its Task.
 * The worker can then only materialize a successful result for this exact
 * owner; terminal failure/cancel remains the Terminal Service's authority.
 */
export async function claimTaskTargetOwnershipInTransaction(
  tx: Prisma.TransactionClient,
  task: SubmittedTaskTarget,
): Promise<void> {
  const ownership = getTaskDefinition(task.type).submissionTargetOwnership
  if (ownership === 'none') return

  if (ownership === 'chapter_render') {
    if (task.targetType !== 'ProjectEditChapter') {
      throw new Error(`CHAPTER_RENDER_SUBMISSION_TARGET_INVALID:${task.targetType}`)
    }
    if (!task.episodeId) throw new Error(`CHAPTER_RENDER_SUBMISSION_EPISODE_REQUIRED:${task.id}`)
    const claimed = await tx.projectEditChapter.updateMany({
      where: {
        id: task.targetId,
        episodeId: task.episodeId,
        episode: { projectId: task.projectId },
      },
      data: {
        renderTaskId: task.id,
        renderStatus: 'processing',
      },
    })
    if (claimed.count !== 1) {
      throw new Error(`CHAPTER_RENDER_SUBMISSION_TARGET_NOT_FOUND:${task.targetId}:${task.episodeId}`)
    }
    return
  }

  if (ownership === 'final_video_render') {
    if (task.targetType !== 'ProjectEpisode' || task.targetId !== task.episodeId) {
      throw new Error(`FINAL_VIDEO_RENDER_SUBMISSION_TARGET_INVALID:${task.targetType}:${task.targetId}:${task.episodeId ?? ''}`)
    }
    const episode = await tx.projectEpisode.findFirst({
      where: { id: task.targetId, projectId: task.projectId },
      select: { id: true },
    })
    if (!episode) throw new Error(`FINAL_VIDEO_RENDER_SUBMISSION_TARGET_NOT_FOUND:${task.targetId}`)

    const claimed = await tx.projectEpisodeFinalOutput.updateMany({
      where: { episodeId: task.targetId },
      data: {
        renderTaskId: task.id,
        renderStatus: 'processing',
      },
    })
    if (claimed.count === 1) return

    await tx.projectEpisodeFinalOutput.create({
      data: {
        episodeId: task.targetId,
        renderTaskId: task.id,
        renderStatus: 'processing',
      },
    })
    return
  }

  const exhaustive: never = ownership
  throw new Error(`TASK_SUBMISSION_TARGET_OWNERSHIP_UNSUPPORTED:${exhaustive}`)
}
