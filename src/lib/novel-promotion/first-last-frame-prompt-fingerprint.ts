import {
  COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
  COMFYUI_LTX23_GOON_FPS,
  normalizeLtx23GoonDurationSeconds,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import {
  FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
} from './first-last-frame-smart-duration'

export const FIRST_LAST_FRAME_PROMPT_TEMPLATE_VERSION = 'v1'

export type FirstLastFrameFingerprintPanel = {
  id?: unknown
  imageUrl?: string | null
  imageMedia?: {
    publicId?: string | null
    storageKey?: string | null
    sha256?: string | null
  } | null
  description?: unknown
  imagePrompt?: unknown
  videoPrompt?: unknown
  shotType?: unknown
  cameraMove?: unknown
  location?: unknown
  characters?: unknown
  props?: unknown
  srtSegment?: unknown
  sceneType?: unknown
  videoDurationBinding?: string | object | null
  duration?: number | null
}

function stableImageIdentity(panel: FirstLastFrameFingerprintPanel) {
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

function effectiveDuration(panel: FirstLastFrameFingerprintPanel) {
  let candidate: unknown = panel.duration
  if (panel.videoDurationBinding) {
    try {
      const parsed = typeof panel.videoDurationBinding === 'string'
        ? JSON.parse(panel.videoDurationBinding) as Record<string, unknown>
        : panel.videoDurationBinding as Record<string, unknown>
      candidate = parsed.targetDurationSeconds ?? parsed.durationSeconds ?? candidate
    } catch {
      // Invalid legacy bindings fall back to the canonical Goon duration.
    }
  }
  return normalizeLtx23GoonDurationSeconds(candidate)
}

function effectiveDurationSource(panel: FirstLastFrameFingerprintPanel): 'manual' | 'smart' | null {
  if (!panel.videoDurationBinding) return null
  try {
    const parsed = typeof panel.videoDurationBinding === 'string'
      ? JSON.parse(panel.videoDurationBinding) as Record<string, unknown>
      : panel.videoDurationBinding as Record<string, unknown>
    if (parsed.durationSource === 'manual' || parsed.durationSource === 'smart') return parsed.durationSource
    if (typeof parsed.targetDurationSeconds === 'number' && Number.isFinite(parsed.targetDurationSeconds)) {
      return 'manual'
    }
  } catch {
    return null
  }
  return null
}

function promptContext(panel: FirstLastFrameFingerprintPanel) {
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

export function buildFirstLastFramePromptFingerprintInput(params: {
  firstPanel: FirstLastFrameFingerprintPanel
  lastPanel: FirstLastFrameFingerprintPanel
}) {
  return {
    promptTemplateVersion: FIRST_LAST_FRAME_PROMPT_TEMPLATE_VERSION,
    workflowKey: COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
    fps: COMFYUI_LTX23_GOON_FPS,
    durationSeconds: effectiveDuration(params.firstPanel),
    durationSource: effectiveDurationSource(params.firstPanel),
    smartDurationAlgorithmVersion: FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
    first: {
      panelId: params.firstPanel.id,
      image: stableImageIdentity(params.firstPanel),
      context: promptContext(params.firstPanel),
    },
    last: {
      panelId: params.lastPanel.id,
      image: stableImageIdentity(params.lastPanel),
      context: promptContext(params.lastPanel),
    },
  }
}

export function getFirstLastFramePromptTimingInput(firstPanel: FirstLastFrameFingerprintPanel) {
  return {
    durationSeconds: effectiveDuration(firstPanel),
    fps: COMFYUI_LTX23_GOON_FPS,
    workflowKey: COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
  }
}
