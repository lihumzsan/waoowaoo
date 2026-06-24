import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceCanvasFocusKey,
  resolveCanvasFocusFollowDecision,
  resolveWorkspaceCanvasFocusNodeIds,
  resolveWorkspaceCanvasStyleBibleFocusNodeIds,
} from '@/features/project-workspace/canvas/hooks/useCanvasFocusFollow'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

function workspaceNode(
  id: string,
  kind: WorkspaceCanvasFlowNode['data']['kind'],
  isRunning: boolean,
): WorkspaceCanvasFlowNode {
  return {
    id,
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind,
      layoutNodeType: kind,
      targetType: 'panel',
      targetId: id,
      title: id,
      eyebrow: 'Shot',
      body: 'body',
      meta: 'meta',
      statusLabel: isRunning ? 'Processing' : 'Ready',
      isRunning,
      width: 320,
      height: 420,
    },
  }
}

describe('workspace canvas focus follow', () => {
  it('focuses only the operation primary card instead of every running node', () => {
    const nodes = [
      workspaceNode('edit-process:script-1', 'editProcessGroup', true),
      workspaceNode('edit-script:script-1', 'editScript', true),
      workspaceNode('shot:panel-1', 'shot', true),
    ]

    const focusNodeIds = resolveWorkspaceCanvasFocusNodeIds(nodes, 'generate_edit_script')

    expect(focusNodeIds).toEqual(['edit-script:script-1'])
    expect(buildWorkspaceCanvasFocusKey(focusNodeIds)).toBe('edit-script:script-1')
  })

  it('falls back to one prioritized running card when there is no active operation', () => {
    const nodes = [
      workspaceNode('edit-process:script-1', 'editProcessGroup', true),
      workspaceNode('shot:panel-1', 'shot', true),
      workspaceNode('edit-script:script-1', 'editScript', true),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, null)).toEqual(['edit-script:script-1'])
  })

  it('keeps bulk storyboard image generation focused to a single card', () => {
    const nodes = [
      workspaceNode('shot:panel-2', 'shot', true),
      workspaceNode('shot:panel-1', 'shot', true),
      workspaceNode('shot:panel-3', 'shot', false),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, 'generate_edit_script_storyboard_images')).toEqual(['shot:panel-2'])
  })

  it('focuses storyboard panel generation before falling back to generated shot nodes', () => {
    const nodes = [
      workspaceNode('space-consistency:storyboard-1', 'spaceConsistency', false),
      workspaceNode('storyboard-panel-generation:storyboard-1', 'storyboardPanelGeneration', false),
      workspaceNode('shot:panel-1', 'shot', false),
    ]

    expect(resolveWorkspaceCanvasFocusNodeIds(nodes, 'generate_edit_script_storyboard'))
      .toEqual(['storyboard-panel-generation:storyboard-1'])
  })

  it('resolves confirmed style bible focus requests to the style bible card', () => {
    const nodes = [
      workspaceNode('edit-screenplay:screenplay-1', 'editScreenplay', false),
      workspaceNode('edit-style-bible:screenplay-1', 'editStyleBible', false),
    ]

    expect(resolveWorkspaceCanvasStyleBibleFocusNodeIds(nodes)).toEqual(['edit-style-bible:screenplay-1'])
  })

  it('uses the explicit request key so the same style bible card can be refocused', () => {
    const nodeIds = ['edit-style-bible:screenplay-1']

    expect(buildWorkspaceCanvasFocusKey(nodeIds, 'style-bible-confirmed:1'))
      .toBe('style-bible-confirmed:1:edit-style-bible:screenplay-1')
    expect(resolveCanvasFocusFollowDecision({
      focusKey: buildWorkspaceCanvasFocusKey(nodeIds, 'style-bible-confirmed:2'),
      enabled: true,
      suppressedFocusKey: null,
      lastFocusedKey: buildWorkspaceCanvasFocusKey(nodeIds, 'style-bible-confirmed:1'),
    })).toBe('focus')
  })

  it('does not refocus the same running group after it has already focused', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      suppressedFocusKey: null,
      lastFocusedKey: 'shot:panel-1',
    })).toBe('skip_already_focused')
  })

  it('keeps user-suppressed running group pending but allows the next group to focus', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: true,
      suppressedFocusKey: 'shot:panel-1',
      lastFocusedKey: 'shot:panel-1',
    })).toBe('pending')

    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-2',
      enabled: true,
      suppressedFocusKey: 'shot:panel-1',
      lastFocusedKey: 'shot:panel-1',
    })).toBe('focus')
  })

  it('keeps focus pending while auto follow is disabled', () => {
    expect(resolveCanvasFocusFollowDecision({
      focusKey: 'shot:panel-1',
      enabled: false,
      suppressedFocusKey: null,
      lastFocusedKey: null,
    })).toBe('pending')
  })
})
