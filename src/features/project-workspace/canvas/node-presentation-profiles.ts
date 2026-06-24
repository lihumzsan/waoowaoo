import type { WorkspaceCanvasNodeKind } from './node-canvas-types'

export interface WorkspaceCanvasNodeSize {
  readonly width: number
  readonly height: number
}

export type WorkspaceCanvasNodeExpandedLayout = 'stack' | 'wide'

export interface WorkspaceCanvasNodePresentationProfile {
  readonly collapsed: WorkspaceCanvasNodeSize
  readonly expanded?: WorkspaceCanvasNodeSize
  readonly expandedLayout: WorkspaceCanvasNodeExpandedLayout
  readonly defaultExpanded: boolean
}

export const WORKSPACE_CANVAS_DEFAULT_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 320,
  height: 214,
}

export const WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 420,
  height: 560,
}

export const WORKSPACE_CANVAS_SPACE_CONSISTENCY_NODE_SIZE: WorkspaceCanvasNodeSize = {
  width: 460,
  height: 620,
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

export const WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE: WorkspaceCanvasNodeSize = {
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

// 核心剪辑表 / 摄影指导改为「网格卡片 · 整行展开」后，宽度从早期的全表 1480 收窄到常规卡片宽度
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
  analysis: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  scriptClip: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  shot: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  imageAsset: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  videoClip: {
    collapsed: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  finalTimeline: {
    collapsed: WORKSPACE_CANVAS_FINAL_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editScreenplay: {
    collapsed: WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editStylePreview: {
    collapsed: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
    expanded: {
      width: 620,
      height: 760,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editStyleBible: {
    collapsed: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
    expanded: {
      width: 620,
      height: 720,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editDirectorDecoupage: {
    collapsed: WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE,
    expanded: {
      width: 620,
      height: 720,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editPipelineStep: {
    collapsed: WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editProcessGroup: {
    collapsed: { width: 420, height: 200 },
    expanded: { width: 720, height: 560 },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editAssetGroup: {
    collapsed: { width: 720, height: 360 },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editScript: {
    collapsed: {
      width: WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
      height: 360,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  editCinematographyShotPlan: {
    collapsed: {
      width: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH,
      height: 360,
    },
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  spaceConsistency: {
    collapsed: WORKSPACE_CANVAS_SPACE_CONSISTENCY_NODE_SIZE,
    expanded: {
      width: 760,
      height: 820,
    },
    expandedLayout: 'wide',
    defaultExpanded: false,
  },
  storyboardPanelGeneration: {
    collapsed: WORKSPACE_CANVAS_EDIT_PIPELINE_STEP_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  videoPlan: {
    collapsed: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
  },
  bgmScore: {
    collapsed: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
    expanded: {
      width: 960,
      height: 680,
    },
    expandedLayout: 'wide',
    defaultExpanded: false,
  },
  editRequiredAsset: {
    collapsed: WORKSPACE_CANVAS_EDIT_ASSET_NODE_SIZE,
    expandedLayout: 'stack',
    defaultExpanded: false,
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

export function resolveWorkspaceCanvasMeasuredNodeHeight(input: {
  readonly kind: WorkspaceCanvasNodeKind
  readonly measuredHeight: number
}): number {
  const measuredHeight = Math.ceil(input.measuredHeight)
  if (input.kind === 'videoPlan') return measuredHeight
  const profile = getWorkspaceCanvasNodePresentationProfile(input.kind)
  return Math.max(profile.collapsed.height, measuredHeight)
}
