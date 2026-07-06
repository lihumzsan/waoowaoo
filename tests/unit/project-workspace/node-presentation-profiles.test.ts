import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
  getWorkspaceCanvasNodePresentationProfile,
  resolveWorkspaceCanvasMeasuredNodeHeight,
  resolveWorkspaceCanvasNodeSize,
} from '@/features/project-workspace/canvas/node-presentation-profiles'

describe('workspace canvas node presentation profiles', () => {
  it('gives BGM score nodes a wider expanded presentation without changing collapsed size', () => {
    const bgmProfile = getWorkspaceCanvasNodePresentationProfile('bgmScore')

    expect(bgmProfile.collapsed).toEqual({ width: 420, height: 320 })
    expect(bgmProfile.expanded).toEqual({ width: 960, height: 680 })
    expect(bgmProfile.expandedLayout).toBe('wide')
    expect(resolveWorkspaceCanvasNodeSize({
      kind: 'bgmScore',
      expanded: false,
      collapsedSize: bgmProfile.collapsed,
    })).toEqual({ width: 420, height: 320 })
    expect(resolveWorkspaceCanvasNodeSize({
      kind: 'bgmScore',
      expanded: true,
      collapsedSize: bgmProfile.collapsed,
    })).toEqual({ width: 960, height: 680 })
  })

  it('keeps node types without an expanded size on their projected collapsed dimensions', () => {
    expect(resolveWorkspaceCanvasNodeSize({
      kind: 'shot',
      expanded: true,
      collapsedSize: { width: 320, height: 560 },
    })).toEqual({ width: 320, height: 560 })
  })

  it('keeps edit-first summary nodes compact and expands only when requested', () => {
    const editScriptProfile = getWorkspaceCanvasNodePresentationProfile('editScript')
    const executionProfile = getWorkspaceCanvasNodePresentationProfile('editShotExecutionPlan')

    expect(editScriptProfile.collapsed).toEqual(WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE)
    expect(editScriptProfile.expanded).toEqual({ width: 760, height: 420 })
    expect(resolveWorkspaceCanvasNodeSize({
      kind: 'editScript',
      expanded: false,
      collapsedSize: editScriptProfile.collapsed,
    })).toEqual(WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE)
    expect(resolveWorkspaceCanvasNodeSize({
      kind: 'editScript',
      expanded: true,
      collapsedSize: editScriptProfile.collapsed,
    })).toEqual({ width: 760, height: 420 })

    expect(executionProfile.collapsed).toEqual(WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE)
    expect(executionProfile.expanded).toEqual({ width: 760, height: 420 })
    expect(executionProfile.expandedLayout).toBe('stack')
  })

  it('allows measured video plan nodes to shrink to actual content height', () => {
    expect(resolveWorkspaceCanvasMeasuredNodeHeight({
      kind: 'videoPlan',
      measuredHeight: 472.2,
    })).toBe(473)
  })

  it('uses measured content height without keeping collapsed-height whitespace', () => {
    expect(resolveWorkspaceCanvasMeasuredNodeHeight({
      kind: 'editBible',
      measuredHeight: 260,
    })).toBe(260)
    expect(resolveWorkspaceCanvasMeasuredNodeHeight({
      kind: 'shot',
      measuredHeight: 312.2,
    })).toBe(313)
  })
})
