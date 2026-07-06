import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'

const ACTIVE_REPLAN_BLOCKING_STATUSES = ['queued', 'processing'] as const

export async function assertChapterReplanHasNoRunningVideoGroups(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId: string
}): Promise<void> {
  const videoGroups = await prisma.projectVideoGroup.findMany({
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
  const activeGroup = videoGroups.find((group) =>
    ACTIVE_REPLAN_BLOCKING_STATUSES.some((status) => status === group.status))
  if (activeGroup) {
    throw new Error(`EDIT_SCRIPT_REPLAN_VIDEO_GROUP_RUNNING:${activeGroup.id}:${activeGroup.status}`)
  }

  if (videoGroups.length === 0) return
  const activeTask = await prisma.task.findFirst({
    where: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: { in: videoGroups.map((group) => group.id) },
      status: { in: [...ACTIVE_REPLAN_BLOCKING_STATUSES] },
    },
    select: {
      targetId: true,
      status: true,
    },
  })
  if (activeTask) {
    throw new Error(`EDIT_SCRIPT_REPLAN_VIDEO_GROUP_TASK_RUNNING:${activeTask.targetId}:${activeTask.status}`)
  }
}
