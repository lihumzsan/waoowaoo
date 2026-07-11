import { describe, expect, it } from 'vitest'
import { resolveWorkspaceCanvasMotionPresenceAction } from '@/features/project-workspace/canvas/nodes/workspace-canvas-motion-presence'

describe('workspace canvas motion presence', () => {
  it('does not request a state write while visible content is already rendered', () => {
    expect(resolveWorkspaceCanvasMotionPresenceAction({
      visible: true,
      exit: true,
      rendered: true,
    })).toBe('idle')
  })

  it('shows a re-opened presence exactly once', () => {
    expect(resolveWorkspaceCanvasMotionPresenceAction({
      visible: true,
      exit: true,
      rendered: false,
    })).toBe('show')
    expect(resolveWorkspaceCanvasMotionPresenceAction({
      visible: true,
      exit: true,
      rendered: true,
    })).toBe('idle')
  })

  it('distinguishes immediate removal from an exit transition', () => {
    expect(resolveWorkspaceCanvasMotionPresenceAction({
      visible: false,
      exit: false,
      rendered: true,
    })).toBe('hide')
    expect(resolveWorkspaceCanvasMotionPresenceAction({
      visible: false,
      exit: true,
      rendered: true,
    })).toBe('schedule_exit')
  })

  it('does not repeat removal after the presence has settled', () => {
    expect(resolveWorkspaceCanvasMotionPresenceAction({
      visible: false,
      exit: true,
      rendered: false,
    })).toBe('idle')
  })
})
