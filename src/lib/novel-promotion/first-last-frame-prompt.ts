import { prisma } from '@/lib/prisma'
import { sha256Hex } from '@/lib/media/hash'
import {
  COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
  COMFYUI_LTX23_GOON_FPS,
  normalizeLtx23GoonDurationSeconds,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'

export type FirstLastFramePromptReason = 'link' | 'source_change' | 'manual'

async function queryPanels(firstPanelId: string, lastPanelId: string) {
  return await prisma.novelPromotionPanel.findMany({
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

export const FIRST_LAST_FRAME_PROMPT_TEMPLATE_VERSION = 'v1'

function stableImageIdentity(panel: {
  imageUrl?: string | null
  imageMedia?: { publicId?: string | null; storageKey?: string | null; sha256?: string | null } | null
}) {
  if (panel.imageMedia) {
    return {
      publicId: panel.imageMedia.publicId || null,
      storageKey: panel.imageMedia.storageKey || null,
      sha256: panel.imageMedia.sha256 || null,
    }
  }
  const raw = typeof panel.imageUrl === 'string' ? panel.imageUrl.trim() : ''
  return raw ? raw.split('#')[0]?.split('?')[0] || '' : ''
}

function effectiveDuration(panel: { videoDurationBinding?: string | null; duration?: number | null }) {
  let candidate: unknown = panel.duration
  if (panel.videoDurationBinding) {
    try {
      const parsed = JSON.parse(panel.videoDurationBinding) as Record<string, unknown>
      candidate = parsed.targetDurationSeconds ?? parsed.durationSeconds ?? candidate
    } catch {
      // Invalid legacy bindings fall back to the canonical Goon duration.
    }
  }
  return normalizeLtx23GoonDurationSeconds(candidate)
}

function promptContext(panel: Record<string, unknown>) {
  return {
    description: panel.description || null,
    imagePrompt: panel.imagePrompt || null,
    videoPrompt: panel.videoPrompt || null,
    shotType: panel.shotType || null,
    cameraMove: panel.cameraMove || null,
    location: panel.location || null,
    characters: panel.characters || null,
    props: panel.props || null,
    srtSegment: panel.srtSegment || null,
    sceneType: panel.sceneType || null,
  }
}

export function buildFirstLastFramePromptFingerprint(
  firstPanel: Record<string, unknown>,
  lastPanel: Record<string, unknown>,
) {
  return sha256Hex(JSON.stringify({
    promptTemplateVersion: FIRST_LAST_FRAME_PROMPT_TEMPLATE_VERSION,
    workflowKey: COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
    fps: COMFYUI_LTX23_GOON_FPS,
    durationSeconds: effectiveDuration(firstPanel as { videoDurationBinding?: string | null; duration?: number | null }),
    first: {
      panelId: firstPanel.id,
      image: stableImageIdentity(firstPanel as Parameters<typeof stableImageIdentity>[0]),
      context: promptContext(firstPanel),
    },
    last: {
      panelId: lastPanel.id,
      image: stableImageIdentity(lastPanel as Parameters<typeof stableImageIdentity>[0]),
      context: promptContext(lastPanel),
    },
  }))
}

export function getFirstLastFramePromptTiming(firstPanel: Record<string, unknown>) {
  return {
    durationSeconds: effectiveDuration(firstPanel as { videoDurationBinding?: string | null; duration?: number | null }),
    fps: COMFYUI_LTX23_GOON_FPS,
    workflowKey: COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
  }
}

export async function loadAdjacentFirstLastFramePanels(params: {
  projectId: string
  firstPanelId: string
  lastPanelId: string
  episodeId?: string | null
  requireLinked?: boolean
}) {
  const panels = await queryPanels(params.firstPanelId, params.lastPanelId)
  const firstPanel = panels.find((panel) => panel.id === params.firstPanelId)
  const lastPanel = panels.find((panel) => panel.id === params.lastPanelId)
  if (!firstPanel || !lastPanel) throw new Error('First or last panel not found')

  const firstProjectId = firstPanel.storyboard.episode.novelPromotionProject.projectId
  const lastProjectId = lastPanel.storyboard.episode.novelPromotionProject.projectId
  if (firstProjectId !== params.projectId || lastProjectId !== params.projectId) {
    throw new Error('First or last panel belongs to another project')
  }

  const episodeId = firstPanel.storyboard.episodeId
  if (lastPanel.storyboard.episodeId !== episodeId || (params.episodeId && params.episodeId !== episodeId)) {
    throw new Error('First and last panels must belong to the requested episode')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
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
  if (!episode) throw new Error('Episode not found')

  const orderedPanelIds = episode.clips.flatMap((clip) => clip.storyboard?.panels.map((panel) => panel.id) || [])
  const firstIndex = orderedPanelIds.indexOf(firstPanel.id)
  if (firstIndex < 0 || orderedPanelIds[firstIndex + 1] !== lastPanel.id) {
    throw new Error('Panels are not adjacent')
  }
  if (params.requireLinked && !firstPanel.linkedToNextPanel) {
    throw new Error('First/last frame link was removed')
  }

  return { firstPanel, lastPanel, episodeId }
}
