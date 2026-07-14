import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'

const ACTIVE_REPLAN_BLOCKING_STATUSES = ['queued', 'processing'] as const

export async function assertChapterReplanHasNoRunningVideoSegments(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
}): Promise<void> {
  const videoSegments = await prisma.projectVideoSegment.findMany({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      chapterId: input.chapterId,
    },
    select: {
      id: true,
      status: true,
    },
  })
  const activeSegment = videoSegments.find((segment) =>
    ACTIVE_REPLAN_BLOCKING_STATUSES.some((status) => status === segment.status))
  if (activeSegment) {
    throw new Error(`EDIT_SCRIPT_REPLAN_VIDEO_SEGMENT_RUNNING:${activeSegment.id}:${activeSegment.status}`)
  }

  if (videoSegments.length === 0) return
  const activeTask = await prisma.task.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: TASK_TYPE.VIDEO_SEGMENT,
      targetType: 'ProjectVideoSegment',
      targetId: { in: videoSegments.map((segment) => segment.id) },
      status: { in: [...ACTIVE_REPLAN_BLOCKING_STATUSES] },
    },
    select: {
      targetId: true,
      status: true,
    },
  })
  if (activeTask) {
    throw new Error(`EDIT_SCRIPT_REPLAN_VIDEO_SEGMENT_TASK_RUNNING:${activeTask.targetId}:${activeTask.status}`)
  }
}
