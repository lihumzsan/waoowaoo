import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

type VideoGenerationMode = 'normal' | 'firstlastframe'

function parsePanelIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return null
}

function readTaskVideoUrl(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const raw = (result as Record<string, unknown>).videoUrl
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function readTaskGenerationMode(payload: unknown, result: unknown): VideoGenerationMode {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const raw = (result as Record<string, unknown>).generationMode
    if (raw === 'firstlastframe' || raw === 'normal') return raw
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const firstLastFrame = (payload as Record<string, unknown>).firstLastFrame
    if (firstLastFrame && typeof firstLastFrame === 'object' && !Array.isArray(firstLastFrame)) {
      return 'firstlastframe'
    }
  }
  return 'normal'
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

  const currentVideoUrl = typeof panel.videoUrl === 'string' && panel.videoUrl.trim() ? panel.videoUrl.trim() : null
  const previousTask = completedVideoTasks.find((task) => {
    const taskVideoUrl = readTaskVideoUrl(task.result)
    if (!taskVideoUrl) return false
    if (!currentVideoUrl) return true
    return taskVideoUrl !== currentVideoUrl
  })

  if (!previousTask) {
    throw new ApiError('CONFLICT', { message: 'VIDEO_PREVIOUS_NOT_FOUND' })
  }

  const restoredVideoUrl = readTaskVideoUrl(previousTask.result)
  if (!restoredVideoUrl) {
    throw new ApiError('CONFLICT', { message: 'VIDEO_PREVIOUS_NOT_FOUND' })
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
