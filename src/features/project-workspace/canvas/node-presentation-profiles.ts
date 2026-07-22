import type {
  WorkspaceCanvasNodeDisclosureState,
  WorkspaceCanvasNodeKind,
} from './node-canvas-types'

export interface WorkspaceCanvasNodeSize {
  readonly width: number
  readonly height: number
}

export interface WorkspaceCanvasNodePresentationProfile {
  readonly collapsed: WorkspaceCanvasNodeSize
  readonly expanded: WorkspaceCanvasNodeSize
  readonly expandedLayout: 'stack'
  readonly defaultExpanded: boolean
}

export const WORKSPACE_CANVAS_RESOURCE_CARD_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 400,
  height: 500,
}

const WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES = {
  resourceCard: {
    collapsed: WORKSPACE_CANVAS_RESOURCE_CARD_NODE_SIZE,
    expanded: { width: 620, height: 720 },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodePresentationProfile>

export function getWorkspaceCanvasNodePresentationProfile(
  kind: WorkspaceCanvasNodeKind,
): WorkspaceCanvasNodePresentationProfile {
  return WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES[kind]
}

export function resolveWorkspaceCanvasNodeSize(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly expanded: boolean
  readonly collapsedSize: WorkspaceCanvasNodeSize
}): WorkspaceCanvasNodeSize {
  const profile = getWorkspaceCanvasNodePresentationProfile(input.kind)
  return input.expanded ? profile.expanded : input.collapsedSize
}

export function resolveWorkspaceCanvasNodeDisclosure(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly userExpandedOverride?: boolean
  readonly defaultExpanded?: boolean
}): WorkspaceCanvasNodeDisclosureState {
  const profile = getWorkspaceCanvasNodePresentationProfile(input.kind)
  const effectiveExpanded = input.userExpandedOverride ?? input.defaultExpanded ?? profile.defaultExpanded
  return {
    canToggle: true,
    effectiveExpanded,
    mode: effectiveExpanded ? 'expanded' : 'collapsed',
  }
}
