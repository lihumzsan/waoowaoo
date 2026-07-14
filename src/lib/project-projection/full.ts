import { prisma } from '@/lib/prisma'
import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import type { ProjectProjectionFull } from './types'

export async function assembleProjectProjectionFull(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  selectedScopeRef?: string | null
  segmentId?: string | null
}): Promise<ProjectProjectionFull> {
  const base = await assembleProjectProjectionLite({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId ?? null,
    selectedScopeRef: params.selectedScopeRef ?? null,
  })
  if (!base.episodeId) return { ...base, episodeDetail: null }

  const rows = await prisma.projectVideoSegment.findMany({
    where: {
      projectId: params.projectId,
      episodeId: base.episodeId,
      ...(params.segmentId ? { segmentId: params.segmentId } : {}),
    },
    orderBy: [
      { chapter: { chapterIndex: 'asc' } },
      { segmentId: 'asc' },
    ],
    select: {
      id: true,
      editScriptId: true,
      chapterId: true,
      segmentId: true,
      inputSignature: true,
      durationSec: true,
      status: true,
      generationTaskId: true,
      errorMessage: true,
      videoMediaId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return {
    ...base,
    episodeDetail: {
      videoSegments: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    },
  }
}
