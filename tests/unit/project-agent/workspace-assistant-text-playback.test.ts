import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantTextPlaybackTick,
} from '@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantTextPlayback'

describe('Workspace Assistant text playback tick', () => {
  it('advances against the latest growing target without waiting for a stream pause', () => {
    let displayedCount = 12
    for (const targetLength of [20, 30, 42, 56]) {
      const tick = resolveWorkspaceAssistantTextPlaybackTick({
        displayedCount,
        targetLength,
        running: true,
      })
      expect(tick.nextDisplayedCount).toBeGreaterThan(displayedCount)
      expect(tick.continuePlayback).toBe(true)
      displayedCount = tick.nextDisplayedCount
    }
  })

  it('drains a non-running backlog to the full target and then stops its clock', () => {
    let displayedCount = 0
    let tickCount = 0
    while (displayedCount < 120 && tickCount < 120) {
      const tick = resolveWorkspaceAssistantTextPlaybackTick({
        displayedCount,
        targetLength: 120,
        running: false,
      })
      displayedCount = tick.nextDisplayedCount
      tickCount += 1
    }
    expect(displayedCount).toBe(120)
    expect(tickCount).toBeLessThanOrEqual(120)
    expect(resolveWorkspaceAssistantTextPlaybackTick({
      displayedCount,
      targetLength: 120,
      running: false,
    }).continuePlayback).toBe(false)
  })
})
