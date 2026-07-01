import { describe, expect, it } from 'vitest'
import {
  resolveCompletedWorkspaceCanvasStreamingDisclosureNodeIds,
  resolveWorkspaceCanvasNodeDisclosure,
} from '@/features/project-workspace/canvas/node-presentation-profiles'

describe('workspace canvas node disclosure', () => {
  it('defaults collapsible generated nodes to their collapsed top-level summary', () => {
    const disclosure = resolveWorkspaceCanvasNodeDisclosure({
      kind: 'editScript',
      isStreaming: false,
    })

    expect(disclosure.canToggle).toBe(true)
    expect(disclosure.effectiveExpanded).toBe(false)
    expect(disclosure.mode).toBe('collapsed')
  })

  it('keeps asset requirements expanded and outside manual disclosure toggles', () => {
    const disclosure = resolveWorkspaceCanvasNodeDisclosure({
      kind: 'editAssetGroup',
      userExpandedOverride: false,
      isStreaming: false,
    })

    expect(disclosure.canToggle).toBe(false)
    expect(disclosure.effectiveExpanded).toBe(true)
    expect(disclosure.mode).toBe('expanded')
    expect(disclosure.collapseWhenStreamCompletes).toBe(false)
  })

  it('forces streaming generated nodes open without persisting a manual toggle', () => {
    const disclosure = resolveWorkspaceCanvasNodeDisclosure({
      kind: 'editShotExecutionPlan',
      userExpandedOverride: false,
      isStreaming: true,
    })

    expect(disclosure.canToggle).toBe(false)
    expect(disclosure.effectiveExpanded).toBe(true)
    expect(disclosure.mode).toBe('streaming')
    expect(disclosure.isStreamingExpanded).toBe(true)
    expect(disclosure.collapseWhenStreamCompletes).toBe(true)
  })

  it('identifies stream-expanded nodes that completed and should clear overrides', () => {
    const completedNodeIds = resolveCompletedWorkspaceCanvasStreamingDisclosureNodeIds({
      previousStreamingNodeIds: new Set(['edit-script:1', 'edit-shot-execution-plan:1']),
      currentStreamingNodeIds: new Set(['edit-shot-execution-plan:1']),
    })

    expect(completedNodeIds).toEqual(['edit-script:1'])
  })
})
