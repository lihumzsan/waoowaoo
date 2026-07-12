import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { sha256Hex } from '@/lib/media/hash'
import {
  buildFirstLastFramePromptFingerprintInput,
  getFirstLastFramePromptTimingInput,
} from './first-last-frame-prompt-fingerprint'

export type FirstLastFramePromptReason = 'link' | 'source_change' | 'manual'

export type FirstLastFramePromptValidationCode =
  | 'PANEL_NOT_FOUND'
  | 'PROJECT_MISMATCH'
  | 'EPISODE_MISMATCH'
  | 'EPISODE_NOT_FOUND'
  | 'PANELS_NOT_ADJACENT'
  | 'LINK_REMOVED'

export class FirstLastFramePromptValidationError extends Error {
  constructor(
    public readonly code: FirstLastFramePromptValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'FirstLastFramePromptValidationError'
  }
}

async function queryPanels(
  db: Prisma.TransactionClient,
  firstPanelId: string,
  lastPanelId: string,
) {
  return await db.novelPromotionPanel.findMany({
    where: { id: { in: [firstPanelId, lastPanelId] } },
    include: {
      imageMedia: true,
      storyboard: {
        include: {
          episode: {
            include: { novelPromotionProject: true },
          },
        },
      },
    },
  })
}

export type FirstLastFramePanel = Awaited<ReturnType<typeof queryPanels>>[number]

export function buildFirstLastFramePromptFingerprint(
  firstPanel: Record<string, unknown>,
  lastPanel: Record<string, unknown>,
) {
  return sha256Hex(JSON.stringify(buildFirstLastFramePromptFingerprintInput({ firstPanel, lastPanel })))
}

export function getFirstLastFramePromptTiming(firstPanel: Record<string, unknown>) {
  return getFirstLastFramePromptTimingInput(firstPanel)
}

export async function loadAdjacentFirstLastFramePanels(params: {
  projectId: string
  firstPanelId: string
  lastPanelId: string
  episodeId?: string | null
  requireLinked?: boolean
  db?: Prisma.TransactionClient
}) {
  const db = params.db || (prisma as unknown as Prisma.TransactionClient)
  const panels = await queryPanels(db, params.firstPanelId, params.lastPanelId)
  const firstPanel = panels.find((panel) => panel.id === params.firstPanelId)
  const lastPanel = panels.find((panel) => panel.id === params.lastPanelId)
  if (!firstPanel || !lastPanel) {
    throw new FirstLastFramePromptValidationError('PANEL_NOT_FOUND', 'First or last panel not found')
  }

  const firstProjectId = firstPanel.storyboard.episode.novelPromotionProject.projectId
  const lastProjectId = lastPanel.storyboard.episode.novelPromotionProject.projectId
  if (firstProjectId !== params.projectId || lastProjectId !== params.projectId) {
    throw new FirstLastFramePromptValidationError(
      'PROJECT_MISMATCH',
      'First or last panel belongs to another project',
    )
  }

  const episodeId = firstPanel.storyboard.episodeId
  if (lastPanel.storyboard.episodeId !== episodeId || (params.episodeId && params.episodeId !== episodeId)) {
    throw new FirstLastFramePromptValidationError(
      'EPISODE_MISMATCH',
      'First and last panels must belong to the requested episode',
    )
  }

  const episode = await db.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: {
        orderBy: { createdAt: 'asc' },
        include: {
          storyboard: {
            include: {
              panels: { orderBy: { panelIndex: 'asc' }, select: { id: true } },
            },
          },
        },
      },
    },
  })
  if (!episode) {
    throw new FirstLastFramePromptValidationError('EPISODE_NOT_FOUND', 'Episode not found')
  }

  const orderedPanelIds = episode.clips.flatMap((clip) => clip.storyboard?.panels.map((panel) => panel.id) || [])
  const firstIndex = orderedPanelIds.indexOf(firstPanel.id)
  if (firstIndex < 0 || orderedPanelIds[firstIndex + 1] !== lastPanel.id) {
    throw new FirstLastFramePromptValidationError('PANELS_NOT_ADJACENT', 'Panels are not adjacent')
  }
  if (params.requireLinked && !firstPanel.linkedToNextPanel) {
    throw new FirstLastFramePromptValidationError('LINK_REMOVED', 'First/last frame link was removed')
  }

  return { firstPanel, lastPanel, episodeId }
}
