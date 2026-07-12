import type {
  WorkspaceCanvasNodeDisclosureState,
  WorkspaceCanvasNodeKind,
} from './node-canvas-types'

export interface WorkspaceCanvasNodeSize {
  readonly width: number
  readonly height: number
}

export type WorkspaceCanvasNodeExpandedLayout = 'stack' | 'wide'
export type WorkspaceCanvasNodeDisclosureProfile =
  | { readonly kind: 'alwaysExpanded' }
  | {
      readonly kind: 'collapsible'
      readonly forceExpandedWhileStreaming: boolean
      readonly collapseWhenStreamCompletes: boolean
    }

export interface WorkspaceCanvasNodePresentationProfile {
  readonly collapsed: WorkspaceCanvasNodeSize
  readonly expanded?: WorkspaceCanvasNodeSize
  readonly expandedLayout: WorkspaceCanvasNodeExpandedLayout
  readonly defaultExpanded: boolean
  readonly disclosure: WorkspaceCanvasNodeDisclosureProfile
}

const ALWAYS_EXPANDED_NODE_DISCLOSURE: WorkspaceCanvasNodeDisclosureProfile = { kind: 'alwaysExpanded' }
const STREAM_AWARE_COLLAPSIBLE_DISCLOSURE: WorkspaceCanvasNodeDisclosureProfile = {
  kind: 'collapsible',
  forceExpandedWhileStreaming: true,
  collapseWhenStreamCompletes: true,
}

export const WORKSPACE_CANVAS_DEFAULT_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 320,
  height: 214,
}

export const WORKSPACE_CANVAS_SHOT_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 380,
  height: 560,
}

export const WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 560,
}

export const WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 320,
}

export const WORKSPACE_CANVAS_BGM_SCORE_TO_FINAL_GAP_X = 88

export const WORKSPACE_CANVAS_FINAL_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 340,
  height: 280,
}

export const WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 380,
}

export const WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 420,
}

export const WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 360,
}

export const WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 360,
}

export const WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 360,
}

// 核心剪辑表 / 摄影指导 / 剧本创作 / 制作规划 展开态共用「网格卡片 · 整行展开」宽度，折叠态使用各自紧凑尺寸。
export const WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH = 760
export const WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH = 760
export const WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y = 80
export const WORKSPACE_CANVAS_EDIT_ASSET_GRID_COLUMNS = 4
export const WORKSPACE_CANVAS_EDIT_ASSET_GRID_GAP_Y = 120
export const WORKSPACE_CANVAS_EDIT_ASSET_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 520,
}

const WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES = {
  shot: {
    collapsed: WORKSPACE_CANVAS_SHOT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: true,
    disclosure: ALWAYS_EXPANDED_NODE_DISCLOSURE,
  },
  imageAsset: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  videoClip: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  finalTimeline: {
    collapsed: WORKSPACE_CANVAS_FINAL_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editSourceScript: {
    collapsed: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE,
    expanded: {
      width: WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
      height: 560,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editBible: {
    collapsed: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE,
    expanded: {
      width: WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
      height: 560,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editStyleBible: {
    collapsed: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
    expanded: {
      width: 620,
      height: 720,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editPipelineStep: {
    collapsed: WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editProcessGroup: {
    collapsed: { width: 420, height: 200 },
    expanded: { width: 720, height: 560 },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editAssetGroup: {
    collapsed: { width: 720, height: 360 },
    expandedLayout: 'stack',
    defaultExpanded: true,
    disclosure: ALWAYS_EXPANDED_NODE_DISCLOSURE,
  },
  editScript: {
    collapsed: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
    expanded: {
      width: WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
      height: 420,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editShotExecutionPlan: {
    collapsed: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
    expanded: {
      width: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH,
      height: 420,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  videoPlan: {
    collapsed: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  bgmScore: {
    collapsed: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
    expanded: {
      width: 960,
      height: 680,
    },
    expandedLayout: 'wide',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  soundscape: {
    collapsed: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
    expanded: {
      width: 720,
      height: 420,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
  editRequiredAsset: {
    collapsed: WORKSPACE_CANVAS_EDIT_ASSET_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
    disclosure: STREAM_AWARE_COLLAPSIBLE_DISCLOSURE,
  },
} satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodePresentationProfile>

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
  if (input.expanded && profile.expanded) return profile.expanded
  return input.collapsedSize
}

export function resolveWorkspaceCanvasNodeDisclosure(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly userExpandedOverride?: boolean
  readonly defaultExpanded?: boolean
  readonly isStreaming: boolean
}): WorkspaceCanvasNodeDisclosureState {
  const profile = getWorkspaceCanvasNodePresentationProfile(input.kind)
  const disclosure = profile.disclosure
  if (disclosure.kind === 'alwaysExpanded') {
    return {
      canToggle: false,
      effectiveExpanded: true,
      mode: 'expanded',
      isStreamingExpanded: false,
      collapseWhenStreamCompletes: false,
    }
  }

  const isStreamingExpanded = input.isStreaming && disclosure.forceExpandedWhileStreaming
  const userExpanded = input.userExpandedOverride ?? input.defaultExpanded ?? profile.defaultExpanded
  const effectiveExpanded = isStreamingExpanded || userExpanded
  const mode = isStreamingExpanded
    ? 'streaming'
    : effectiveExpanded
      ? 'expanded'
      : 'collapsed'

  return {
    canToggle: !isStreamingExpanded,
    effectiveExpanded,
    mode,
    isStreamingExpanded,
    collapseWhenStreamCompletes: disclosure.collapseWhenStreamCompletes,
  }
}

export function resolveCompletedWorkspaceCanvasStreamingDisclosureNodeIds(input: {
  readonly previousStreamingNodeIds: ReadonlySet<string>
  readonly currentStreamingNodeIds: ReadonlySet<string>
}): readonly string[] {
  return Array.from(input.previousStreamingNodeIds)
    .filter((nodeId) => !input.currentStreamingNodeIds.has(nodeId))
}
