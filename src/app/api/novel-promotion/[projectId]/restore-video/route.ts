import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import {
  findPreviousCompletedVideoTask,
  readTaskGenerationMode,
  readTaskVideoUrl,
} from '@/lib/novel-promotion/video-restore-history'

function parsePanelIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return null
}

async function findPanelForProject(projectId: string, body: Record<string, unknown>) {
  const panelId = typeof body.panelId === 'string' && body.panelId.trim() ? body.panelId.trim() : null
  const storyboardId = typeof body.storyboardId === 'string' && body.storyboardId.trim() ? body.storyboardId.trim() : null
  const panelIndex = parsePanelIndex(body.panelIndex)

  if (!panelId && (!storyboardId || panelIndex === null)) {
    throw new ApiError('INVALID_PARAMS')
  }

  return await prisma.novelPromotionPanel.findFirst({
    where: {
      ...(panelId ? { id: panelId } : { storyboardId: storyboardId!, panelIndex: panelIndex! }),
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId,
          },
        },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      videoUrl: true,
    },
  })
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const panel = await findPanelForProject(projectId, body)
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const completedVideoTasks = await prisma.task.findMany({
    where: {
      projectId,
      type: TASK_TYPE.VIDEO_PANEL,
      status: TASK_STATUS.COMPLETED,
      targetType: 'NovelPromotionPanel',
      targetId: panel.id,
    },
    orderBy: [
      { finishedAt: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      payload: true,
      result: true,
    },
  })

  const previousTask = findPreviousCompletedVideoTask(panel.videoUrl, completedVideoTasks)

  if (!previousTask) {
    throw new ApiError('CONFLICT', { message: '没有可恢复的上一版视频' })
  }

  const restoredVideoUrl = readTaskVideoUrl(previousTask.result)
  if (!restoredVideoUrl) {
    throw new ApiError('CONFLICT', { message: '没有可恢复的上一版视频' })
  }

  const restoredGenerationMode = readTaskGenerationMode(previousTask.payload, previousTask.result)

  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      videoUrl: restoredVideoUrl,
      videoGenerationMode: restoredGenerationMode,
      videoMediaId: null,
      lipSyncTaskId: null,
      lipSyncVideoUrl: null,
      lipSyncVideoMediaId: null,
    },
  })

  return NextResponse.json({
    success: true,
    panelId: panel.id,
    videoUrl: restoredVideoUrl,
    videoGenerationMode: restoredGenerationMode,
    restoredFromTaskId: previousTask.id,
  })
})
