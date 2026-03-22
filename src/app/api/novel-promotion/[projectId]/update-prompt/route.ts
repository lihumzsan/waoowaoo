import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const shotId = typeof body?.shotId === 'string' ? body.shotId : ''
  const panelId = typeof body?.panelId === 'string' ? body.panelId : ''
  const field = body?.field as 'imagePrompt' | 'videoPrompt' | undefined
  const value = typeof body?.value === 'string' ? body.value : null

  if (field !== 'imagePrompt' && field !== 'videoPrompt') {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!shotId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const shot = await prisma.novelPromotionShot.findFirst({
    where: {
      id: shotId,
      episode: {
        novelPromotionProject: {
          projectId,
        },
      },
    },
    select: {
      id: true,
      shotId: true,
      episodeId: true,
      clipId: true,
    },
  })

  if (!shot) {
    throw new ApiError('NOT_FOUND')
  }

  const updatedShot = await prisma.novelPromotionShot.update({
    where: { id: shotId },
    data: { [field]: value },
  })

  // Keep panel prompt in sync so storyboard image generation reads latest prompt.
  let syncedPanelCount = 0
  const panelSyncWhereList: Prisma.NovelPromotionPanelWhereInput[] = []

  if (panelId) {
    panelSyncWhereList.push({
      id: panelId,
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId,
          },
        },
      },
    })
  } else {
    const parsedPanelNumber = Number.parseInt(shot.shotId, 10)
    if (Number.isFinite(parsedPanelNumber)) {
      if (shot.clipId) {
        panelSyncWhereList.push({
          panelNumber: parsedPanelNumber,
          storyboard: {
            clipId: shot.clipId,
          },
        })
      }

      panelSyncWhereList.push({
        panelNumber: parsedPanelNumber,
        storyboard: {
          episodeId: shot.episodeId,
        },
      })
    }
  }

  for (const where of panelSyncWhereList) {
    const result = await prisma.novelPromotionPanel.updateMany({
      where,
      data: { [field]: value },
    })
    syncedPanelCount = result.count
    if (syncedPanelCount > 0) break
  }

  return NextResponse.json({ success: true, shot: updatedShot, syncedPanelCount })
})
