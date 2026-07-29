import type { CreativeResourceMediaType } from '@/lib/creative-resource/contracts'
import type {
  WorkspaceCanvasMediaShell,
  WorkspaceCanvasMediaShellForm,
  WorkspaceCanvasNodeKind,
} from './node-canvas-types'

export interface WorkspaceCanvasNodeSize {
  readonly width: number
  readonly height: number
}

interface WorkspaceCanvasMediaPresentation {
  readonly form: WorkspaceCanvasMediaShellForm
  /** Bounding box the media area must fit; `frame` fits the aspect ratio inside it. */
  readonly maxMediaWidth: number
  readonly maxMediaHeight: number
}

export interface WorkspaceCanvasNodePresentationProfile {
  readonly media: Record<CreativeResourceMediaType, WorkspaceCanvasMediaPresentation>
}

/** Card chrome around the media area: horizontal padding + border. */
const NODE_CHROME_WIDTH = 42
/** Header block + content vertical padding + border. */
const NODE_CHROME_HEIGHT = 139

/**
 * Project video ratios are `W:H` strings validated by the project settings
 * policy; an unset or malformed value falls back to the same 16:9 default as
 * `getAspectRatioConfig`.
 */
const DEFAULT_FRAME_ASPECT = { width: 16, height: 9 } as const

const WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES = {
  resourceCard: {
    media: {
      image: { form: 'frame', maxMediaWidth: 360, maxMediaHeight: 460 },
      video: { form: 'frame', maxMediaWidth: 360, maxMediaHeight: 460 },
      audio: { form: 'bar', maxMediaWidth: 360, maxMediaHeight: 64 },
      text: { form: 'card', maxMediaWidth: 360, maxMediaHeight: 220 },
    },
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodePresentationProfile>

export function getWorkspaceCanvasNodePresentationProfile(
  kind: WorkspaceCanvasNodeKind,
): WorkspaceCanvasNodePresentationProfile {
  return WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES[kind]
}

function parseFrameAspect(projectAspectRatio: string | null | undefined): {
  readonly width: number
  readonly height: number
} {
  const match = projectAspectRatio?.trim().match(/^(\d+):(\d+)$/)
  if (!match) return DEFAULT_FRAME_ASPECT
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DEFAULT_FRAME_ASPECT
  }
  return { width, height }
}

/**
 * Resolves the media area for a node. Pending and ready states share this
 * exact shell, so a card never jumps in size when generation completes.
 */
export function resolveWorkspaceCanvasMediaShell(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly mediaType: CreativeResourceMediaType
  readonly projectAspectRatio: string | null | undefined
}): WorkspaceCanvasMediaShell {
  const presentation = getWorkspaceCanvasNodePresentationProfile(input.kind).media[input.mediaType]
  if (presentation.form !== 'frame') {
    return {
      form: presentation.form,
      width: presentation.maxMediaWidth,
      height: presentation.maxMediaHeight,
    }
  }
  const aspect = parseFrameAspect(input.projectAspectRatio)
  const scale = Math.min(
    presentation.maxMediaWidth / aspect.width,
    presentation.maxMediaHeight / aspect.height,
  )
  return {
    form: 'frame',
    width: Math.round(aspect.width * scale),
    height: Math.round(aspect.height * scale),
  }
}

export function resolveWorkspaceCanvasNodeSize(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly mediaType: CreativeResourceMediaType
  readonly projectAspectRatio: string | null | undefined
}): WorkspaceCanvasNodeSize {
  const shell = resolveWorkspaceCanvasMediaShell(input)
  return {
    width: shell.width + NODE_CHROME_WIDTH,
    height: shell.height + NODE_CHROME_HEIGHT,
  }
}
