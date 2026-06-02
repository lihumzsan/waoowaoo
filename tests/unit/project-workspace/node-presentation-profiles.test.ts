import { describe, expect, it } from 'vitest'
import {
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

  it('gives director and cinematography nodes distinct expanded profiles', () => {
    const directorProfile = getWorkspaceCanvasNodePresentationProfile('editDirectorDecoupage')
    const cinematographyProfile = getWorkspaceCanvasNodePresentationProfile('editCinematographyShotPlan')

    expect(directorProfile.collapsed).toEqual({ width: 420, height: 360 })
    expect(directorProfile.expanded).toEqual({ width: 620, height: 720 })
    expect(cinematographyProfile.collapsed).toEqual({ width: 460, height: 620 })
    expect(cinematographyProfile.expanded).toEqual({ width: 760, height: 820 })
    expect(cinematographyProfile.expandedLayout).toBe('wide')
  })

  it('allows measured video plan nodes to shrink to actual content height', () => {
    expect(resolveWorkspaceCanvasMeasuredNodeHeight({
      kind: 'videoPlan',
      measuredHeight: 472.2,
    })).toBe(473)
  })

  it('keeps measured non-video-plan nodes at least their collapsed height', () => {
    expect(resolveWorkspaceCanvasMeasuredNodeHeight({
      kind: 'editScreenplay',
      measuredHeight: 260,
    })).toBe(380)
  })
})
