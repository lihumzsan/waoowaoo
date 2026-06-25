import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import type { ProjectProjectionFull, ProjectProjectionPanelSnapshot } from './types'

function toIso(value: Date): string {
  return value.toISOString()
}

function isVideoGenerationOptions(value: unknown): value is Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) =>
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
  )
}

export async function assembleProjectProjectionFull(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  selectedScopeRef?: string | null
  panelLimit?: number | null
  scope?: {
    storyboardId?: string | null
    panelId?: string | null
  } | null
}): Promise<ProjectProjectionFull> {
  const panelLimit = Math.max(1, Math.min(1000, params.panelLimit ?? 300))
  const base = await assembleProjectProjectionLite({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId || null,
    selectedScopeRef: params.selectedScopeRef || null,
  })

  const episodeId = base.episodeId || null
  if (!episodeId) {
    return {
      ...base,
      episodeDetail: null,
    }
  }

  const scopedStoryboardId = params.scope?.storyboardId || null
  const scopedPanelId = params.scope?.panelId || null

  const filters: Prisma.ProjectPanelWhereInput[] = [
    { storyboard: { episodeId } },
  ]
  if (scopedPanelId) {
    filters.push({ id: scopedPanelId })
  }
  if (scopedStoryboardId) {
    filters.push({ storyboardId: scopedStoryboardId })
  }
  const panelWhere: Prisma.ProjectPanelWhereInput = filters.length === 1 ? filters[0] : { AND: filters }

  const [matchingPanelCount, panelRows] = await Promise.all([
    prisma.projectPanel.count({ where: panelWhere }),
    prisma.projectPanel.findMany({
      where: panelWhere,
      orderBy: [
        { storyboardId: 'asc' },
        { panelIndex: 'asc' },
      ],
      take: panelLimit,
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        panelNumber: true,
        shotType: true,
        cameraMove: true,
        description: true,
        location: true,
        characters: true,
        props: true,
        duration: true,
        imagePrompt: true,
        imageUrl: true,
        imageMediaId: true,
        candidateImages: true,
        videoPrompt: true,
        videoUrl: true,
        lastVideoGenerationOptions: true,
        videoMediaId: true,
        createdAt: true,
        updatedAt: true,
        storyboard: {
          select: {
            editScriptId: true,
          },
        },
      },
    }),
  ])

  const panels: ProjectProjectionPanelSnapshot[] = []
  for (const panel of panelRows) {
    panels.push({
      panelId: panel.id,
      editScriptId: panel.storyboard.editScriptId,
      storyboardId: panel.storyboardId,
      panelIndex: panel.panelIndex,
      panelNumber: panel.panelNumber ?? null,
      shotType: panel.shotType ?? null,
      cameraMove: panel.cameraMove ?? null,
      description: panel.description ?? null,
      location: panel.location ?? null,
      characters: panel.characters ?? null,
      props: panel.props ?? null,
      duration: panel.duration ?? null,
      imagePrompt: panel.imagePrompt ?? null,
      imageUrl: panel.imageUrl ?? null,
      imageMediaId: panel.imageMediaId ?? null,
      candidateImages: panel.candidateImages ?? null,
      videoPrompt: panel.videoPrompt ?? null,
      videoUrl: panel.videoUrl ?? null,
      lastVideoGenerationOptions: isVideoGenerationOptions(panel.lastVideoGenerationOptions)
        ? panel.lastVideoGenerationOptions
        : null,
      videoMediaId: panel.videoMediaId ?? null,
      createdAt: toIso(panel.createdAt),
      updatedAt: toIso(panel.updatedAt),
    })
  }

  const truncated = matchingPanelCount > panels.length

  return {
    ...base,
    episodeDetail: {
      panels,
      panelLimit,
      totalPanelCount: matchingPanelCount,
      truncated,
    },
  }
}
